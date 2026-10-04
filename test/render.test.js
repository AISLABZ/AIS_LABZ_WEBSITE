import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderInline, renderBlocks, safeHref } from '../src/render/blocks.js';
import { renderArticlePage, renderIndexPage } from '../src/render/pages.js';
import { buildSite } from '../src/render/build.js';
import { validateRenderedArticle } from '../src/pipeline/seo-validator.js';
import { slugify, isValidSlug } from '../src/lib/text.js';
import { setup, goodDraft } from './helpers.js';

const site = { siteUrl: 'https://www.aislabz.com', brandName: 'AISLabz', organizationName: 'AISLabz', locale: 'en', navigation: [{ label: 'Articles', href: '/articles/' }], footerLinks: [], contactUrl: '/contact', contactLabel: 'Talk to us', articlesIndexTitle: 'Articles', articlesIndexDescription: 'desc', sameAs: [] };

function article(over = {}) {
  const d = goodDraft();
  return { id: 'art_abc123', title: d.title, slug: 'ai-consulting-explained', seoTitle: 'AI Consulting Explained: From Pilots to Results', metaDescription: 'What AI consulting is, why AI pilots stall, and how to move from experiments to measurable results with clear ownership.', excerpt: d.excerpt, content: d.content, status: 'published', publishedAt: '2026-10-06T08:00:00.000Z', updatedAt: null, primaryTopic: 'AI Consulting', secondaryTopics: ['AI strategy'], sources: [{ title: 'NIST AI RMF', url: 'https://www.nist.gov/itl/ai-risk-management-framework', publisher: 'NIST', publishedDate: '2023-01-26', accessedDate: '2026-10-02' }], cta: { heading: 'Questions?', text: 'Contact us.', href: '/contact', buttonLabel: 'Talk to us', neutral: true }, wordCount: 400, readingTime: 2, ...over };
}

test('slugs are clean, keyword-led and date-free', () => {
  assert.equal(slugify('AI Consulting Explained: How Businesses Can Move From AI Experiments'), 'ai-consulting-explained');
  assert.equal(slugify('SEO vs AEO vs GEO: How Search Visibility Is Changing'), 'seo-aeo-geo');
  assert.ok(isValidSlug('ai-consulting-explained'));
  assert.ok(!isValidSlug('2026/10/02/ai-consulting'));
  assert.ok(!isValidSlug('ai-consulting-2026'));
  assert.ok(!isValidSlug('AI_Consulting'));
  assert.ok(!isValidSlug('../etc'));
});

test('inline rendering escapes HTML and neutralises unsafe links', () => {
  const out = renderInline('<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://example.org/a) [in](/contact) **b**', site);
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(!out.includes('javascript:'), 'javascript: href must not be emitted');
  assert.ok(out.includes('<a href="https://example.org/a" rel="noopener noreferrer" target="_blank">ok</a>'));
  assert.ok(out.includes('<a href="/contact">in</a>'));
  assert.ok(out.includes('<strong>b</strong>'));
  assert.equal(safeHref('//evil.com/x'), null);
  assert.equal(safeHref('http://insecure.example'), null);
});

test('attribute injection through link text or URL is not possible', () => {
  const out = renderBlocks([{ type: 'p', text: '[a" onmouseover="x](https://example.org/"onload="y)' }], site);
  assert.ok(!/onmouseover="x"/.test(out));
  assert.ok(!/ onload=/.test(out));
});

test('article page: one H1, canonical, robots, OG, Article + BreadcrumbList schema, no FAQPage', () => {
  const a = article();
  const html = renderArticlePage(a, { site });
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.ok(html.includes('<link rel="canonical" href="https://www.aislabz.com/articles/ai-consulting-explained/">'));
  assert.ok(html.includes('<meta name="robots" content="index, follow'));
  assert.ok(html.includes('<meta property="og:type" content="article">'));
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const types = ld['@graph'].map((n) => n['@type']);
  assert.deepEqual(types.sort(), ['Article', 'BreadcrumbList', 'Organization']);
  const art = ld['@graph'].find((n) => n['@type'] === 'Article');
  assert.equal(art.headline, a.title);
  assert.equal(art.author['@id'], 'https://www.aislabz.com/#organization', 'author is the organization, never an invented person');
  assert.deepEqual(art.citation, ['https://www.nist.gov/itl/ai-risk-management-framework']);
  assert.ok(html.includes('aria-label="Breadcrumb"'));
  const seo = validateRenderedArticle(html, a, { site });
  assert.deepEqual(seo.errors, []);
});

test('updated date only shown when a substantive update happened after publication', () => {
  assert.ok(!renderArticlePage(article(), { site }).includes('Updated <time'));
  assert.ok(renderArticlePage(article({ updatedAt: '2026-12-01T00:00:00.000Z' }), { site }).includes('Updated <time'));
});

test('preview pages are noindex and fail technical SEO validation', () => {
  const a = article();
  const html = renderArticlePage(a, { site, preview: true });
  assert.ok(html.includes('noindex, nofollow'));
  assert.ok(!validateRenderedArticle(html, a, { site }).ok);
});

