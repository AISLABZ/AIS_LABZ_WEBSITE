import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSearchConsole } from '../src/gsc/monitor.js';
import { analyzeRefresh } from '../src/pipeline/refresh.js';
import { proposeBacklinks } from '../src/pipeline/internal-links.js';
import { setup, goodDraft } from './helpers.js';

function live(store, over) {
  const d = goodDraft();
  return store.saveArticle({ id: 'art_a1', title: d.title, slug: 'ai-consulting-explained', seoTitle: 'AI Consulting Explained', metaDescription: 'x'.repeat(120), excerpt: d.excerpt, content: d.content, status: 'published', qaStatus: 'passed', publishedAt: '2025-01-01T08:00:00.000Z', updatedAt: null, primaryTopic: 'AI Consulting', secondaryTopics: [], sources: [{ title: 'NIST', url: 'https://www.nist.gov/itl/ai-risk-management-framework', accessedDate: '2025-01-01' }], generationMetadata: { primaryQuery: 'ai consulting' }, ...over });
}

test('Search Console data is stored per article/date; inspection stored verbatim (no invented INDEXED)', async () => {
  const { cfg, store, cleanup } = await setup();
  try {
    live(store);
    const url = 'https://www.aislabz.com/articles/ai-consulting-explained/';
    const gsc = {
      async searchAnalytics({ dimensions }) {
        if (dimensions.join() === 'date,page') return [{ keys: ['2026-09-20', url], clicks: 3, impressions: 400, ctr: 0.0075, position: 6.2 }];
        if (dimensions.join() === 'page,query') return [{ keys: [url, 'ai consulting'], clicks: 3, impressions: 400, ctr: 0.0075, position: 6.2 }, { keys: [url, 'ai consultant pricing models'], clicks: 0, impressions: 90, ctr: 0, position: 9 }, { keys: ['https://www.aislabz.com/consulting', 'ai consulting'], clicks: 1, impressions: 50, ctr: 0.02, position: 8 }];
        return [{ keys: ['ai consulting'], clicks: 4, impressions: 450, ctr: 0.009, position: 6 }, { keys: ['agentic workflows'], clicks: 0, impressions: 60, ctr: 0, position: 30 }];
      },
      async inspectUrl() { return { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' } }; },
    };
    const r = await collectSearchConsole(cfg, store, gsc, { now: new Date('2026-10-02T00:00:00Z') });
    const sc = store.getSearchConsole('art_a1');
    assert.deepEqual(sc.daily['2026-09-20'], { clicks: 3, impressions: 400, ctr: 0.0075, position: 6.2 });
    assert.equal(sc.inspections.at(-1).coverageState, 'Discovered - currently not indexed');
    assert.equal(r.cannibalization[0].query, 'ai consulting', 'two AISLabz pages for the same query are flagged');
    assert.deepEqual(r.unmatchedQueries.map((q) => q.query), ['agentic workflows']);

    const refresh = await analyzeRefresh(cfg, store, { gsc: r, now: new Date('2026-10-02T00:00:00Z'), checkSources: async () => ({ failures: [{ href: 'https://www.nist.gov/itl/ai-risk-management-framework', status: 404, kind: 'external' }] }) });
    const types = refresh.candidates[0].reasons.map((x) => x.type).sort();
    assert.deepEqual(types, ['age_review', 'broken_sources', 'low_ctr', 'possible_cannibalization', 'unanswered_queries']);
    const a = store.getArticle('art_a1');
    assert.equal(a.status, 'needs_update', 'broken sources flag the article for an editor');
    assert.equal(a.updatedAt, null, 'refresh analysis never fakes freshness');
  } finally { cleanup(); }
});

test('backlink proposals are suggestions unless AUTO_UPDATE_INTERNAL_LINKS=true', async () => {
  const { cfg, store, cleanup } = await setup();
  try {
    const older = live(store, { id: 'art_old1', slug: 'older-article', seoTitle: 'Older', content: [{ type: 'h2', text: 'Intro' }, { type: 'p', text: 'Many teams start with AI automation before they have a strategy.' }, { type: 'p', text: 'More.' }] });
    live(store, { id: 'art_new1', slug: 'ai-automation-business', seoTitle: 'New', publishedAt: '2026-10-06T08:00:00.000Z', primaryTopic: 'AI Automation', generationMetadata: { primaryQuery: 'ai automation' } });
    const p = proposeBacklinks(cfg, store, 'art_new1');
    assert.equal(p.applied, 0);
    assert.deepEqual(p.proposals.map((x) => [x.articleId, x.anchorText]), [['art_old1', 'AI automation']]);
    assert.equal(store.getArticle('art_old1').content[1].text, older.content[1].text, 'unchanged by default');
    const applied = proposeBacklinks({ ...cfg, autoUpdateInternalLinks: true }, store, 'art_new1');
    assert.equal(applied.applied, 1);
    assert.equal(store.getArticle('art_old1').content[1].text, 'Many teams start with [AI automation](/articles/ai-automation-business/) before they have a strategy.');
    assert.equal(store.getArticle('art_old1').updatedAt, null, 'adding a link is not a substantive update');
  } finally { cleanup(); }
});
