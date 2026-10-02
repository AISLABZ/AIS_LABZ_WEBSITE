import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml, isValidSlug } from '../lib/text.js';
import { renderArticlePage, renderIndexPage } from './pages.js';
import { articleUrl } from './schema.js';

export const LIVE_STATUSES = ['scheduled', 'published', 'needs_update'];
const MARKER = '.generated-by-articles-engine';

export function liveArticles(store) {
  return store.listArticles()
    .filter((a) => LIVE_STATUSES.includes(a.status) && a.publishedAt && isValidSlug(a.slug))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function relatedArticles(article, all, max = 3) {
  const others = all.filter((a) => a.id !== article.id);
  const score = (a) => (a.primaryTopic === article.primaryTopic ? 2 : 0) +
    (a.secondaryTopics || []).filter((t) => (article.secondaryTopics || []).includes(t)).length;
  return others.map((a) => ({ a, s: score(a) })).filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || y.a.publishedAt.localeCompare(x.a.publishedAt))
    .slice(0, max).map((x) => x.a);
}

export function renderSitemap(articles, site) {
  const latest = articles.reduce((m, a) => ((a.updatedAt || a.publishedAt) > m ? (a.updatedAt || a.publishedAt) : m), '');
  const urls = [];
  if (articles.length) urls.push({ loc: `${site.siteUrl}/articles/`, lastmod: latest });
  for (const a of articles) urls.push({ loc: articleUrl(site.siteUrl, a.slug), lastmod: a.updatedAt || a.publishedAt });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${escapeHtml(u.lastmod.slice(0, 10))}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function copyImage(cfg, article, dir) {
  if (!article.featuredImageFile) return;
  const src = path.join(cfg.dataDir, 'images', path.basename(article.featuredImageFile));
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, path.basename(article.featuredImageFile)));
}

/**
 * Render the full /articles/ section into the output directory.
 * Only directories this engine created (marker file) are ever removed.
 */
export function buildSite(cfg, store) {
  const out = cfg.outputDir;
  const site = cfg.site;
  const articles = liveArticles(store);
  const per = site.articlesPerPage || 12;
  const totalPages = Math.max(1, Math.ceil(articles.length / per));
  const written = [];

  const articlesDir = path.join(out, 'articles');
  fs.mkdirSync(articlesDir, { recursive: true });

  for (let p = 1; p <= totalPages; p++) {
    const slice = articles.slice((p - 1) * per, p * per);
    const file = p === 1 ? path.join(articlesDir, 'index.html') : path.join(articlesDir, 'page', String(p), 'index.html');
    write(file, renderIndexPage(slice, { site, page: p, totalPages }));
    written.push(file);
  }

  const liveSlugs = new Set();
  for (const a of articles) {
    const dir = path.join(articlesDir, a.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, MARKER), a.id);
    write(path.join(dir, 'index.html'), renderArticlePage(a, { site, related: relatedArticles(a, articles) }));
    copyImage(cfg, a, dir);
    liveSlugs.add(a.slug);
    written.push(path.join(dir, 'index.html'));
  }

  // Remove stale generated article directories and stale pagination pages.
  const removed = [];
  for (const entry of fs.readdirSync(articlesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'page') continue;
    const dir = path.join(articlesDir, entry.name);
    if (!liveSlugs.has(entry.name) && fs.existsSync(path.join(dir, MARKER))) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(entry.name);
    }
  }
  const pageDir = path.join(articlesDir, 'page');
  if (fs.existsSync(pageDir)) {
    for (const entry of fs.readdirSync(pageDir)) {
      if (/^\d+$/.test(entry) && Number(entry) > totalPages) fs.rmSync(path.join(pageDir, entry), { recursive: true, force: true });
    }
  }

  const cssOut = path.join(out, 'assets', 'articles', 'articles.css');
  fs.mkdirSync(path.dirname(cssOut), { recursive: true });
  fs.copyFileSync(path.join(cfg.root, 'assets', 'articles.css'), cssOut);
  write(path.join(out, 'sitemap-articles.xml'), renderSitemap(articles, site));

  return { articles: articles.length, pages: totalPages, written: written.length, removed };
}

/** Render a noindex preview of one article (any status) for human review. */
export function buildPreview(cfg, store, article) {
  const dir = path.join(cfg.previewDir, 'articles', article.slug);
  fs.mkdirSync(dir, { recursive: true });
  const asIfPublished = { ...article, publishedAt: article.publishedAt || new Date().toISOString() };
  const file = path.join(dir, 'index.html');
  write(file, renderArticlePage(asIfPublished, { site: cfg.site, preview: true }));
  copyImage(cfg, article, dir);
  const cssOut = path.join(cfg.previewDir, 'assets', 'articles', 'articles.css');
  fs.mkdirSync(path.dirname(cssOut), { recursive: true });
  fs.copyFileSync(path.join(cfg.root, 'assets', 'articles.css'), cssOut);
  return file;
}
