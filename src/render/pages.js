import { escapeHtml } from '../lib/text.js';
import { formatDisplayDate } from '../lib/time.js';
import { renderBlocks, renderInline, headingIds, safeHref } from './blocks.js';
import { buildArticleSchema, buildIndexSchema, jsonLd, articleUrl, absoluteUrl } from './schema.js';

export const CSS_PATH = '/assets/articles/articles.css';
export const CSS_VERSION = '2';

function navLinks(items, current) {
  return items.map((l) => {
    const href = safeHref(l.href) || '/';
    const cur = current && href === current ? ' aria-current="page"' : '';
    return `<li><a href="${escapeHtml(href)}"${cur}>${escapeHtml(l.label)}</a></li>`;
  }).join('');
}

export function layout({ site, title, description, canonical, robots, og = {}, schema, body, current = '/articles/', preview = false, headExtra = '' }) {
  const ogTags = Object.entries({ 'og:site_name': site.brandName, 'og:locale': site.locale === 'en' ? 'en_GB' : site.locale, ...og })
    .filter(([, v]) => v)
    .map(([k, v]) => `<meta property="${escapeHtml(k)}" content="${escapeHtml(v)}">`).join('\n  ');
  const twImage = og['og:image'];
  return `<!doctype html>
<html lang="${escapeHtml(site.locale || 'en')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  ${ogTags}
  <meta name="twitter:card" content="${twImage ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escapeHtml(og['og:title'] || title)}">
  <meta name="twitter:description" content="${escapeHtml(og['og:description'] || description)}">
  ${twImage ? `<meta name="twitter:image" content="${escapeHtml(twImage)}">` : ''}
  <link rel="stylesheet" href="${CSS_PATH}?v=${CSS_VERSION}">
  <link rel="alternate" type="application/xml" title="${escapeHtml(site.brandName)} articles sitemap" href="/sitemap-articles.xml">
  ${headExtra}
  <script type="application/ld+json">${jsonLd(schema)}</script>
</head>
<body class="ae">
  <a class="ae-skip" href="#main">Skip to content</a>
  ${preview ? '<div class="ae-preview-banner" role="status">Preview — not published. This page is excluded from search engines.</div>' : ''}
  <header class="ae-header">
    <div class="ae-container ae-header__inner">
      <a class="ae-brand" href="/">${escapeHtml(site.brandName)}</a>
      <nav aria-label="Main"><ul class="ae-nav">${navLinks(site.navigation, current)}</ul></nav>
    </div>
  </header>
  <main id="main">
${body}
  </main>
  <footer class="ae-footer">
    <div class="ae-container ae-footer__inner">
      <p class="ae-footer__brand">${escapeHtml(site.brandName)}</p>
      <nav aria-label="Footer"><ul class="ae-footer__links">${navLinks(site.footerLinks, null)}</ul></nav>
      <p class="ae-footer__copy">© ${new Date().getUTCFullYear()} ${escapeHtml(site.organizationName)}</p>
    </div>
  </footer>
</body>
</html>
`;
}

function dateMeta(article) {
  const pub = article.publishedAt ? `<span>Published <time datetime="${escapeHtml(article.publishedAt)}">${formatDisplayDate(article.publishedAt)}</time></span>` : '';
  const showUpdated = article.updatedAt && article.publishedAt && article.updatedAt.slice(0, 10) > article.publishedAt.slice(0, 10);
  const upd = showUpdated ? `<span>Updated <time datetime="${escapeHtml(article.updatedAt)}">${formatDisplayDate(article.updatedAt)}</time></span>` : '';
  const rt = article.readingTime ? `<span>${article.readingTime} min read</span>` : '';
  return [pub, upd, rt].filter(Boolean).join('<span aria-hidden="true">·</span>');
}

function articleCard(a, site) {
  const img = a.featuredImage
    ? `<img class="ae-card__img" src="${escapeHtml(a.featuredImage)}" alt="${escapeHtml(a.featuredImageAlt || '')}" width="1200" height="675" loading="lazy" decoding="async">`
    : '';
  return `<article class="ae-card">
      ${img}
      <div class="ae-card__body">
        ${a.primaryTopic ? `<p class="ae-eyebrow">${escapeHtml(a.primaryTopic)}</p>` : ''}
        <h2 class="ae-card__title"><a href="/articles/${escapeHtml(a.slug)}/">${escapeHtml(a.title)}</a></h2>
        <p class="ae-card__excerpt">${escapeHtml(a.excerpt)}</p>
        <p class="ae-meta">${dateMeta(a)}</p>
      </div>
    </article>`;
}

