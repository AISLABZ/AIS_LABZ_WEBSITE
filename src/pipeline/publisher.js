import { buildSite } from '../render/build.js';
import { renderArticlePage } from '../render/pages.js';
import { articleUrl } from '../render/schema.js';
import { validateRenderedArticle } from './seo-validator.js';
import { safeFetch } from '../lib/http.js';
import { escapeHtml } from '../lib/text.js';

export class PublishBlockedError extends Error {
  constructor(msg) { super(msg); this.name = 'PublishBlockedError'; }
}

/**
 * Publish an article: re-check gates, mark `scheduled`, render the site.
 * The article only becomes `published` after post-publication verification.
 */
export function publishArticle(cfg, store, articleId, { approvedBy } = {}) {
  const article = store.getArticle(articleId);
  if (!article) throw new PublishBlockedError(`Unknown article ${articleId}`);
  if (article.qaStatus !== 'passed' || article.qaReport?.gate?.decision !== 'APPROVED') {
    throw new PublishBlockedError('Article has not passed the publication gate; it cannot be published');
  }
  const allowedFrom = cfg.autoPublish ? ['draft', 'approved', 'publication_failed'] : ['approved', 'publication_failed'];
  if (!allowedFrom.includes(article.status)) {
    throw new PublishBlockedError(`Article status "${article.status}" cannot be published${cfg.autoPublish ? '' : ' (manual mode requires an approved article)'}`);
  }

  const publishedAt = article.publishedAt || new Date().toISOString();
  const candidate = { ...article, publishedAt, canonicalUrl: articleUrl(cfg.site.siteUrl, article.slug) };
  const others = store.listArticles().filter((a) => a.id !== article.id);
  const html = renderArticlePage(candidate, { site: cfg.site });
  const seo = validateRenderedArticle(html, candidate, { site: cfg.site, otherArticles: others, requireFeaturedImage: cfg.requireFeaturedImage });
  if (!seo.ok) throw new PublishBlockedError(`Technical SEO re-check failed: ${seo.errors.join('; ')}`);

  const saved = store.saveArticle({ ...candidate, status: 'scheduled', approvedBy: approvedBy || article.approvedBy || (cfg.autoPublish ? 'auto' : undefined) }, { note: 'rendered for publication' });
  const build = buildSite(cfg, store);
  return { article: saved, build, url: saved.canonicalUrl };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Inspect a live article page. Returns { ok, checks, errors }. */
export async function inspectLive(cfg, article, { fetchPage = (u, o) => safeFetch(u, { timeoutMs: 20000, ...o }) } = {}) {
  const url = articleUrl(cfg.site.siteUrl, article.slug);
  const errors = [];
  const checks = {};
  let res;
  try { res = await fetchPage(`${url}?verify=${Date.now()}`); } catch (err) { return { ok: false, errors: [`fetch failed: ${err.message}`], checks }; }
  checks.status = res.status;
  if (res.status !== 200) return { ok: false, errors: [`HTTP ${res.status}`], checks };
  const html = res.body;
  const has = (name, cond, msg) => { checks[name] = cond; if (!cond) errors.push(msg); };
  has('title', html.includes(`<title>${escapeHtml(article.seoTitle)}</title>`), 'expected <title> not found');
  has('canonical', html.includes(`<link rel="canonical" href="${url}">`), 'canonical missing or wrong');
  const robots = html.match(/<meta name="robots" content="([^"]*)"/i)?.[1] || '';
  has('indexable', !/noindex|none/i.test(robots), `robots not indexable: "${robots}"`);
  const xRobots = res.headers?.get?.('x-robots-tag') || '';
  has('xRobotsTag', !/noindex|none/i.test(xRobots), `X-Robots-Tag blocks indexing: "${xRobots}"`);
  has('body', /<h1>/.test(html) && /class="ae-prose"/.test(html) && html.length > 5000, 'article body missing');
  has('structuredData', /"@type":"Article"/.test(html), 'Article structured data missing');
  if (article.featuredImage) {
    try {
      const img = await fetchPage(new URL(article.featuredImage, cfg.site.siteUrl).toString(), { method: 'HEAD' });
      has('featuredImage', img.ok, `featured image HTTP ${img.status}`);
    } catch (err) { has('featuredImage', false, `featured image: ${err.message}`); }
  } else if (cfg.requireFeaturedImage) {
    has('featuredImage', false, 'featured image required but missing');
  }
  try {
    const sm = await fetchPage(`${cfg.site.siteUrl}/sitemap-articles.xml?verify=${Date.now()}`);
    has('sitemap', sm.ok && sm.body.includes(`<loc>${url}</loc>`), 'URL not found in live sitemap-articles.xml');
  } catch (err) { has('sitemap', false, `sitemap: ${err.message}`); }
  return { ok: errors.length === 0, errors, checks };
}

/**
 * Post-publication validator: poll the live URL until it passes or the timeout
 * expires (deploys can take minutes). Only then is the article `published`.
 */
export async function verifyPublication(cfg, store, articleId, { fetchPage, validateLinksFn, intervalMs = 30000, timeoutSeconds = cfg.postPublishTimeoutSeconds, logger } = {}) {
  const article = store.getArticle(articleId);
  if (!article || article.status !== 'scheduled') throw new Error(`Article ${articleId} is not awaiting verification (status ${article?.status})`);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let last;
  do {
    last = await inspectLive(cfg, article, fetchPage ? { fetchPage } : {});
    if (last.ok) break;
    logger?.info('live verification pending', { errors: last.errors });
    if (Date.now() + intervalMs > deadline) break;
    await sleep(intervalMs);
  } while (Date.now() < deadline);

  let linkReport = null;
  if (last.ok && validateLinksFn) {
    linkReport = await validateLinksFn(article);
    if (!linkReport.ok) { last.ok = false; last.errors.push(`links failing on live page: ${linkReport.failures.map((f) => f.href).join(', ')}`); }
  }

  const verification = { at: new Date().toISOString(), ...last, links: linkReport ? { ok: linkReport.ok, failures: linkReport.failures } : null };
  if (last.ok) {
    const saved = store.saveArticle({ ...article, status: 'published', liveVerification: verification }, { note: 'live URL verified' });
    return { ok: true, article: saved, verification };
  }
  const saved = store.saveArticle({ ...article, status: 'publication_failed', liveVerification: verification }, { note: 'live verification failed' });
  return { ok: false, article: saved, verification };
}
