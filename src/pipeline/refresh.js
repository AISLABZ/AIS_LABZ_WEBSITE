import { liveArticles } from '../render/build.js';
import { blocksToPlainText, tokens } from '../lib/text.js';

const DAY = 86400000;

/**
 * Content refresh engine: identifies update opportunities. It never rewrites
 * articles and never changes dates. Articles with broken sources are marked
 * `needs_update` (still live) so an editor can fix them.
 */
export async function analyzeRefresh(cfg, store, { gsc = null, checkSources = null, now = new Date() } = {}) {
  const candidates = [];
  for (const a of liveArticles(store)) {
    const reasons = [];
    const lastTouched = new Date(a.updatedAt || a.publishedAt);
    if (now - lastTouched > 365 * DAY) reasons.push({ type: 'age_review', severity: 'medium', detail: 'Over 12 months since last substantive update: re-verify facts and sources.' });

    if (checkSources) {
      const report = await checkSources(a);
      const broken = report.failures.filter((f) => (a.sources || []).some((s) => s.url === f.href));
      if (broken.length) reasons.push({ type: 'broken_sources', severity: 'high', detail: broken.map((b) => `${b.href} (${b.reason || b.status})`).join(', ') });
      const brokenInternal = report.failures.filter((f) => f.kind === 'internal');
      if (brokenInternal.length) reasons.push({ type: 'broken_internal_links', severity: 'high', detail: brokenInternal.map((b) => b.href).join(', ') });
    }

    const sc = a.searchConsoleData;
    if (sc) {
      const daysLive = (now - new Date(a.publishedAt)) / DAY;
      const avgPos = sc.topQueries?.length ? sc.topQueries.reduce((s, q) => s + q.position, 0) / sc.topQueries.length : null;
      if (daysLive > 28 && sc.impressions >= 200 && sc.ctr < 0.015 && avgPos !== null && avgPos <= 12) {
        reasons.push({ type: 'low_ctr', severity: 'medium', detail: `${sc.impressions} impressions, CTR ${(sc.ctr * 100).toFixed(2)}% at avg position ${avgPos.toFixed(1)}: test a clearer title/meta description.` });
      }
      const body = new Set(tokens(blocksToPlainText(a.content)));
      const unanswered = (sc.topQueries || []).filter((q) => q.impressions >= 50).filter((q) => {
        const t = tokens(q.query);
        return t.length && t.filter((w) => body.has(w)).length / t.length < 0.6;
      });
      if (unanswered.length) reasons.push({ type: 'unanswered_queries', severity: 'medium', detail: `Queries not well covered: ${unanswered.map((q) => q.query).join('; ')}` });
    }
    if (gsc?.cannibalization) {
      const url = `${cfg.site.siteUrl}/articles/${a.slug}/`;
      const conflicts = gsc.cannibalization.filter((c) => c.pages.some((p) => p.page === url));
      if (conflicts.length) reasons.push({ type: 'possible_cannibalization', severity: 'medium', detail: conflicts.map((c) => `"${c.query}": ${c.pages.map((p) => p.page).join(' vs ')}`).join('; ') });
    }

    if (reasons.length) {
      candidates.push({ articleId: a.id, slug: a.slug, title: a.title, reasons });
      if (reasons.some((r) => r.severity === 'high') && a.status === 'published') {
        store.saveArticle({ ...a, status: 'needs_update', refreshReasons: reasons }, { note: 'refresh engine: high-severity issue' });
      } else {
        store.saveArticle({ ...a, refreshReasons: reasons });
      }
    }
  }
  const report = { generatedAt: now.toISOString(), candidates, suggestedTopics: (gsc?.unmatchedQueries || []).slice(0, 20) };
  store.writeJson(`refresh/${now.toISOString().slice(0, 10)}.json`, report);
  return report;
}
