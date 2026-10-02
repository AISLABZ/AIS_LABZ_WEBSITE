import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runPipeline, scheduledRun, scheduleDue } from '../src/pipeline/run.js';
import { selectTopic } from '../src/pipeline/topic-selector.js';
import { publicationGate } from '../src/pipeline/gate.js';
import { deterministicFactCheck } from '../src/pipeline/factcheck.js';
import { quoteAppearsIn } from '../src/research/agent.js';
import { publishArticle, PublishBlockedError } from '../src/pipeline/publisher.js';
import * as actions from '../src/pipeline/actions.js';
import { BudgetError, createLlm } from '../src/llm/index.js';
import { setup, fakeLlm, fakeSearch, fakeFetch, goodDraft, silentLogger, STRATEGY } from './helpers.js';

const TUESDAY_0900_LONDON = new Date('2026-10-06T08:00:00Z'); // BST = UTC+1

function deps(cfg, extra = {}) {
  return { llm: fakeLlm(), search: fakeSearch(), fetchPage: fakeFetch({ outputDir: cfg.outputDir }), gsc: null, logger: silentLogger, produceImage: async () => ({ status: 'manual' }), ...extra };
}

test('scheduler honours timezone, day and hour', async () => {
  const { cfg, cleanup } = await setup();
  try {
    assert.equal(scheduleDue(cfg, TUESDAY_0900_LONDON).due, true);
    assert.equal(scheduleDue(cfg, new Date('2026-10-06T07:00:00Z')).due, false, '08:00 London is before the publish hour');
    assert.equal(scheduleDue(cfg, new Date('2026-10-06T12:00:00Z')).due, true, 'late trigger on the same day still runs');
    assert.equal(scheduleDue(cfg, new Date('2026-10-07T08:00:00Z')).due, false, 'Wednesday is not due');
    assert.equal(scheduleDue(cfg, TUESDAY_0900_LONDON).runKey, 'weekly:2026-W41');
  } finally { cleanup(); }
});

test('no research provider: stops, flags topic needs_research, creates no article, no paid calls', async () => {
  const { cfg, store, cleanup } = await setup();
  try {
    const llm = fakeLlm();
    const run = await runPipeline(cfg, store, { deps: { ...deps(cfg), llm, search: undefined } });
    assert.equal(run.status, 'stopped');
    assert.equal(run.outcome, 'needs_research');
    assert.equal(store.listArticles().length, 0);
    assert.equal(store.listTopics().find((t) => t.id === 'top_001').status, 'needs_research');
    assert.equal(llm.calls.length, 0);
  } finally { cleanup(); }
});

test('topic selection follows priority and skips topics already covered', () => {
  const topics = [
    { id: 't2', topic: 'AI Automation for Business', primaryQuery: 'ai automation for business', priority: 2, status: 'queued', createdAt: '1' },
    { id: 't1', topic: 'AI Consulting Explained: x', primaryQuery: 'ai consulting', priority: 1, status: 'queued', createdAt: '1' },
    { id: 't0', topic: 'Done', primaryQuery: 'done', priority: 0, status: 'published', createdAt: '1' },
  ];
  assert.equal(selectTopic(topics, []).topic.id, 't1');
  const inv = [{ type: 'article', url: 'https://www.aislabz.com/articles/ai-consulting-explained/', title: 'AI Consulting Explained', primaryQuery: 'ai consulting' }];
  const r = selectTopic(topics, inv);
  assert.equal(r.topic.id, 't2');
  assert.equal(r.skipped[0].topicId, 't1');
});

test('research keeps only claims whose quote is verbatim in the fetched source', () => {
  assert.ok(quoteAppearsIn('It is organized around four functions: Govern, Map, Measure and Manage.', 'Intro. It is organized   around four functions: Govern, Map, Measure and Manage. More.'));
  assert.ok(!quoteAppearsIn('Ninety-nine percent of companies adopted AI in 2025.', 'Some unrelated page text that is long enough to matter here.'));
});

