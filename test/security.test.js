import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createAdminServer } from '../src/admin/server.js';
import { hashPassword, verifyPassword, createSession, readSession } from '../src/admin/auth.js';
import { redact, createLogger } from '../src/lib/logger.js';
import { assertPublicUrl } from '../src/lib/http.js';
import { signJwt } from '../src/gsc/client.js';
import { validate } from '../src/lib/validate.js';
import { setup, silentLogger } from './helpers.js';

const PASSWORD = 'correct horse battery staple';
const SECRET = 's'.repeat(48);

async function withServer(fn, env = {}) {
  const ctx = await setup({ ADMIN_USERNAME: 'editor', ADMIN_PASSWORD_HASH: hashPassword(PASSWORD), ADMIN_SESSION_SECRET: SECRET, CRON_SECRET: 'cron-secret-value-123456', ...env });
  const server = createAdminServer(ctx.cfg, ctx.store, { logger: silentLogger, deps: { logger: silentLogger } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ base, ...ctx }); } finally { server.close(); ctx.cleanup(); }
}

const req = (url, opts = {}) => fetch(url, { redirect: 'manual', ...opts });
const form = (o) => new URLSearchParams(o).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

async function login(base) {
  const res = await req(`${base}/login`, { method: 'POST', headers: FORM, body: form({ username: 'editor', password: PASSWORD }) });
  assert.equal(res.status, 303);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const dash = await (await req(`${base}/`, { headers: { cookie } })).text();
  const csrf = dash.match(/name="csrf" value="([^"]+)"/)[1];
  return { cookie, csrf, dash };
}

test('password hashing and signed sessions', () => {
  const h = hashPassword(PASSWORD);
  assert.ok(h.startsWith('scrypt$'));
  assert.ok(verifyPassword(PASSWORD, h));
  assert.ok(!verifyPassword('wrong', h));
  const s = createSession(SECRET, 'editor');
  assert.equal(readSession(SECRET, s).u, 'editor');
  assert.equal(readSession(SECRET, s.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))), null, 'tampered signature rejected');
  assert.equal(readSession('x'.repeat(48), s), null, 'other secret rejected');
});

test('admin requires authentication; bad credentials rejected; login is rate limited', async () => {
  await withServer(async ({ base }) => {
    const r = await req(`${base}/`);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/login');
    const bad = await req(`${base}/login`, { method: 'POST', headers: FORM, body: form({ username: 'editor', password: 'nope' }) });
    assert.equal(bad.status, 401);
    for (let i = 0; i < 4; i++) await req(`${base}/login`, { method: 'POST', headers: FORM, body: form({ username: 'x', password: 'y' }) });
    const limited = await req(`${base}/login`, { method: 'POST', headers: FORM, body: form({ username: 'editor', password: PASSWORD }) });
    assert.equal(limited.status, 429);
  });
});

test('dashboard renders for authenticated users without exposing secrets; strict security headers', async () => {
  await withServer(async ({ base }) => {
    const { cookie, dash } = await login(base);
    assert.ok(dash.includes('Topic queue'));
    assert.ok(dash.includes('AI Consulting Explained'));
    assert.ok(!dash.includes(SECRET));
    assert.ok(!dash.includes('cron-secret-value'));
    const res = await req(`${base}/`, { headers: { cookie } });
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  });
});

test('state-changing actions require a valid CSRF token', async () => {
  await withServer(async ({ base, store }) => {
    const { cookie, csrf } = await login(base);
    const noToken = await req(`${base}/actions/pause`, { method: 'POST', headers: { ...FORM, cookie }, body: form({}) });
    assert.equal(noToken.status, 403);
    assert.equal(store.getState().paused, false);
    const ok = await req(`${base}/actions/pause`, { method: 'POST', headers: { ...FORM, cookie }, body: form({ csrf }) });
    assert.equal(ok.status, 303);
    assert.equal(store.getState().paused, true);
    const add = await req(`${base}/actions/add-topic`, { method: 'POST', headers: { ...FORM, cookie }, body: form({ csrf, topic: '<script>x</script> Data strategy for AI', primaryQuery: 'data strategy for ai', priority: '11' }) });
    assert.equal(add.status, 303);
    const dash = await (await req(`${base}/`, { headers: { cookie } })).text();
    assert.ok(!dash.includes('<script>x</script>'), 'topic text is escaped');
    assert.ok(dash.includes('&lt;script&gt;x&lt;/script&gt;'));
    const dup = await req(`${base}/actions/add-topic`, { method: 'POST', headers: { ...FORM, cookie }, body: form({ csrf, topic: 'Another one about data strategy', primaryQuery: 'Data Strategy for AI' }) });
    assert.match(decodeURIComponent(dup.headers.get('location')), /duplicate search intent/);
  });
});

