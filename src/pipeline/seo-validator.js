import { isValidSlug } from '../lib/text.js';
import { articleUrl } from '../render/schema.js';

function attr(html, re) { return html.match(re)?.[1] ?? null; }

/** Check that tags open/close in a balanced way (void elements excluded). */
export function checkHtmlBalance(html) {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/i, '');
  const stack = [];
  for (const m of body.matchAll(/<(\/)?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/)?>/g)) {
    const [, closing, rawName, selfClose] = m;
    const name = rawName.toLowerCase();
    if (VOID.has(name) || selfClose) continue;
    if (!closing) stack.push(name);
    else {
      const top = stack.pop();
      if (top !== name) return { ok: false, error: `unexpected </${name}>, expected </${top}>` };
    }
  }
  return stack.length ? { ok: false, error: `unclosed <${stack[stack.length - 1]}>` } : { ok: true };
}

/**
 * Technical SEO validation of a rendered article page.
 * `otherArticles` is used for title/description uniqueness.
 */
export function validateRenderedArticle(html, article, { site, otherArticles = [], requireFeaturedImage = false }) {
  const errors = [];
  const warnings = [];
  const expectedCanonical = articleUrl(site.siteUrl, article.slug);

  const h1s = html.match(/<h1[\s>]/gi) || [];
  if (h1s.length !== 1) errors.push(`expected exactly one <h1>, found ${h1s.length}`);

  const title = attr(html, /<title>([^<]*)<\/title>/i);
  if (!title || title.length < 10) errors.push('missing or too-short <title>');
  else if (title.length > 70) warnings.push(`title is ${title.length} characters (may be truncated)`);

  const desc = attr(html, /<meta name="description" content="([^"]*)"/i);
  if (!desc) errors.push('missing meta description');
  else if (desc.length < 70 || desc.length > 170) warnings.push(`meta description length ${desc.length}`);

  const canonical = attr(html, /<link rel="canonical" href="([^"]*)"/i);
  if (canonical !== expectedCanonical) errors.push(`canonical "${canonical}" != "${expectedCanonical}"`);

  const robots = attr(html, /<meta name="robots" content="([^"]*)"/i) || '';
  if (/noindex|none/i.test(robots)) errors.push(`robots directive is not indexable: "${robots}"`);

  for (const p of ['og:title', 'og:description', 'og:url', 'og:type']) {
    if (!new RegExp(`<meta property="${p}" content="[^"]+"`, 'i').test(html)) errors.push(`missing ${p}`);
  }

  if (!isValidSlug(article.slug)) errors.push(`invalid slug "${article.slug}"`);

  // Heading hierarchy within content: first heading must be h2, no h2→h4 jumps, h3 only after an h2.
  let seenH2 = false;
  for (const b of article.content) {
    if (b.type === 'h3' && !seenH2) { errors.push('h3 appears before any h2'); break; }
    if (b.type === 'h2') seenH2 = true;
  }
  if (!seenH2) errors.push('article has no h2 sections');
  if (/<h[4-6][\s>]/i.test(html)) warnings.push('h4–h6 present');

  // Structured data
  const ld = attr(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  try {
    const data = JSON.parse(ld);
    const graph = data['@graph'] || [];
    const art = graph.find((n) => n['@type'] === 'Article');
    if (!art) errors.push('Article structured data missing');
    else {
      for (const k of ['headline', 'datePublished', 'dateModified', 'author', 'publisher', 'mainEntityOfPage']) if (!art[k]) errors.push(`Article schema missing ${k}`);
      if (art.headline !== article.title.slice(0, 110)) errors.push('Article schema headline does not match visible H1');
    }
    if (!graph.find((n) => n['@type'] === 'BreadcrumbList')) errors.push('BreadcrumbList structured data missing');
    if (graph.find((n) => n['@type'] === 'FAQPage')) errors.push('FAQPage markup is not permitted by policy');
  } catch {
    errors.push('structured data missing or invalid JSON');
  }

  // Images: every <img> must have non-empty alt (decorative images are not generated).
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const alt = m[0].match(/\balt="([^"]*)"/i);
    if (!alt || !alt[1].trim()) errors.push('image without alt text');
  }
  if (requireFeaturedImage && !article.featuredImage) errors.push('featured image required (REQUIRE_FEATURED_IMAGE=true) but missing');

  const balance = checkHtmlBalance(html);
  if (!balance.ok) errors.push(`broken HTML: ${balance.error}`);

  if (otherArticles.some((o) => o.id !== article.id && o.seoTitle?.toLowerCase() === article.seoTitle.toLowerCase())) errors.push('SEO title is not unique');
  if (otherArticles.some((o) => o.id !== article.id && o.metaDescription === article.metaDescription)) errors.push('meta description is not unique');
  if (otherArticles.some((o) => o.id !== article.id && o.slug === article.slug)) errors.push('slug is not unique');

  return { ok: errors.length === 0, errors, warnings };
}