test('full pipeline (manual mode): research → QA → APPROVED draft awaiting approval, never auto-published', async () => {
  const { cfg, store, cleanup } = await setup();
  try {
    const d = deps(cfg);
    const run = await runPipeline(cfg, store, { deps: d });
    assert.equal(run.status, 'completed', JSON.stringify(run, null, 2));
    assert.equal(run.outcome, 'awaiting_approval');
    const a = store.getArticle(run.articleId);
    assert.equal(a.status, 'draft');
    assert.equal(a.qaStatus, 'passed');
    assert.equal(a.qaReport.gate.decision, 'APPROVED');
    assert.equal(a.slug, 'ai-consulting-explained');
    assert.equal(a.researchReport.claims.length, 6, 'fabricated quotes are dropped');
    assert.ok(a.researchReport.notes.some((n) => n.includes('dropped')));
    assert.equal(a.sources.length, 3);
    assert.ok(a.cta.neutral, 'no verified services → neutral CTA without capability claims');
    assert.ok(!fs.existsSync(path.join(cfg.outputDir, 'articles', a.slug)), 'not rendered publicly before approval');
    assert.ok(fs.existsSync(path.join(cfg.previewDir, 'articles', a.slug, 'index.html')));
    assert.equal(store.listTopics().find((t) => t.id === 'top_001').status, 'drafted');
    assert.ok(run.stages.research.status === 'ok' && run.durationMs >= 0);

    // Manual approval → publish → live verification.
    assert.throws(() => publishArticle(cfg, store, a.id), PublishBlockedError, 'unapproved drafts cannot be published in manual mode');
    actions.approveArticle(store, a.id, { by: 'test' });
    const pub = actions.publishApproved(cfg, store, a.id, { by: 'test' });
    assert.equal(pub.article.status, 'scheduled');
    assert.ok(fs.existsSync(path.join(cfg.outputDir, 'articles', a.slug, 'index.html')));
    const v = await actions.verifyArticle(cfg, store, a.id, { fetchPage: d.fetchPage, intervalMs: 1, timeoutSeconds: 0 });
    assert.equal(v.ok, true, JSON.stringify(v.verification));
    assert.equal(store.getArticle(a.id).status, 'published');
  } finally { cleanup(); }
});

test('auto-publish mode with inline verification publishes only after the live URL verifies', async () => {
  const { cfg, store, cleanup } = await setup({ ARTICLE_AUTO_PUBLISH: 'true', POST_PUBLISH_VERIFY_TIMEOUT_SECONDS: '0' });
  try {
    const run = await runPipeline(cfg, store, { verifyInline: true, deps: deps(cfg) });
    assert.equal(run.outcome, 'published', JSON.stringify(run.stages, null, 2));
    const a = store.getArticle(run.articleId);
    assert.equal(a.status, 'published');
    assert.equal(a.liveVerification.ok, true);
    assert.equal(run.publishedUrl, 'https://www.aislabz.com/articles/ai-consulting-explained/');
    assert.equal(store.listTopics().find((t) => t.id === 'top_001').status, 'published');
  } finally { cleanup(); }
});

test('live verification failure records publication_failed (never reports success)', async () => {
  const { cfg, store, cleanup } = await setup({ ARTICLE_AUTO_PUBLISH: 'true', POST_PUBLISH_VERIFY_TIMEOUT_SECONDS: '0' });
  try {
    const d = deps(cfg);
    // Live site serves nothing from the output dir → 404.
    const run = await runPipeline(cfg, store, { verifyInline: true, deps: { ...d, fetchPage: fakeFetch({}) } });
    assert.equal(run.outcome, 'publication_failed');
    assert.equal(store.getArticle(run.articleId).status, 'publication_failed');
  } finally { cleanup(); }
});