test('approve action refuses articles that did not pass the gate', async () => {
  await withServer(async ({ base, store }) => {
    store.saveArticle({ id: 'art_bad1', title: 'Rejected', slug: 'rejected-article', status: 'qa_failed', qaStatus: 'failed' });
    const { cookie, csrf } = await login(base);
    const r = await req(`${base}/actions/approve`, { method: 'POST', headers: { ...FORM, cookie }, body: form({ csrf, id: 'art_bad1' }) });
    assert.match(decodeURIComponent(r.headers.get('location')), /Error: Only drafts that passed/);
    assert.equal(store.getArticle('art_bad1').status, 'qa_failed');
  });
});

test('cron endpoint requires the bearer secret', async () => {
  await withServer(async ({ base }) => {
    assert.equal((await req(`${base}/cron/run`, { method: 'POST' })).status, 401);
    assert.equal((await req(`${base}/cron/run`, { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await req(`${base}/cron/run`, { method: 'GET' })).status, 405);
    const ok = await req(`${base}/cron/run`, { method: 'POST', headers: { authorization: 'Bearer cron-secret-value-123456' } });
    assert.equal(ok.status, 202);
  }, { ARTICLE_ENGINE_ENABLED: 'false' });
});

test('admin refuses to run without configured credentials', async () => {
  const ctx = await setup();
  const server = createAdminServer(ctx.cfg, ctx.store, { logger: silentLogger });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const r = await req(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(r.status, 503);
  } finally { server.close(); ctx.cleanup(); }
});

test('preview route cannot traverse outside the preview directory', async () => {
  await withServer(async ({ base }) => {
    const { cookie } = await login(base);
    const r = await req(`${base}/preview/..%2f..%2fconfig%2fsite.json`, { headers: { cookie } });
    assert.equal(r.status, 404);
  });
});

test('logger redacts secrets, bearer tokens and private keys', () => {
  process.env.TEST_API_KEY = 'sk-test-abcdefghijklmnop';
  const lines = [];
  const log = createLogger({}, (l) => lines.push(l));
  log.info('calling', { header: 'Bearer abcdefghijklmnop123', key: process.env.TEST_API_KEY, pk: '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----' });
  assert.ok(!lines[0].includes('sk-test-abcdefghijklmnop'));
  assert.ok(!lines[0].includes('abcdefghijklmnop123'));
  assert.ok(!lines[0].includes('MIIabc'));
  assert.ok(redact('{"x-api-key":"abc12345678"}').includes('[REDACTED]'));
  delete process.env.TEST_API_KEY;
});

test('outbound fetch guard blocks private addresses and non-http schemes', async () => {
  await assert.rejects(assertPublicUrl('http://127.0.0.1/admin'), /Blocked/);
  await assert.rejects(assertPublicUrl('http://169.254.169.254/latest/meta-data'), /Blocked/);
  await assert.rejects(assertPublicUrl('file:///etc/passwd'), /Blocked protocol/);
  await assert.rejects(assertPublicUrl('http://localhost:8787'), /Blocked host/);
  await assert.rejects(assertPublicUrl('https://internal.example', { lookup: async () => [{ address: '10.0.0.5' }] }), /Blocked private/);
  const ok = await assertPublicUrl('https://www.nist.gov/', { lookup: async () => [{ address: '129.6.13.49' }] });
  assert.equal(ok.hostname, 'www.nist.gov');
});

test('Search Console JWT is RS256-signed and verifiable', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { client_email: 'svc@project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const jwt = signJwt(sa, 1_700_000_000);
  const [h, c, s] = jwt.split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url')));
  const claim = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.equal(claim.scope, 'https://www.googleapis.com/auth/webmasters');
  assert.equal(claim.exp - claim.iat, 3600);
});

test('schema validator reports nested errors', () => {
  const schema = { type: 'object', required: ['a'], properties: { a: { type: 'array', items: { type: 'string', enum: ['x'] } } } };
  assert.deepEqual(validate({ a: ['x'] }, schema), []);
  assert.ok(validate({ a: ['y', 1] }, schema).length === 2);
  assert.ok(validate({}, schema)[0].includes('required'));
});
