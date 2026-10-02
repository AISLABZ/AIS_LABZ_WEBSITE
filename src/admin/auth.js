import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'base64url');
  const expected = Buffer.from(parts[3], 'base64url');
  const actual = crypto.scryptSync(String(password), salt, expected.length, { N, r: SCRYPT.r, p: SCRYPT.p });
  return crypto.timingSafeEqual(actual, expected);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

export function createSession(secret, username, ttlMs = 8 * 3600 * 1000) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + ttlMs, n: crypto.randomBytes(12).toString('base64url') })).toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}

export function readSession(secret, cookieValue) {
  if (!secret || !cookieValue || !cookieValue.includes('.')) return null;
  const [payload, sig] = cookieValue.split('.');
  if (!safeEqual(sig, hmac(secret, payload))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}

/** CSRF token bound to the session nonce (stateless, unguessable without the secret). */
export function csrfToken(secret, session) { return hmac(secret, `csrf:${session.n}`); }

export function verifyCsrf(secret, session, token) { return Boolean(session && token && safeEqual(token, csrfToken(secret, session))); }

/** Fixed-window in-memory rate limiter. */
export function rateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now > h.reset) { hits.set(key, { count: 1, reset: now + windowMs }); return true; }
    h.count++;
    if (hits.size > 10000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return h.count <= limit;
  };
}

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v !== undefined).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