test('QA rejection: hallucinated citation and uncited statistic → REJECTED, qa_failed, never published even in auto mode', async () => {
  const { cfg, store, cleanup } = await setup({ ARTICLE_AUTO_PUBLISH: 'true' });
  try {
    const bad = goodDraft();
    bad.content.push({ type: 'p', text: 'Companies using AI grow revenue by 37% per year, see [this report](https://made-up-source.example.com/report).' });
    const llm = fakeLlm({ writer: bad });
    const run = await runPipeline(cfg, store, { deps: { ...deps(cfg), llm } });
    assert.equal(run.status, 'stopped');
    assert.equal(run.outcome, 'qa_failed');
    const a = store.getArticle(run.articleId);
    assert.equal(a.status, 'qa_failed');
    assert.equal(a.qaReport.gate.decision, 'REJECTED');
    assert.ok(a.qaReport.gate.reasons.some((r) => r.includes('Citations not backed')));
    assert.equal(llm.calls.filter((c) => c === 'writer').length, 2, 'exactly one bounded revision attempt');
    assert.throws(() => publishArticle(cfg, store, a.id), PublishBlockedError);
    assert.throws(() => actions.approveArticle(store, a.id), /passed the publication gate/);
    assert.ok(!fs.existsSync(path.join(cfg.outputDir, 'articles', a.slug)));
  } finally { cleanup(); }
});

test('serious cannibalization stops generation and flags the topic for review', async () => {
  const { cfg, store, cleanup } = await setup();
  try {
    const llm = fakeLlm({ strategist: { ...STRATEGY, cannibalization: { risk: 'serious', explanation: 'Existing page covers this intent' } } });
    const run = await runPipeline(cfg, store, { deps: { ...deps(cfg), llm } });
    assert.equal(run.outcome, 'cannibalization');
    assert.ok(!llm.calls.includes('writer'));
    assert.equal(store.listTopics().find((t) => t.id === 'top_001').status, 'needs_review');
  } finally { cleanup(); }
});

test('failed API call: run fails safely, nothing published, topic flagged', async () => {
  const { cfg, store, cleanup } = await setup({ ARTICLE_AUTO_PUBLISH: 'true' });
  try {
    const err = Object.assign(new Error('API api.openai.com responded 500'), { status: 500 });
    const run = await runPipeline(cfg, store, { deps: { ...deps(cfg), llm: fakeLlm({ writer: err }) } });
    assert.equal(run.status, 'failed');
    assert.ok(run.errors.some((e) => e.includes('500')));
    assert.equal(run.stages.writer.status, 'failed');
    const a = store.getArticle(run.articleId);
    assert.notEqual(a.status, 'published');
    assert.notEqual(a.status, 'scheduled');
    assert.equal(store.listTopics().find((t) => t.id === 'top_001').status, 'needs_review');
    assert.equal(store.acquireLock('engine') !== null, true, 'lock released after failure');
  } finally { cleanup(); }
});

test('duplicate-run prevention: weekly idempotency key and exclusive lock', async () => {
  const { cfg, store, cleanup } = await setup();
  try {
    const d = deps(cfg);
    const first = await scheduledRun(cfg, store, { now: TUESDAY_0900_LONDON, deps: d });
    assert.equal(first.status, 'completed');
    const second = await scheduledRun(cfg, store, { now: new Date('2026-10-06T10:00:00Z'), deps: d });
    assert.equal(second.status, 'skipped');
    assert.match(second.reason, /already ran for weekly:2026-W41/);
    const notDue = await scheduledRun(cfg, store, { now: new Date('2026-10-08T08:00:00Z'), deps: d });
    assert.equal(notDue.status, 'skipped');

    const release = store.acquireLock('engine');
    const locked = await runPipeline(cfg, store, { deps: d });
    assert.equal(locked.status, 'skipped');
    assert.match(locked.reason, /lock/);
    release();
  } finally { cleanup(); }
});

test('paused automation and disabled engine skip scheduled runs', async () => {
  const { cfg, store, cleanup } = await setup();
  try {
    actions.setPaused(store, true);
    const r = await scheduledRun(cfg, store, { now: TUESDAY_0900_LONDON, deps: deps(cfg) });
    assert.equal(r.status, 'skipped');
    assert.match(r.reason, /paused/);
    const off = await runPipeline({ ...cfg, enabled: false }, store, { deps: deps(cfg) });
    assert.equal(off.status, 'skipped');
  } finally { cleanup(); }
});

