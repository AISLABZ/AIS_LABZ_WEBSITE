import { safeFetch, extractHtml } from '../lib/http.js';
import { liveArticles } from '../render/build.js';

function locs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
}

/**
 * Current inventory of AISLabz URLs: live sitemap(s) + configured services and
 * pillar pages + the engine's own articles. Used for internal linking,
 * cannibalization checks and link validation.
 */
export async function buildInventory(cfg, store, { fetchPage = (u) => safeFetch(u, { timeoutMs: 15000 }), logger, maxUrls = 300, maxTitleFetches = 40 } = {}) {
  const site = cfg.site;
  const host = new URL(site.siteUrl).host;
  const pages = new Map();
  const add = (url, data) => {
    try {
      const u = new URL(url, site.siteUrl);
      if (u.host !== host) return;
      u.hash = '';
      const key = u.pathname.replace(/\/+$/, '') || '/';
      pages.set(key, { ...(pages.get(key) || {}), path: key, url: u.toString(), ...data });
    } catch { /* ignore bad url */ }
  };

  const errors = [];
  // 1. Live sitemap (sitemap index aware, bounded).
  const queue = [`${site.siteUrl}/sitemap.xml`];
  const visited = new Set();
  while (queue.length && visited.size < 10 && pages.size < maxUrls) {
    const sm = queue.shift();
    if (visited.has(sm)) continue;
    visited.add(sm);
    try {
      const res = await fetchPage(sm);
      if (!res.ok) { errors.push(`${sm}: HTTP ${res.status}`); continue; }
      if (/<sitemapindex/i.test(res.body)) queue.push(...locs(res.body).filter((l) => !/sitemap-articles\.xml$/.test(l)));
      else locs(res.body).slice(0, maxUrls).forEach((l) => add(l, { type: 'page', source: 'sitemap' }));
    } catch (err) {
      errors.push(`${sm}: ${err.message}`);
    }
  }

  // 2. Configured pages (authoritative for services/capabilities).
  for (const s of site.services || []) add(s.url, { type: 'service', title: s.name, service: s });
  for (const p of site.pillarPages || []) add(p.url, { type: 'pillar', title: p.title });
  for (const n of site.navigation || []) add(n.href, { type: pages.get(n.href)?.type || 'page', title: pages.get(n.href)?.title || n.label });

  // 3. Engine articles (any live status).
  for (const a of liveArticles(store)) add(`/articles/${a.slug}/`, { type: 'article', title: a.title, articleId: a.id, primaryTopic: a.primaryTopic, primaryQuery: a.generationMetadata?.primaryQuery });

  // 4. Titles for sitemap pages without one (bounded).
  const untitled = [...pages.values()].filter((p) => !p.title && p.type === 'page').slice(0, maxTitleFetches);
  for (const p of untitled) {
    try {
      const res = await fetchPage(p.url);
      if (res.ok) {
        const { title } = extractHtml(res.body);
        p.title = title;
        p.status = res.status;
      } else {
        p.status = res.status;
      }
    } catch (err) {
      p.fetchError = err.message;
    }
  }
  if (errors.length) logger?.warn('inventory: sitemap issues', { errors });
  return { generatedAt: new Date().toISOString(), pages: [...pages.values()], errors };
}