export function renderArticlePage(article, { site, related = [], preview = false }) {
  const url = articleUrl(site.siteUrl, article.slug);
  const blocks = article.content || [];
  const ids = headingIds(blocks);
  const h2s = blocks.map((b, i) => (b.type === 'h2' ? { text: b.text, id: ids[i] } : null)).filter(Boolean);
  const toc = h2s.length >= 3
    ? `<nav class="ae-toc" aria-label="On this page"><p class="ae-toc__title">On this page</p><ol>${h2s.map((h) => `<li><a href="#${h.id}">${renderInline(h.text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), site)}</a></li>`).join('')}</ol></nav>`
    : '';
  const img = article.featuredImage
    ? `<figure class="ae-hero-img"><img src="${escapeHtml(article.featuredImage)}" alt="${escapeHtml(article.featuredImageAlt || '')}" width="1200" height="675" fetchpriority="high" decoding="async"></figure>`
    : '';
  const cta = article.cta
    ? `<section class="ae-cta" aria-labelledby="ae-cta-title">
        <h2 id="ae-cta-title">${escapeHtml(article.cta.heading)}</h2>
        <p>${renderInline(article.cta.text, site)}</p>
        <a class="ae-button" href="${escapeHtml(safeHref(article.cta.href) || site.contactUrl)}">${escapeHtml(article.cta.buttonLabel || site.contactLabel)}</a>
      </section>`
    : '';
  const sources = (article.sources || []).length
    ? `<section class="ae-sources" aria-labelledby="ae-sources-title">
        <h2 id="ae-sources-title">Sources</h2>
        <ol>${article.sources.map((s) => `<li><a href="${escapeHtml(safeHref(s.url) || '#')}" rel="noopener noreferrer" target="_blank">${escapeHtml(s.title)}</a>${s.publisher ? ` — ${escapeHtml(s.publisher)}` : ''}${s.publishedDate ? `, ${escapeHtml(s.publishedDate.slice(0, 10))}` : ''}. Accessed ${escapeHtml(s.accessedDate)}.</li>`).join('')}</ol>
      </section>`
    : '';
  const relatedHtml = related.length
    ? `<section class="ae-related ae-container" aria-labelledby="ae-related-title"><h2 id="ae-related-title">Related articles</h2><div class="ae-grid">${related.map((r) => articleCard(r, site)).join('')}</div></section>`
    : '';

  const body = `    <div class="ae-container">
      <nav class="ae-breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/articles/">Articles</a></li><li aria-current="page">${escapeHtml(article.title)}</li></ol></nav>
    </div>
    <article class="ae-article">
      <header class="ae-container ae-article__header">
        ${article.primaryTopic ? `<p class="ae-eyebrow">${escapeHtml(article.primaryTopic)}</p>` : ''}
        <h1>${escapeHtml(article.title)}</h1>
        <p class="ae-dek">${escapeHtml(article.excerpt)}</p>
        <p class="ae-meta">${escapeHtml(`By ${site.organizationName}`)}<span aria-hidden="true">·</span>${dateMeta(article)}</p>
      </header>
      <div class="ae-container">${img}</div>
      <div class="ae-container ae-article__layout">
        ${toc}
        <div class="ae-prose">
${renderBlocks(blocks, site)}
          ${cta}
          ${sources}
        </div>
      </div>
    </article>
    ${relatedHtml}`;

  const ogImage = article.featuredImage ? absoluteUrl(site.siteUrl, article.featuredImage) : (site.defaultOgImage ? absoluteUrl(site.siteUrl, site.defaultOgImage) : '');
  return layout({
    site,
    title: article.seoTitle,
    description: article.metaDescription,
    canonical: url,
    robots: preview ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1',
    og: {
      'og:type': 'article',
      'og:title': article.seoTitle,
      'og:description': article.metaDescription,
      'og:url': url,
      'og:image': ogImage,
      'og:image:alt': article.featuredImage ? article.featuredImageAlt : '',
      'article:published_time': article.publishedAt,
      'article:modified_time': article.updatedAt || article.publishedAt,
      'article:section': article.primaryTopic,
    },
    schema: buildArticleSchema({ ...article, canonicalUrl: url }, site),
    body,
    preview,
  });
}

export function indexPageUrl(siteUrl, page) {
  return page <= 1 ? `${siteUrl}/articles/` : `${siteUrl}/articles/page/${page}/`;
}

/**
 * Topic hub: one section per keyword cluster (config/site.json topicClusters)
 * listing its live articles, the existing pages that own neighbouring queries,
 * and the service page that owns the commercial intent. Empty clusters are skipped.
 */