test('technical SEO validator rejects multiple H1s, bad canonical and broken hierarchy', () => {
  const a = article({ content: [{ type: 'h3', text: 'Starts at h3' }, { type: 'p', text: 'x' }, { type: 'p', text: 'y' }] });
  const html = renderArticlePage(a, { site }).replace('</main>', '<h1>Second</h1></main>');
  const r = validateRenderedArticle(html, { ...a, slug: 'other-slug' }, { site });
  assert.ok(r.errors.some((e) => e.includes('exactly one <h1>')));
  assert.ok(r.errors.some((e) => e.includes('canonical')));
  assert.ok(r.errors.some((e) => e.includes('h3 appears before any h2')));
});

test('index page is noindex while empty and indexable once articles exist', () => {
  assert.ok(renderIndexPage([], { site, page: 1, totalPages: 1 }).includes('noindex, follow'));
  const html = renderIndexPage([article()], { site, page: 1, totalPages: 1 });
  assert.ok(html.includes('<meta name="robots" content="index, follow">'));
  assert.ok(html.includes('href="/articles/ai-consulting-explained/"'));
});

test('build: routing, pagination, sitemap inclusion and safe stale-directory removal', async () => {
  const { cfg, store, cleanup } = await setup();
  try {
    for (let i = 0; i < 13; i++) {
      store.saveArticle(article({ id: `art_x${i}`, slug: `article-number-${['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen'][i]}`, seoTitle: `Title ${i} for the article page`, metaDescription: `Description ${i}`, publishedAt: `2026-10-${String(i + 1).padStart(2, '0')}T08:00:00.000Z` }));
    }
    store.saveArticle(article({ id: 'art_draft1', slug: 'draft-only-article', status: 'draft', publishedAt: null }));
    const r = buildSite(cfg, store);
    assert.equal(r.articles, 13);
    assert.equal(r.pages, 2);
    const out = cfg.outputDir;
    assert.ok(fs.existsSync(path.join(out, 'articles', 'article-number-one', 'index.html')));
    assert.ok(fs.existsSync(path.join(out, 'articles', 'page', '2', 'index.html')));
    assert.ok(!fs.existsSync(path.join(out, 'articles', 'draft-only-article')), 'drafts are never rendered publicly');
    const sitemap = fs.readFileSync(path.join(out, 'sitemap-articles.xml'), 'utf8');
    assert.ok(sitemap.includes('<loc>https://www.aislabz.com/articles/article-number-one/</loc>'));
    assert.ok(!sitemap.includes('draft-only-article'));
    const page1 = fs.readFileSync(path.join(out, 'articles', 'index.html'), 'utf8');
    assert.ok(page1.includes('rel="next" href="/articles/page/2/"'));
    assert.ok(page1.includes('article-number-thirteen'), 'newest first');

    // A hand-made directory without the marker must never be deleted.
    fs.mkdirSync(path.join(out, 'articles', 'manual-page'));
    store.saveArticle({ ...store.getArticle('art_x0'), status: 'unpublished' });
    const r2 = buildSite(cfg, store);
    assert.deepEqual(r2.removed, ['article-number-one']);
    assert.ok(fs.existsSync(path.join(out, 'articles', 'manual-page')));
    assert.equal(r2.pages, 1);
    assert.ok(!fs.existsSync(path.join(out, 'articles', 'page', '2')));
  } finally { cleanup(); }
});

test('index page 1 renders the topic hub: cluster articles, existing blog pages, owning service; empty clusters skipped', () => {
  const hubSite = {
    ...site,
    services: [{ name: 'AI Consulting', url: '/services/ai-consulting/' }],
    topicClusters: [
      { id: 'AI-1', name: 'AI consulting & strategy', description: 'd', serviceUrl: '/services/ai-consulting/', relatedReading: [] },
      { id: 'S-1', name: 'Technical SEO', relatedReading: [{ url: '/blog/technical-seo-explained/', title: 'Technical SEO Explained' }, { url: 'javascript:alert(1)', title: 'bad' }] },
      { id: 'AI-5', name: 'Empty cluster', relatedReading: [] },
    ],
  };
  const a = article({ clusterId: 'AI-1' });
  const html = renderIndexPage([a], { site: hubSite, page: 1, totalPages: 2, allArticles: [a] });
  assert.ok(html.includes('id="topic-ai-1"') && html.includes('href="#topic-ai-1"'));
  assert.ok(html.includes('<li><a href="/articles/ai-consulting-explained/">'));
  assert.ok(html.includes('href="/blog/technical-seo-explained/"'));
  assert.ok(html.includes('Related service: <a href="/services/ai-consulting/">AI Consulting</a>'));
  assert.ok(!html.includes('Empty cluster'), 'clusters with nothing to link are skipped');
  assert.ok(!html.includes('javascript:'), 'unsafe related-reading URLs are dropped');
  assert.ok(!renderIndexPage([a], { site: hubSite, page: 2, totalPages: 2, allArticles: [a] }).includes('ae-clusters'), 'hub only on page 1');
});

test('related articles prefer the same keyword cluster', async () => {
  const { relatedArticles } = await import('../src/render/build.js');
  const base = article({ id: 'art_base', clusterId: 'AI-2', primaryTopic: 'X' });
  const sameCluster = article({ id: 'art_same', clusterId: 'AI-2', primaryTopic: 'Y', publishedAt: '2026-01-01T00:00:00.000Z' });
  const sameTopic = article({ id: 'art_topic', clusterId: 'AI-3', primaryTopic: 'X', publishedAt: '2026-12-01T00:00:00.000Z' });
  assert.deepEqual(relatedArticles(base, [base, sameTopic, sameCluster]).map((a) => a.id), ['art_same', 'art_topic']);
});
