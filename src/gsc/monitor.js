import { articleUrl } from '../render/schema.js';
import { liveArticles } from '../render/build.js';

function isoDate(d) { return d.toISOString().slice(0, 10); }

/**
 * Pull Search Console data for every live article, store it per article/date,
 * and return site-level query opportunities for topic selection.
 * Search Console data lags ~2–3 days; we query a 28-day window ending 3 days ago.
 */
export async function collectSearchConsole(cfg, store, gsc, { now = new Date(), inspect = true, logger } = {}) {
  const end = new Date(now.getTime() - 3 * 86400000);
  const start = new Date(end.getTime() - 27 * 86400000);
  const range = { startDate: isoDate(start), endDate: isoDate(end) };
  const articles = liveArticles(store);
  const byUrl = new Map(articles.map((a) => [articleUrl(cfg.site.siteUrl, a.slug), a]));

  const daily = await gsc.searchAnalytics({ ...range, dimensions: ['date', 'page'], rowLimit: 5000 });
  const queries = await gsc.searchAnalytics({ ...range, dimensions: ['page', 'query'], rowLimit: 5000 });
  const siteQueries = await gsc.searchAnalytics({ ...range, dimensions: ['query'], rowLimit: 500 });

  const summaries = {};
  for (const a of articles) {
    const url = articleUrl(cfg.site.siteUrl, a.slug);
    const data = store.getSearchConsole(a.id);
    for (const r of daily.filter((r) => r.keys[1] === url)) {
      data.daily[r.keys[0]] = { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position };
    }
    data.queries = {};
    for (const r of queries.filter((r) => r.keys[0] === url)) {
      data.queries[r.keys[1]] = { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, range };
    }
    if (inspect) {
      try {
        const res = await gsc.inspectUrl(url);
        const idx = res.indexStatusResult || {};
        // Stored verbatim. We never derive or invent an "indexed" status.
        data.inspections = [...(data.inspections || []), { at: now.toISOString(), verdict: idx.verdict, coverageState: idx.coverageState, indexingState: idx.indexingState, lastCrawlTime: idx.lastCrawlTime, googleCanonical: idx.googleCanonical, robotsTxtState: idx.robotsTxtState, pageFetchState: idx.pageFetchState }].slice(-20);
      } catch (err) {
        logger?.warn('url inspection failed', { url, err });
      }
    }
    data.updatedAt = now.toISOString();
    store.saveSearchConsole(a.id, data);

    const totals = Object.values(data.queries).reduce((t, q) => ({ clicks: t.clicks + q.clicks, impressions: t.impressions + q.impressions }), { clicks: 0, impressions: 0 });
    summaries[a.id] = { range, ...totals, ctr: totals.impressions ? totals.clicks / totals.impressions : 0, topQueries: Object.entries(data.queries).sort((x, y) => y[1].impressions - x[1].impressions).slice(0, 10).map(([q, v]) => ({ query: q, ...v })), lastInspection: data.inspections?.at(-1) || null };
    store.saveArticle({ ...store.getArticle(a.id), searchConsoleData: summaries[a.id] });
  }

  // Multiple AISLabz pages ranking for the same query → possible cannibalization.
  const pagesPerQuery = {};
  for (const r of queries) (pagesPerQuery[r.keys[1]] ||= []).push({ page: r.keys[0], impressions: r.impressions, position: r.position });
  const cannibalization = Object.entries(pagesPerQuery)
    .filter(([, pages]) => pages.filter((p) => p.impressions >= 10).length > 1)
    .map(([query, pages]) => ({ query, pages }));

  const opportunities = siteQueries
    .map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
    .filter((q) => q.impressions >= 20)
    .sort((a, b) => b.impressions - a.impressions);

  const unmatched = opportunities.filter((q) => !queries.some((r) => r.keys[1] === q.query && byUrl.has(r.keys[0])));
  return { range, summaries, opportunities, unmatchedQueries: unmatched.slice(0, 50), cannibalization };
}
