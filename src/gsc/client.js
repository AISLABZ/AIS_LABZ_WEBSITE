import crypto from 'node:crypto';
import { apiJson } from '../lib/http.js';

const SCOPE = 'https://www.googleapis.com/auth/webmasters';

export class GscNotConfiguredError extends Error {
  constructor() { super('Search Console is not configured (GOOGLE_SEARCH_CONSOLE_PROPERTY, GOOGLE_SERVICE_ACCOUNT_JSON)'); this.name = 'GscNotConfiguredError'; }
}

function parseServiceAccount(raw) {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(text);
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email/private_key');
  return sa;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export function signJwt(sa, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claim}`), sa.private_key);
  return `${header}.${claim}.${b64url(sig)}`;
}

/**
 * Search Console API client (service account). Read-only reporting plus
 * sitemap submission. Does NOT use the Google Indexing API.
 */
export function createGscClient(cfg, { fetchImpl = fetch } = {}) {
  if (!cfg.gsc.property || !cfg.gsc.serviceAccountJson) throw new GscNotConfiguredError();
  const sa = parseServiceAccount(cfg.gsc.serviceAccountJson);
  const property = cfg.gsc.property;
  let token = null;
  let tokenExp = 0;

  async function accessToken() {
    if (token && Date.now() < tokenExp - 60000) return token;
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(sa) }),
    });
    const json = await res.json();
    if (!res.ok || !json.access_token) throw new Error(`Search Console auth failed: HTTP ${res.status} ${json.error || ''}`);
    token = json.access_token;
    tokenExp = Date.now() + (json.expires_in || 3600) * 1000;
    return token;
  }

  const site = encodeURIComponent(property);
  const auth = async () => ({ authorization: `Bearer ${await accessToken()}` });

  return {
    property,
    /** Search Analytics query: dimensions e.g. ['page'], ['page','query'], ['date','page']. */
    async searchAnalytics({ startDate, endDate, dimensions, filters = [], rowLimit = 1000 }) {
      const res = await apiJson(`https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, {
        headers: await auth(),
        body: { startDate, endDate, dimensions, rowLimit, dimensionFilterGroups: filters.length ? [{ filters }] : undefined, dataState: 'final' },
        fetchImpl,
      });
      return res.rows || [];
    },
    /** URL Inspection API: index/coverage diagnostics as reported by Google. */
    async inspectUrl(url) {
      const res = await apiJson('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        headers: await auth(),
        body: { inspectionUrl: url, siteUrl: property },
        fetchImpl,
      });
      return res.inspectionResult || {};
    },
    async submitSitemap(sitemapUrl) {
      await apiJson(`https://www.googleapis.com/webmasters/v3/sites/${site}/sitemaps/${encodeURIComponent(sitemapUrl)}`, { method: 'PUT', headers: await auth(), fetchImpl });
      return { submitted: sitemapUrl };
    },
  };
}

/** Best-effort sitemap (re)submission after a verified publication. Never throws. */
export async function submitArticlesSitemap(cfg, { client } = {}) {
  try {
    const gsc = client || createGscClient(cfg);
    return await gsc.submitSitemap(`${cfg.site.siteUrl}/sitemap-articles.xml`);
  } catch (err) {
    return { submitted: null, skipped: err.message };
  }
}
