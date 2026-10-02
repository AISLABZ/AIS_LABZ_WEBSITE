import { safeFetch } from '../lib/http.js';
import { extractLinks, isInternalHref, safeHref } from '../render/blocks.js';

/**
 * Validate every link in an article.
 *  - internal: must be a known inventory path or resolve with HTTP 200 on the live site
 *  - external: must resolve (2xx after redirects). 401/403/429 are treated as
 *    "bot-protected" warnings only when the same URL was fetched successfully
 *    during research (i.e. it is known to exist); otherwise they are failures.
 */
export async function validateLinks(article, { site, inventory, research, fetchPage = (u, o) => safeFetch(u, { timeoutMs: 15000, maxBytes: 200_000, ...o }), concurrency = 4 } = {}) {
  const researched = new Set((research?.claims || []).map((c) => c.sourceUrl));
  const knownPaths = new Set(inventory.pages.filter((p) => !p.fetchError && (!p.status || p.status === 200)).map((p) => p.path));
  const links = [...extractLinks(article.content), ...extractLinks(article.cta ? [{ text: article.cta.text }] : [])];
  if (article.cta?.href) links.push({ text: 'CTA', href: article.cta.href });
  for (const s of article.sources || []) links.push({ text: s.title, href: s.url });

  const unique = [...new Map(links.map((l) => [l.href, l])).values()];
  const results = [];
  const queue = [...unique];
  async function worker() {
    while (queue.length) {
      const l = queue.shift();
      const href = safeHref(l.href);
      if (!href) { results.push({ ...l, kind: 'invalid', ok: false, critical: true, reason: 'unsafe or malformed URL' }); continue; }
      const internal = isInternalHref(href, site.siteUrl);
      const path = internal ? new URL(href, site.siteUrl).pathname.replace(/\/+$/, '') || '/' : null;
      if (internal && knownPaths.has(path)) { results.push({ ...l, kind: 'internal', ok: true, reason: 'in inventory' }); continue; }
      const url = internal ? new URL(href, site.siteUrl).toString() : href;
      try {
        let res = await fetchPage(url, { method: 'HEAD' });
        if (res.status === 405 || res.status === 403 || res.status === 400) res = await fetchPage(url, { method: 'GET' });
        if (res.ok) { results.push({ ...l, kind: internal ? 'internal' : 'external', ok: true, status: res.status }); continue; }
        if ([401, 403, 429].includes(res.status) && researched.has(href)) {
          results.push({ ...l, kind: 'external', ok: true, status: res.status, warning: 'bot-protected; verified during research' });
          continue;
        }
        results.push({ ...l, kind: internal ? 'internal' : 'external', ok: false, critical: true, status: res.status, reason: `HTTP ${res.status}` });
      } catch (err) {
        results.push({ ...l, kind: internal ? 'internal' : 'external', ok: false, critical: true, reason: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length || 1) }, worker));
  const failures = results.filter((r) => !r.ok);
  return { ok: failures.length === 0, checked: results.length, failures, results };
}
