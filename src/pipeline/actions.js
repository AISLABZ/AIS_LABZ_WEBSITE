// Administrative actions shared by the CLI and the admin interface.
// Every action validates its input and records a status history entry.

import { newId, TOPIC_STATUSES, SEARCH_INTENTS } from '../store/store.js';
import { assertValid } from '../lib/validate.js';
import { buildSite } from '../render/build.js';
import { publishArticle, verifyPublication } from './publisher.js';
import { runPipeline } from './run.js';
import { proposeBacklinks } from './internal-links.js';
import { validateLinks } from './link-validator.js';
import { buildInventory } from './inventory.js';
import { submitArticlesSitemap } from '../gsc/client.js';

const TOPIC_INPUT = {
  type: 'object',
  required: ['topic', 'primaryQuery'],
  properties: {
    topic: { type: 'string', minLength: 10, maxLength: 200 },
    primaryQuery: { type: 'string', minLength: 3, maxLength: 120 },
    secondaryQueries: { type: 'array', maxItems: 15, items: { type: 'string', minLength: 2, maxLength: 120 } },
    searchIntent: { type: 'string', enum: SEARCH_INTENTS },
    priority: { type: 'integer', minimum: 1, maximum: 1000 },
    relatedService: { type: 'string', maxLength: 80 },
    clusterId: { type: 'string', pattern: '^[A-Z]+-\\d+$' },
    notes: { type: 'string', maxLength: 2000 },
    status: { type: 'string', enum: TOPIC_STATUSES },
  },
  additionalProperties: false,
};

function requireArticle(store, id) {
  const a = store.getArticle(id);
  if (!a) throw new Error(`Unknown article ${id}`);
  return a;
}

export function approveArticle(store, id, { by = 'admin' } = {}) {
  const a = requireArticle(store, id);
  if (a.status !== 'draft' || a.qaStatus !== 'passed' || a.qaReport?.gate?.decision !== 'APPROVED') {
    throw new Error(`Only drafts that passed the publication gate can be approved (status ${a.status}, QA ${a.qaStatus})`);
  }
  return store.saveArticle({ ...a, status: 'approved', approvedBy: by, approvedAt: new Date().toISOString() }, { note: `approved by ${by}` });
}

export function rejectArticle(store, id, { by = 'admin', reason = '' } = {}) {
  const a = requireArticle(store, id);
  if (['published', 'scheduled'].includes(a.status)) throw new Error('Use unpublish for live articles');
  const saved = store.saveArticle({ ...a, status: 'rejected', rejectedBy: by, rejectionReason: String(reason).slice(0, 1000) }, { note: `rejected by ${by}` });
  if (a.topicId) {
    try { store.updateTopic(a.topicId, { status: 'needs_review' }); } catch { /* topic removed */ }
  }
  return saved;
}

export function publishApproved(cfg, store, id, { by = 'admin' } = {}) {
  return publishArticle(cfg, store, id, { approvedBy: by });
}

export async function verifyArticle(cfg, store, id, opts = {}) {
  const fetchOpt = opts.fetchPage ? { fetchPage: opts.fetchPage } : {};
  const inventory = await buildInventory(cfg, store, fetchOpt);
  const r = await verifyPublication(cfg, store, id, {
    ...opts,
    validateLinksFn: (a) => validateLinks(a, { site: cfg.site, inventory, research: { claims: (a.sources || []).map((s) => ({ sourceUrl: s.url })) }, ...fetchOpt }),
  });
  if (r.ok) {
    if (r.article.topicId) {
      try { store.updateTopic(r.article.topicId, { status: 'published', publishedArticleId: r.article.id }); } catch { /* ignore */ }
    }
    r.backlinks = proposeBacklinks(cfg, store, r.article.id);
    if (r.backlinks.applied) buildSite(cfg, store);
    r.sitemap = await submitArticlesSitemap(cfg, opts.gsc ? { client: opts.gsc } : {});
  }
  return r;
}

/** Verify every article currently awaiting live verification. */
export async function verifyPending(cfg, store, opts = {}) {
  const pending = store.listArticles().filter((a) => a.status === 'scheduled');
  const results = [];
  for (const a of pending) results.push({ id: a.id, ...(await verifyArticle(cfg, store, a.id, opts)) });
  return results;
}

export function unpublishArticle(cfg, store, id, { by = 'admin', reason = '' } = {}) {
  const a = requireArticle(store, id);
  const saved = store.saveArticle({ ...a, status: 'unpublished', unpublishedBy: by, unpublishReason: String(reason).slice(0, 1000) }, { note: `unpublished by ${by}` });
  const build = buildSite(cfg, store);
  return { article: saved, build };
}

export async function regenerate(cfg, store, id, opts = {}) {
  const a = requireArticle(store, id);
  if (['published', 'scheduled'].includes(a.status)) throw new Error('Live articles are refreshed through an update, not regenerated');
  if (a.status !== 'rejected') rejectArticle(store, id, { by: 'regenerate', reason: 'superseded by regeneration' });
  store.updateTopic(a.topicId, { status: 'queued' });
  return runPipeline(cfg, store, { ...opts, trigger: 'regenerate', topicId: a.topicId });
}

export async function retryRun(cfg, store, runId, opts = {}) {
  const r = store.getRun(runId);
  if (!r) throw new Error(`Unknown run ${runId}`);
  if (!['failed', 'stopped'].includes(r.status)) throw new Error(`Run ${runId} is ${r.status}; only failed/stopped runs can be retried`);
  if (r.topicId) {
    const t = store.listTopics().find((x) => x.id === r.topicId);
    if (t && ['needs_review', 'needs_research', 'in_progress'].includes(t.status)) store.updateTopic(t.id, { status: 'queued' });
  }
  return runPipeline(cfg, store, { ...opts, trigger: 'retry', topicId: r.topicId || undefined });
}

export function setPaused(store, paused) {
  return store.updateState({ paused: Boolean(paused), pausedAt: paused ? new Date().toISOString() : null });
}

export function addTopic(store, input) {
  const clean = assertValid({ secondaryQueries: [], searchIntent: 'informational', priority: 50, relatedService: '', notes: '', ...input }, TOPIC_INPUT, 'topic');
  const topics = store.listTopics();
  if (topics.some((t) => t.primaryQuery.toLowerCase() === clean.primaryQuery.toLowerCase())) throw new Error('A topic with this primary query already exists (duplicate search intent)');
  const now = new Date().toISOString();
  const topic = { id: newId('top'), ...clean, status: clean.status || 'queued', publishedArticleId: null, createdAt: now, updatedAt: now };
  store.saveTopics([...topics, topic]);
  return topic;
}

export function editTopic(store, id, patch) {
  const current = store.listTopics().find((t) => t.id === id);
  if (!current) throw new Error(`Unknown topic ${id}`);
  const { id: _i, createdAt: _c, updatedAt: _u, publishedArticleId: _p, currentArticleId: _ca, ...editable } = { ...current, ...patch };
  assertValid(editable, TOPIC_INPUT, 'topic');
  return store.updateTopic(id, editable);
}