export function renderClusterHub(site, articles) {
  const serviceName = (url) => (site.services || []).find((s) => s.url === url)?.name;
  const sections = (site.topicClusters || []).map((c) => {
    const own = articles.filter((a) => a.clusterId === c.id);
    const reading = (c.relatedReading || []).filter((r) => safeHref(r.url));
    const service = c.serviceUrl && safeHref(c.serviceUrl) && serviceName(c.serviceUrl);
    if (!own.length && !reading.length) return null;
    const anchor = `topic-${c.id.toLowerCase()}`;
    const items = [
      ...own.map((a) => `<li><a href="/articles/${escapeHtml(a.slug)}/">${escapeHtml(a.title)}</a></li>`),
      ...reading.map((r) => `<li><a href="${escapeHtml(safeHref(r.url))}">${escapeHtml(r.title)}</a> <span class="ae-cluster__tag">Blog</span></li>`),
    ].join('');
    return {
      anchor,
      name: c.name,
      html: `<section class="ae-cluster" id="${anchor}" aria-labelledby="${anchor}-title">
          <h3 id="${anchor}-title">${escapeHtml(c.name)}</h3>
          ${c.description ? `<p class="ae-cluster__desc">${escapeHtml(c.description)}</p>` : ''}
          <ul class="ae-cluster__list">${items}</ul>
          ${service ? `<p class="ae-cluster__service">Related service: <a href="${escapeHtml(c.serviceUrl)}">${escapeHtml(service)}</a></p>` : ''}
        </section>`,
    };
  }).filter(Boolean);
  if (!sections.length) return '';
  return `<section class="ae-clusters" aria-labelledby="ae-clusters-title">
        <h2 id="ae-clusters-title">Browse by topic</h2>
        <nav aria-label="Topics"><ul class="ae-cluster-nav">${sections.map((s) => `<li><a href="#${s.anchor}">${escapeHtml(s.name)}</a></li>`).join('')}</ul></nav>
        <div class="ae-cluster-grid">${sections.map((s) => s.html).join('')}</div>
      </section>`;
}

export function renderIndexPage(articles, { site, page, totalPages, allArticles = articles }) {
  const url = indexPageUrl(site.siteUrl, page);
  const pageTitle = page > 1 ? `${site.articlesIndexTitle} — Page ${page} | ${site.brandName}` : `${site.articlesIndexTitle} | ${site.brandName}`;
  const pagePath = (p) => (p <= 1 ? '/articles/' : `/articles/page/${p}/`);
  const pager = totalPages > 1
    ? `<nav class="ae-pagination" aria-label="Pagination">
        ${page > 1 ? `<a rel="prev" href="${pagePath(page - 1)}">← Newer articles</a>` : '<span></span>'}
        <span>Page ${page} of ${totalPages}</span>
        ${page < totalPages ? `<a rel="next" href="${pagePath(page + 1)}">Older articles →</a>` : '<span></span>'}
      </nav>`
    : '';
  const list = articles.length
    ? `<div class="ae-grid">${articles.map((a) => articleCard(a, site)).join('')}</div>`
    : '<p class="ae-empty">New articles are being researched and will appear here once published.</p>';
  const body = `    <div class="ae-container">
      <nav class="ae-breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">Articles</li></ol></nav>
      <header class="ae-index__header">
        <h1>${escapeHtml(site.articlesIndexTitle)}${page > 1 ? ` <span class="ae-page-num">— page ${page}</span>` : ''}</h1>
        <p class="ae-dek">${escapeHtml(site.articlesIndexDescription)}</p>
      </header>
      ${list}
      ${pager}
      ${page <= 1 ? renderClusterHub(site, allArticles) : ''}
    </div>`;
  const headExtra = [
    page > 1 ? `<link rel="prev" href="${indexPageUrl(site.siteUrl, page - 1)}">` : '',
    page < totalPages ? `<link rel="next" href="${indexPageUrl(site.siteUrl, page + 1)}">` : '',
  ].join('');
  return layout({
    site,
    title: pageTitle,
    description: site.articlesIndexDescription,
    canonical: url,
    // An empty index is thin content: keep it out of the index until the first article ships.
    robots: articles.length ? 'index, follow' : 'noindex, follow',
    og: { 'og:type': 'website', 'og:title': pageTitle, 'og:description': site.articlesIndexDescription, 'og:url': url, 'og:image': site.defaultOgImage ? absoluteUrl(site.siteUrl, site.defaultOgImage) : '' },
    schema: buildIndexSchema(site, url, pageTitle),
    body,
    headExtra,
  });
}
