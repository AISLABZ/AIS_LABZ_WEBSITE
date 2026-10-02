import { apiJson } from '../lib/http.js';

export class ResearchNotConfiguredError extends Error {
  constructor() { super('No research provider configured (set RESEARCH_PROVIDER and RESEARCH_API_KEY)'); this.name = 'ResearchNotConfiguredError'; }
}

async function braveSearch(query, { apiKey, count = 10, fetchImpl }) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&safesearch=strict`;
  const res = await apiJson(url, { method: 'GET', headers: { 'x-subscription-token': apiKey, accept: 'application/json' }, timeoutMs: 20000, fetchImpl });
  return (res.web?.results || []).map((r) => ({ title: r.title || '', url: r.url, snippet: r.description || '', publishedDate: r.page_age || r.age || '' }));
}

async function tavilySearch(query, { apiKey, count = 10, fetchImpl }) {
  const res = await apiJson('https://api.tavily.com/search', {
    headers: { authorization: `Bearer ${apiKey}` },
    body: { query, max_results: count, search_depth: 'advanced', include_answer: false },
    timeoutMs: 30000,
    fetchImpl,
  });
  return (res.results || []).map((r) => ({ title: r.title || '', url: r.url, snippet: r.content || '', publishedDate: r.published_date || '' }));
}

/** Returns a search function or throws ResearchNotConfiguredError. Never falls back to model memory. */
export function createSearchProvider(cfg, { fetchImpl = fetch, override } = {}) {
  if (override) return override;
  const { provider, apiKey } = cfg.research;
  if (!provider || !apiKey) throw new ResearchNotConfiguredError();
  if (provider === 'brave') return (q, o = {}) => braveSearch(q, { apiKey, fetchImpl, ...o });
  if (provider === 'tavily') return (q, o = {}) => tavilySearch(q, { apiKey, fetchImpl, ...o });
  throw new Error(`Unsupported RESEARCH_PROVIDER "${provider}" (use "brave" or "tavily")`);
}
