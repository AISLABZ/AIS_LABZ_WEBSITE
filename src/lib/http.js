import dns from 'node:dns/promises';
import net from 'node:net';

export const USER_AGENT = 'AISLabzArticlesEngine/1.0 (+https://www.aislabz.com/articles/)';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Refuse non-http(s) URLs and hosts resolving to private/loopback ranges (SSRF guard). */
export async function assertPublicUrl(rawUrl, { lookup = dns.lookup } = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error(`Invalid URL: ${rawUrl}`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`Blocked protocol: ${u.protocol}`);
  if (u.username || u.password) throw new Error('Credentials in URL are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error(`Blocked host: ${host}`);
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error(`Blocked private address for ${host}`);
  return u;
}

/**
 * fetch() with timeout, manual redirect following (each hop re-checked
 * against the SSRF guard) and a response size cap.
 */
export async function safeFetch(url, { method = 'GET', headers = {}, timeoutMs = 15000, maxBytes = 3_000_000, maxRedirects = 5, fetchImpl = fetch, lookup, skipSsrfCheck = false } = {}) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!skipSsrfCheck) await assertPublicUrl(current, lookup ? { lookup } : {});
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(current, { method, headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', ...headers }, redirect: 'manual', signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    let body = '';
    if (method !== 'HEAD' && res.body) {
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); break; }
        chunks.push(value);
      }
      body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, url: current, headers: res.headers, body };
  }
  throw new Error(`Too many redirects for ${url}`);
}

/** JSON API call with timeout (for trusted, fixed API hosts). Never logs headers. */
export async function apiJson(url, { method = 'POST', headers = {}, body, timeoutMs = 120000, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 500) }; }
    if (!res.ok) {
      const err = new Error(`API ${new URL(url).host} responded ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** Extract readable text + metadata from an HTML document. */
export function extractHtml(html) {
  const meta = (name) => {
    const re = new RegExp(`<meta[^>]+(?:name|property|itemprop)=["']${name}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    return tag?.match(/content=["']([^"']*)["']/i)?.[1]?.trim() || '';
  };
  const title = (meta('og:title') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  let published = meta('article:published_time') || meta('datePublished') || meta('date') || meta('dc.date') || '';
  if (!published) published = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] || '';
  const publisher = meta('og:site_name') || '';
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return { title, published: published.slice(0, 40), publisher, text };
}

export async function retry(fn, { attempts = 2, delayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(i); } catch (err) {
      lastErr = err;
      // Never retry client errors (except 429): they will not succeed on retry.
      if (err.status && err.status < 500 && err.status !== 429) break;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * 2 ** i));
    }
  }
  throw lastErr;
}