test('publication gate rejects on any failed check', () => {
  const base = { article: { seoTitle: 't', metaDescription: 'm', slug: 's' }, research: { status: 'completed' }, strategy: { cannibalization: { risk: 'none' } }, factCheck: { verdict: 'pass', issues: [] }, deterministic: { issues: [] }, links: { ok: true }, seo: { ok: true }, duplicate: { ratio: 0 } };
  assert.equal(publicationGate(base).decision, 'APPROVED');
  assert.equal(publicationGate({ ...base, research: { status: 'insufficient' } }).decision, 'REJECTED');
  assert.equal(publicationGate({ ...base, links: { ok: false, failures: [{ href: 'x', status: 404 }] } }).decision, 'REJECTED');
  assert.equal(publicationGate({ ...base, duplicate: { ratio: 0.5, id: 'art_1' } }).decision, 'REJECTED');
  assert.equal(publicationGate({ ...base, requireFeaturedImage: true }).decision, 'REJECTED');
  assert.equal(publicationGate({ ...base, factCheck: { verdict: 'pass', issues: [{ severity: 'major', type: 'unsupported_claim', problem: 'p', excerpt: 'e' }] } }).decision, 'REJECTED');
});

test('deterministic checks catch placeholders, uncited numbers and AISLabz claims in the body', () => {
  const research = { claims: [{ evidenceId: 'E1', sourceUrl: 'https://www.nist.gov/x' }] };
  const article = { content: [
    { type: 'p', text: 'TODO: add intro' },
    { type: 'p', text: 'Adoption rose 45% last year.' },
    { type: 'p', text: 'AISLabz guarantees results.' },
    { type: 'p', text: 'For a hypothetical firm, imagine cutting handling time by 30%.' },
  ] };
  const r = deterministicFactCheck(article, research, { site: { siteUrl: 'https://www.aislabz.com', services: [] } });
  const problems = r.issues.map((i) => i.problem);
  assert.ok(problems.some((p) => p.includes('Placeholder')));
  assert.ok(problems.some((p) => p.includes('Numeric claim without a citation')));
  assert.ok(problems.some((p) => p.includes('AISLabz mentioned')));
  assert.equal(r.issues.filter((i) => i.index === 3).length, 0, 'clearly hypothetical examples are allowed');
});

test('cost control: per-run LLM call limit and monthly budget guard', async () => {
  const { cfg, store, cleanup } = await setup({ LLM_MAX_CALLS_PER_RUN: '10', LLM_MONTHLY_TOKEN_BUDGET: '1000' });
  try {
    const transport = async () => ({ text: '{"ok":true}', inputTokens: 300, outputTokens: 300 });
    const llm = createLlm(cfg, store, { transport });
    await llm.json('a', { system: '', user: '' }); // 600 used
    await llm.json('b', { system: '', user: '' }); // 1200 used (checked before the call)
    await assert.rejects(llm.json('c', { system: '', user: '' }), BudgetError, 'monthly budget exhausted');
    const llm2 = createLlm({ ...cfg, llm: { ...cfg.llm, monthlyTokenBudget: 0, maxCallsPerRun: 2 } }, store, { transport });
    await llm2.json('a', { system: '', user: '' });
    await llm2.json('b', { system: '', user: '' });
    await assert.rejects(llm2.json('c', { system: '', user: '' }), /call limit/);
  } finally { cleanup(); }
});

test('LLM output that fails schema validation gets one repair attempt then fails the stage', async () => {
  const { cfg, store, cleanup } = await setup();
  try {
    let n = 0;
    const llm = createLlm(cfg, store, { transport: async () => { n++; return { text: 'not json', inputTokens: 1, outputTokens: 1 }; } });
    await assert.rejects(llm.json('x', { system: '', user: '', schema: { type: 'object' } }), /failed validation/);
    assert.equal(n, 2);
  } finally { cleanup(); }
});
