import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig, describeConfig } from '../config.js';
import { Store } from '../store/store.js';
import { migrate } from '../store/migrate.js';
import { escapeHtml } from '../lib/text.js';
import { createLogger } from '../lib/logger.js';
import { nextScheduledRun } from '../lib/time.js';
import { runPipeline, scheduledRun } from '../pipeline/run.js';
import * as actions from '../pipeline/actions.js';
import { verifyPassword, createSession, readSession, csrfToken, verifyCsrf, rateLimiter, parseCookies, safeEqual } from './auth.js';

const COOKIE = 'ae_admin';
const e = escapeHtml;

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow',
    ...headers,
  });
  res.end(body);
}

async function readBody(req, limit = 20000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(c);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

function page(title, body, nonce) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${e(title)} · Articles Engine</title>
<style nonce="${nonce}">
body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f6f7fb;color:#12141c}main{max-width:1200px;margin:0 auto;padding:16px}
header{background:#12141c;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}header a,header button{color:#fff}
section{background:#fff;border:1px solid #e3e6ee;border-radius:10px;padding:16px;margin:16px 0;overflow-x:auto}h1{font-size:1.1rem;margin:0}h2{font-size:1.05rem;margin:0 0 12px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:6px 8px;border-top:1px solid #eee;vertical-align:top}th{background:#fafafa}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;background:#eef;font-size:12px}.bad{background:#fde8e8}.good{background:#e6f6ec}.warn{background:#fff4d6}
form.inline{display:inline}button{cursor:pointer;border:1px solid #ccd;background:#fff;border-radius:6px;padding:4px 10px;font:inherit;font-size:13px}button.primary{background:#3b2fd9;color:#fff;border-color:#3b2fd9}button.danger{color:#b42318}
input,select,textarea{font:inherit;padding:4px 6px;border:1px solid #ccd;border-radius:6px;max-width:100%}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.muted{color:#5b6070}.flash{background:#e6f6ec;border:1px solid #9bd3ae;padding:8px 12px;border-radius:8px}.err{background:#fde8e8;border-color:#f3a5a5}pre{white-space:pre-wrap;}.w5{width:5em}.mt{margin-top:16px}.login{max-width:360px;margin:10vh auto}pre{font-size:12px;background:#fafafa;padding:8px;border-radius:6px}
</style></head><body>${body}</body></html>`;
}

function statusPill(s) {
  const cls = ['published', 'approved', 'passed', 'completed', 'APPROVED'].includes(s) ? 'good' : ['qa_failed', 'publication_failed', 'failed', 'rejected', 'REJECTED'].includes(s) ? 'bad' : ['needs_update', 'needs_review', 'needs_research', 'stopped', 'scheduled'].includes(s) ? 'warn' : '';
  return `<span class="pill ${cls}">${e(s || '—')}</span>`;
}

function actionForm(csrf, action, fields, label, cls = '') {
  const inputs = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${e(k)}" value="${e(v)}">`).join('');
  return `<form class="inline" method="post" action="/actions/${e(action)}"><input type="hidden" name="csrf" value="${e(csrf)}">${inputs}<button class="${cls}">${e(label)}</button></form>`;
}

function dashboard(cfg, store, csrf, flash) {
  const conf = describeConfig(cfg);
  const state = store.getState();
  const topics = store.listTopics().sort((a, b) => a.priority - b.priority);
  const articles = store.listArticles();
  const runs = store.listRuns(15);
  const current = articles.find((a) => ['researching', 'draft', 'approved', 'scheduled'].includes(a.status));
  const refreshFiles = fs.readdirSync(path.join(cfg.dataDir, 'refresh')).filter((f) => f.endsWith('.json')).sort();
  const refresh = refreshFiles.length ? store.readJson(`refresh/${refreshFiles.at(-1)}`) : null;
  const next = nextScheduledRun(new Date(), cfg);
  const month = new Date().toISOString().slice(0, 7);

  const cfgRows = Object.entries(conf).filter(([k]) => k !== 'outputDir').map(([k, v]) => `<tr><th>${e(k)}</th><td>${typeof v === 'boolean' ? statusPill(v ? 'yes' : 'no') : e(v)}</td></tr>`).join('');
  const topicRows = topics.map((t) => `<tr><td>${e(t.priority)}</td><td><strong>${e(t.topic)}</strong><br><span class="muted">${e(t.primaryQuery)} · ${e(t.searchIntent)}</span></td><td>${statusPill(t.status)}</td>
    <td><form class="inline" method="post" action="/actions/edit-topic"><input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="id" value="${e(t.id)}"><input name="priority" type="number" min="1" max="1000" value="${e(t.priority)}" class="w5" aria-label="Priority"><select name="status" aria-label="Status">${['queued', 'paused', 'needs_review', 'needs_research', 'suggested'].map((s) => `<option${s === t.status ? ' selected' : ''}>${s}</option>`).join('')}${['queued', 'paused', 'needs_review', 'needs_research', 'suggested'].includes(t.status) ? '' : `<option selected>${e(t.status)}</option>`}</select><button>Save</button></form>
    ${actionForm(csrf, 'generate', { topicId: t.id }, 'Generate now')}</td></tr>`).join('');
  const articleRows = articles.map((a) => `<tr><td><a href="/article/${e(a.id)}">${e(a.title)}</a><br><span class="muted">/articles/${e(a.slug || '—')}/</span></td><td>${statusPill(a.status)}</td><td>${statusPill(a.qaStatus)}</td><td>${e(a.researchReport ? `${a.researchReport.status} (${a.researchReport.claims.length} claims)` : '—')}</td><td>${e(a.searchConsoleData ? `${a.searchConsoleData.clicks} clicks / ${a.searchConsoleData.impressions} impr. / CTR ${(a.searchConsoleData.ctr * 100).toFixed(1)}%` : '—')}</td><td>${articleButtons(a, csrf)}</td></tr>`).join('');
  const runRows = runs.map((r) => `<tr><td>${e(r.startedAt?.replace('T', ' ').slice(0, 16))}</td><td>${e(r.trigger)}</td><td>${statusPill(r.status)} ${e(r.outcome || '')}</td><td>${e(r.selectedTopic || '')}</td><td>${e(r.reason || r.errors?.join('; ') || '')}</td><td>${e(Math.round((r.durationMs || 0) / 1000))}s</td><td>${['failed', 'stopped'].includes(r.status) ? actionForm(csrf, 'retry', { runId: r.runId }, 'Retry') : ''}</td></tr>`).join('');
  const refreshRows = (refresh?.candidates || []).map((c) => `<tr><td>${e(c.title)}</td><td>${c.reasons.map((r) => `${statusPill(r.type)} ${e(r.detail)}`).join('<br>')}</td></tr>`).join('');

  return `<header><h1>AISLabz Articles Engine</h1><div>${state.paused ? statusPill('paused') : statusPill('active')} ${actionForm(csrf, state.paused ? 'resume' : 'pause', {}, state.paused ? 'Resume automation' : 'Pause automation')} ${actionForm(csrf, 'generate', {}, 'Generate now', 'primary')} <form class="inline" method="post" action="/logout"><input type="hidden" name="csrf" value="${e(csrf)}"><button>Log out</button></form></div></header>
<main>${flash ? `<p class="flash ${flash.startsWith('Error') ? 'err' : ''}" role="status">${e(flash)}</p>` : ''}
<div class="grid"><section><h2>Schedule</h2><p>Next scheduled run: <strong>${e(next ? next.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—')}</strong><br><span class="muted">${e(conf.schedule)}</span></p><p>Auto-publish: ${statusPill(cfg.autoPublish ? 'on' : 'off (human approval)')}</p><p class="muted">LLM usage ${e(month)}: ${e(state.usage?.[month]?.tokens || 0)} tokens / ${e(state.usage?.[month]?.calls || 0)} calls</p></section>
<section><h2>Current article</h2>${current ? `<p><a href="/article/${e(current.id)}">${e(current.title)}</a><br>${statusPill(current.status)} QA ${statusPill(current.qaStatus)}</p>` : '<p class="muted">None in progress.</p>'}</section>
<section><h2>Configuration</h2><table>${cfgRows}</table></section></div>
<section><h2>Articles</h2><table><tr><th>Article</th><th>Status</th><th>QA</th><th>Research</th><th>Search Console (28d)</th><th>Actions</th></tr>${articleRows || '<tr><td colspan="6" class="muted">No articles yet.</td></tr>'}</table></section>
<section><h2>Topic queue</h2><table><tr><th>Priority</th><th>Topic</th><th>Status</th><th>Actions</th></tr>${topicRows}</table>
<h2 class="mt">Add topic</h2><form method="post" action="/actions/add-topic" class="grid"><input type="hidden" name="csrf" value="${e(csrf)}"><label>Topic<br><input name="topic" required minlength="10" maxlength="200"></label><label>Primary query<br><input name="primaryQuery" required minlength="3" maxlength="120"></label><label>Secondary queries (comma separated)<br><input name="secondaryQueries" maxlength="1000"></label><label>Intent<br><select name="searchIntent"><option>informational</option><option>commercial</option><option>transactional</option><option>navigational</option></select></label><label>Priority<br><input name="priority" type="number" min="1" max="1000" value="50"></label><label>Related service<br><input name="relatedService" maxlength="80"></label><label>Notes<br><textarea name="notes" maxlength="2000"></textarea></label><div><button class="primary">Add topic</button></div></form></section>
<section><h2>Recent runs</h2><table><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Topic</th><th>Reason / errors</th><th>Duration</th><th></th></tr>${runRows || '<tr><td colspan="7" class="muted">No runs yet.</td></tr>'}</table></section>
<section><h2>Content refresh opportunities</h2>${refreshRows ? `<table>${refreshRows}</table>` : '<p class="muted">None detected in the latest run.</p>'}${refresh?.suggestedTopics?.length ? `<h2 class="mt">Search Console queries without a matching article</h2><p class="muted">${refresh.suggestedTopics.map((q) => e(`${q.query} (${q.impressions} impr.)`)).join(' · ')}</p>` : ''}</section>
</main>`;
}

function articleButtons(a, csrf) {
  const b = [];
  if (a.status === 'draft' && a.qaStatus === 'passed') b.push(actionForm(csrf, 'approve', { id: a.id }, 'Approve', 'primary'));
  if (['approved', 'publication_failed'].includes(a.status)) b.push(actionForm(csrf, 'publish', { id: a.id }, 'Publish', 'primary'));
  if (a.status === 'scheduled') b.push(actionForm(csrf, 'verify', { id: a.id }, 'Verify live URL'));
  if (['draft', 'qa_failed', 'approved', 'idea', 'publication_failed'].includes(a.status)) b.push(actionForm(csrf, 'reject', { id: a.id }, 'Reject', 'danger'));
  if (['draft', 'qa_failed', 'rejected', 'idea'].includes(a.status) && a.topicId) b.push(actionForm(csrf, 'regenerate', { id: a.id }, 'Regenerate'));
  if (['published', 'scheduled', 'needs_update'].includes(a.status)) b.push(actionForm(csrf, 'unpublish', { id: a.id }, 'Unpublish', 'danger'));
  return b.join(' ');
}

function articleDetail(a, csrf) {
  const gate = a.qaReport?.gate;
  return `<header><h1><a href="/">← Dashboard</a></h1></header><main>
<section><h2>${e(a.title)}</h2><p>${statusPill(a.status)} QA ${statusPill(a.qaStatus)} ${gate ? statusPill(gate.decision) : ''}</p>
<p>${a.slug ? `<a href="/preview/articles/${e(a.slug)}/" target="_blank" rel="noopener">Open preview</a> · ` : ''}${e(a.wordCount || 0)} words · ${e(a.readingTime || 0)} min</p><p>${articleButtons(a, csrf)}</p>
<table><tr><th>SEO title</th><td>${e(a.seoTitle || '')}</td></tr><tr><th>Meta description</th><td>${e(a.metaDescription || '')}</td></tr><tr><th>Canonical</th><td>${e(a.canonicalUrl || '')}</td></tr><tr><th>Featured image brief</th><td>${e(a.featuredImageBrief ? `${a.featuredImageBrief.concept} — alt: ${a.featuredImageBrief.alt}` : '')}<br><span class="muted">${e(a.featuredImagePrompt || '')}</span></td></tr></table></section>
${gate ? `<section><h2>Publication gate</h2>${gate.reasons.length ? `<ul>${gate.reasons.map((r) => `<li>${e(r)}</li>`).join('')}</ul>` : '<p>All checks passed.</p>'}<table>${Object.entries(gate.checks).map(([k, v]) => `<tr><th>${e(k)}</th><td>${statusPill(v ? 'passed' : 'failed')}</td></tr>`).join('')}</table></section>` : ''}
${a.qaReport ? `<section><h2>QA issues</h2><table><tr><th>Severity</th><th>Type</th><th>Problem</th><th>Excerpt</th></tr>${[...(a.qaReport.deterministic?.issues || []), ...(a.qaReport.factCheck?.issues || [])].map((i) => `<tr><td>${statusPill(i.severity)}</td><td>${e(i.type)}</td><td>${e(i.problem)}</td><td>${e(i.excerpt)}</td></tr>`).join('') || '<tr><td colspan="4">None</td></tr>'}</table><p class="muted">Links: ${e(a.qaReport.links?.checked)} checked, ${e(a.qaReport.links?.failures?.length)} failing. SEO warnings: ${e((a.qaReport.seo?.warnings || []).join('; ') || 'none')}</p></section>` : ''}
${a.researchReport ? `<section><h2>Research (${e(a.researchReport.researchDate)}) — ${e(a.researchReport.status)}</h2><table><tr><th>ID</th><th>Claim</th><th>Source</th><th>Type</th><th>Confidence</th></tr>${a.researchReport.claims.map((c) => `<tr><td>${e(c.evidenceId)}</td><td>${e(c.claim)}<br><span class="muted">“${e(c.quote)}”</span></td><td><a href="${e(c.sourceUrl)}" rel="noopener noreferrer" target="_blank">${e(c.sourceTitle)}</a><br><span class="muted">${e(c.publisher)} ${e(c.publishedDate)}</span></td><td>${e(c.sourceType)}</td><td>${e(c.confidence)}</td></tr>`).join('')}</table><pre>${e(a.researchReport.notes.join('\n'))}</pre></section>` : ''}
${a.liveVerification ? `<section><h2>Live verification</h2><pre>${e(JSON.stringify(a.liveVerification, null, 2))}</pre></section>` : ''}
<section><h2>History</h2><pre>${e((a.history || []).map((h) => `${h.at} ${h.from} → ${h.to} ${h.note}`).join('\n'))}</pre></section></main>`;
}

function servePreview(cfg, res, urlPath) {
  const rel = decodeURIComponent(urlPath.replace(/^\/preview\//, ''));
  const target = path.resolve(cfg.previewDir, rel.endsWith('/') || rel === '' ? path.join(rel, 'index.html') : rel);
  if (!target.startsWith(cfg.previewDir + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return send(res, 404, 'Not found');
  const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(target)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'none'; frame-ancestors 'none'" });
  res.end(fs.readFileSync(target));
}

/** Create the admin HTTP server. `deps` are injected into pipeline runs (tests). */
export function createAdminServer(cfg, store, { deps = {}, logger = createLogger({ component: 'admin' }) } = {}) {
  const { username, passwordHash, sessionSecret } = cfg.admin;
  const loginLimiter = rateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 });
  const cronLimiter = rateLimiter({ limit: 6, windowMs: 60 * 60 * 1000 });
  const actionLimiter = rateLimiter({ limit: 60, windowMs: 60 * 1000 });
  const secureCookie = cfg.admin.host !== '127.0.0.1' && cfg.admin.host !== 'localhost';
  let backgroundRun = null;

  const startRun = (fn) => {
    if (backgroundRun) return false;
    backgroundRun = fn().catch((err) => logger.error('background run failed', { err })).finally(() => { backgroundRun = null; });
    return true;
  };

  return http.createServer(async (req, res) => {
    const nonce = crypto.randomBytes(12).toString('base64');
    const csp = `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;
    const html = (status, title, body, headers = {}) => send(res, status, page(title, body, nonce), { 'content-security-policy': csp, ...headers });
    const ip = req.socket.remoteAddress || 'unknown';
    try {
      const url = new URL(req.url, 'http://admin.local');

      // Cron trigger (Hostinger cron: curl -X POST -H "Authorization: Bearer $CRON_SECRET" .../cron/run)
      if (url.pathname === '/cron/run') {
        if (req.method !== 'POST') return send(res, 405, 'Method not allowed');
        if (!cronLimiter(ip)) return send(res, 429, 'Too many requests');
        const auth = req.headers.authorization || '';
        if (!cfg.cronSecret || !auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), cfg.cronSecret)) return send(res, 401, 'Unauthorized', { 'content-type': 'text/plain' });
        const started = startRun(() => scheduledRun(cfg, store, { verifyInline: url.searchParams.get('verify') === '1', deps }));
        return send(res, 202, JSON.stringify({ accepted: started, note: started ? 'scheduled-run started (it no-ops if not due)' : 'a run is already in progress' }), { 'content-type': 'application/json' });
      }

      if (!username || !passwordHash || !sessionSecret || sessionSecret.length < 32) {
        return html(503, 'Not configured', '<main><section><h2>Admin not configured</h2><p>Set ADMIN_USERNAME, ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET (≥ 32 characters). See docs/articles-engine-setup.md.</p></section></main>');
      }

      const session = readSession(sessionSecret, parseCookies(req.headers.cookie)[COOKIE]);

      if (url.pathname === '/login') {
        if (req.method === 'GET') return html(200, 'Log in', `<main><section class="login"><h2>Articles Engine — log in</h2><form method="post" action="/login"><p><label>Username<br><input name="username" autocomplete="username" required></label></p><p><label>Password<br><input name="password" type="password" autocomplete="current-password" required></label></p><button class="primary">Log in</button></form></section></main>`);
        if (req.method !== 'POST') return send(res, 405, 'Method not allowed');
        if (!loginLimiter(ip)) return html(429, 'Too many attempts', '<main><section><p>Too many login attempts. Try again in 15 minutes.</p></section></main>');
        const body = await readBody(req, 4000);
        const ok = safeEqual(body.username || '', username) & verifyPassword(body.password || '', passwordHash);
        if (!ok) { logger.warn('admin login failed', { ip }); return html(401, 'Log in', '<main><section><p>Invalid credentials. <a href="/login">Try again</a>.</p></section></main>'); }
        logger.info('admin login', { ip });
        return send(res, 303, '', { location: '/', 'set-cookie': `${COOKIE}=${encodeURIComponent(createSession(sessionSecret, username))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie ? '; Secure' : ''}` });
      }

      if (!session) return send(res, 303, '', { location: '/login' });
      const csrf = csrfToken(sessionSecret, session);

      if (req.method === 'GET') {
        if (url.pathname === '/') return html(200, 'Dashboard', dashboard(cfg, store, csrf, url.searchParams.get('msg')));
        const m = url.pathname.match(/^\/article\/(art_[a-z0-9]+)$/);
        if (m) {
          const a = store.getArticle(m[1]);
          return a ? html(200, a.title, articleDetail(a, csrf)) : html(404, 'Not found', '<main><p>Not found</p></main>');
        }
        if (url.pathname.startsWith('/preview/')) return servePreview(cfg, res, url.pathname);
        return html(404, 'Not found', '<main><p>Not found</p></main>');
      }

      if (req.method !== 'POST') return send(res, 405, 'Method not allowed');
      if (!actionLimiter(session.n)) return send(res, 429, 'Too many requests');
      const body = await readBody(req);
      if (!verifyCsrf(sessionSecret, session, body.csrf)) return send(res, 403, 'Invalid CSRF token');

      if (url.pathname === '/logout') return send(res, 303, '', { location: '/login', 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });

      const action = url.pathname.replace(/^\/actions\//, '');
      const by = `admin:${session.u}`;
      let msg;
      try {
        switch (action) {
          case 'generate': msg = startRun(() => runPipeline(cfg, store, { trigger: 'manual', topicId: body.topicId || undefined, deps })) ? 'Run started. Refresh in a few minutes.' : 'A run is already in progress.'; break;
          case 'approve': actions.approveArticle(store, body.id, { by }); msg = 'Approved. Use Publish to render it for deployment.'; break;
          case 'reject': actions.rejectArticle(store, body.id, { by, reason: body.reason }); msg = 'Rejected.'; break;
          case 'publish': { const r = actions.publishApproved(cfg, store, body.id, { by }); msg = `Rendered ${r.url}. Deploy, then verify the live URL.`; break; }
          case 'verify': msg = startRun(() => actions.verifyArticle(cfg, store, body.id, deps.fetchPage ? { fetchPage: deps.fetchPage } : {})) ? 'Verification started.' : 'A run is already in progress.'; break;
          case 'unpublish': actions.unpublishArticle(cfg, store, body.id, { by, reason: body.reason }); msg = 'Unpublished and re-rendered. Deploy to remove it from the live site.'; break;
          case 'regenerate': msg = startRun(() => actions.regenerate(cfg, store, body.id, { deps })) ? 'Regeneration started.' : 'A run is already in progress.'; break;
          case 'retry': msg = startRun(() => actions.retryRun(cfg, store, body.runId, { deps })) ? 'Retry started.' : 'A run is already in progress.'; break;
          case 'pause': actions.setPaused(store, true); msg = 'Automation paused.'; break;
          case 'resume': actions.setPaused(store, false); msg = 'Automation resumed.'; break;
          case 'add-topic': actions.addTopic(store, { topic: body.topic, primaryQuery: body.primaryQuery, secondaryQueries: (body.secondaryQueries || '').split(',').map((s) => s.trim()).filter(Boolean), searchIntent: body.searchIntent, priority: Number.parseInt(body.priority, 10) || 50, relatedService: body.relatedService || '', notes: body.notes || '' }); msg = 'Topic added.'; break;
          case 'edit-topic': {
            const patch = {};
            if (body.priority) patch.priority = Number.parseInt(body.priority, 10);
            if (body.status) patch.status = body.status;
            actions.editTopic(store, body.id, patch);
            msg = 'Topic updated.';
            break;
          }
          default: return send(res, 404, 'Unknown action');
        }
        logger.info('admin action', { action, by, id: body.id || body.topicId || body.runId });
      } catch (err) {
        msg = `Error: ${err.message}`;
      }
      return send(res, 303, '', { location: `/?msg=${encodeURIComponent(msg)}` });
    } catch (err) {
      logger.error('admin request failed', { err });
      return send(res, err.status || 500, err.status === 413 ? 'Payload too large' : 'Internal error');
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const cfg = loadConfig();
  const store = new Store(cfg.dataDir);
  await migrate(store);
  const server = createAdminServer(cfg, store);
  server.listen(cfg.admin.port, cfg.admin.host, () => {
    process.stderr.write(`Articles Engine admin listening on http://${cfg.admin.host}:${cfg.admin.port}\n`);
  });
}
