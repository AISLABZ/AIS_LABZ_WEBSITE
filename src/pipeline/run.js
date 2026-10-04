import { newId } from '../store/store.js';
import { createLogger } from '../lib/logger.js';
import { createLlm, LlmNotConfiguredError } from '../llm/index.js';
import { createSearchProvider, ResearchNotConfiguredError } from '../research/providers.js';
import { runResearch } from '../research/agent.js';
import { createGscClient, submitArticlesSitemap } from '../gsc/client.js';
import { collectSearchConsole } from '../gsc/monitor.js';
import { blocksToPlainText, countWords, readingTimeMinutes } from '../lib/text.js';
import { extractLinks, isInternalHref } from '../render/blocks.js';
import { renderArticlePage } from '../render/pages.js';
import { buildPreview } from '../render/build.js';
import { articleUrl } from '../render/schema.js';
import { notify } from '../lib/notify.js';
import { isoWeekKey, zonedParts } from '../lib/time.js';
import { buildInventory } from './inventory.js';
import { selectTopic } from './topic-selector.js';
import { runStrategist } from './strategist.js';
import { runWriter, neutralCta } from './writer.js';
import { runOptimizer, applyOptimization } from './optimizer.js';
import { runFactCheck, deterministicFactCheck } from './factcheck.js';
import { validateLinks } from './link-validator.js';
import { validateRenderedArticle } from './seo-validator.js';
import { publicationGate, duplicateScore } from './gate.js';
import { produceFeaturedImage } from './image.js';
import { publishArticle, verifyPublication } from './publisher.js';
import { analyzeRefresh } from './refresh.js';
import { proposeBacklinks } from './internal-links.js';

const MAX_REVISIONS = 1;

class StopRun extends Error {
  constructor(outcome, message) { super(message); this.name = 'StopRun'; this.outcome = outcome; }
}

/** Is the scheduled weekly run due now? Pure function. */
export function scheduleDue(cfg, now = new Date()) {
  const p = zonedParts(now, cfg.timezone);
  // Due from the configured hour until the end of the configured local day, so a
  // delayed or missed hourly trigger still runs; the weekly runKey prevents repeats.
  return { due: p.weekday === cfg.publishDayIndex && p.hour >= cfg.publishHour, runKey: `weekly:${isoWeekKey(now, cfg.timezone)}`, local: p };
}

/** Assemble the article record from the optimised draft and evidence. */
export function assembleArticle({ base, topic, draft, optimized, research, strategy, site, image }) {
  const content = optimized.content;
  const links = extractLinks(content);
  const external = links.filter((l) => !isInternalHref(l.href, site.siteUrl));
  const usedIds = new Set(content.flatMap((b) => b.evidence || []));
  const citedUrls = new Set(external.map((l) => l.href));
  const sources = [];
  const seen = new Set();
  for (const c of research.claims) {
    if (!(usedIds.has(c.evidenceId) || citedUrls.has(c.sourceUrl)) || seen.has(c.sourceUrl)) continue;
    seen.add(c.sourceUrl);
    sources.push({ title: c.sourceTitle, url: c.sourceUrl, publisher: c.publisher, publishedDate: c.publishedDate, accessedDate: c.accessedDate, sourceType: c.sourceType });
  }
  const wordCount = countWords(blocksToPlainText(content));
  const cta = draft.cta
    ? { heading: draft.cta.heading, text: draft.cta.text, href: (site.services || []).find((s) => strategy.relevantServices.includes(s.url))?.url || site.contactUrl, buttonLabel: site.contactLabel }
    : neutralCta(topic, site);
  return {
    ...base,
    title: draft.title,
    slug: optimized.slug,
    seoTitle: optimized.seoTitle,
    metaDescription: optimized.metaDescription,
    excerpt: draft.excerpt,
    content,
    primaryTopic: optimized.primaryTopic,
    secondaryTopics: optimized.secondaryTopics,
    searchIntent: strategy.searchIntent,
    canonicalUrl: articleUrl(site.siteUrl, optimized.slug),
    sources,
    internalLinks: links.filter((l) => isInternalHref(l.href, site.siteUrl)).map((l) => ({ path: l.href, anchorText: l.text })),
    externalLinks: external.map((l) => ({ url: l.href, anchorText: l.text })),
    cta,
    featuredImageBrief: optimized.featuredImageBrief,
    featuredImagePrompt: optimized.featuredImageBrief.prompt,
    featuredImageAlt: optimized.featuredImageBrief.alt,
    featuredImage: image?.publicPath || null,
    featuredImageFile: image?.filename || null,
    wordCount,
    readingTime: readingTimeMinutes(wordCount),
    strategy,
  };
}

/**
 * Run the full pipeline once. Never throws for expected stops; always records
 * a run log. Returns the run record.
 */
export async function runPipeline(cfg, store, { trigger = 'manual', topicId, runKey, verifyInline = false, deps = {} } = {}) {
  const now = deps.now || new Date();
  const runId = newId('run');
  const logger = (deps.logger || createLogger()).child({ runId });
  const run = { runId, trigger, runKey: runKey || null, startedAt: now.toISOString(), status: 'running', stages: {}, topicId: null, articleId: null, publishedUrl: null, errors: [] };

  if (!cfg.enabled) return store.saveRun({ ...run, status: 'skipped', reason: 'ARTICLE_ENGINE_ENABLED=false', finishedAt: new Date().toISOString() });
  if (trigger === 'scheduled' && store.getState().paused) return store.saveRun({ ...run, status: 'skipped', reason: 'automation paused', finishedAt: new Date().toISOString() });

  const release = store.acquireLock('engine');
  if (!release) return { ...run, status: 'skipped', reason: 'another run is in progress (lock held)' };
  store.saveRun(run);

  const stage = async (name, fn) => {
    const t0 = Date.now();
    run.stages[name] = { status: 'running', startedAt: new Date().toISOString() };
    store.saveRun(run);
    try {
      const result = await fn();
      run.stages[name] = { ...run.stages[name], status: 'ok', durationMs: Date.now() - t0, ...(result?.__summary ? { summary: result.__summary } : {}) };
      return result;
    } catch (err) {
      run.stages[name] = { ...run.stages[name], status: err instanceof StopRun ? 'stopped' : 'failed', durationMs: Date.now() - t0, error: err.message };
      throw err;
    } finally {
      store.saveRun(run);
    }
  };

  let article = null;
  let topic = null;
  try {
    const llm = deps.llm || createLlm(cfg, store, { run, logger });
    const fetchPage = deps.fetchPage;

    const inventory = await stage('siteInventory', async () => {
      const inv = await buildInventory(cfg, store, { ...(fetchPage ? { fetchPage } : {}), logger });
      return Object.assign(inv, { __summary: `${inv.pages.length} URLs${inv.errors.length ? `, ${inv.errors.length} sitemap issue(s)` : ''}` });
    });

    let gscData = null;
    await stage('searchConsoleData', async () => {
      let gsc = deps.gsc;
      if (!gsc) {
        try { gsc = createGscClient(cfg); } catch (err) { return { __summary: `skipped: ${err.message}` }; }
      }
      gscData = await collectSearchConsole(cfg, store, gsc, { now, logger });
      return { __summary: `${gscData.opportunities.length} query opportunities, ${gscData.cannibalization.length} possible cannibalization cases` };
    }).catch((err) => { run.errors.push(`searchConsoleData: ${err.message}`); });

    await stage('contentRefresh', async () => {
      const report = await analyzeRefresh(cfg, store, {
        gsc: gscData,
        checkSources: (a) => validateLinks(a, { site: cfg.site, inventory, research: { claims: (a.sources || []).map((s) => ({ sourceUrl: s.url })) }, ...(fetchPage ? { fetchPage } : {}) }),
        now,
      });
      run.refresh = { candidates: report.candidates.length };
      return { __summary: `${report.candidates.length} refresh candidate(s)` };
    }).catch((err) => { run.errors.push(`contentRefresh: ${err.message}`); });

    topic = await stage('topicSelection', async () => {
      const topics = store.listTopics();
      const { topic: t, skipped } = selectTopic(topics, inventory.pages, { overrideTopicId: topicId });
      for (const s of skipped) store.updateTopic(s.topicId, { status: 'covered_by_existing', notes: `${topics.find((x) => x.id === s.topicId)?.notes || ''}\n[engine ${now.toISOString().slice(0, 10)}] ${s.reason}. Consider updating the existing article instead.`.trim() });
      if (!t) throw new StopRun('no_topic', skipped.length ? 'All candidate topics are already covered by existing articles' : 'No queued topics');
      return Object.assign({ ...t }, { __summary: t.topic });
    });
    delete topic.__summary;
    run.topicId = topic.id;
    run.selectedTopic = topic.topic;

    // Configuration preconditions: stop honestly rather than pretend.
    let search;
    try { search = deps.search || createSearchProvider(cfg); } catch (err) {
      if (err instanceof ResearchNotConfiguredError) {
        store.updateTopic(topic.id, { status: 'needs_research', notes: `${topic.notes || ''}\n[engine ${now.toISOString().slice(0, 10)}] Research provider not configured; no research performed.`.trim() });
        throw new StopRun('needs_research', err.message);
      }
      throw err;
    }
    if (!llm.configured) {
      store.updateTopic(topic.id, { status: 'needs_research' });
      throw new StopRun('llm_not_configured', new LlmNotConfiguredError().message);
    }

    store.updateTopic(topic.id, { status: 'in_progress' });
    article = store.saveArticle({
      id: newId('art'), topicId: topic.id, clusterId: topic.clusterId || null, title: topic.topic, slug: '', status: 'researching', qaStatus: 'pending',
      generationMetadata: { runId, primaryQuery: topic.primaryQuery, provider: cfg.llm.provider || 'injected', model: cfg.llm.model || 'injected', startedAt: now.toISOString() },
      publishedAt: null, updatedAt: null,
    });
    run.articleId = article.id;

    const { report: research, sourceTexts } = await stage('research', async () => {
      const r = await runResearch({ topic, cfg, llm, search, ...(fetchPage ? { fetchPage } : {}), logger, now });
      return Object.assign(r, { __summary: `${r.report.status}: ${r.report.claims.length} verified claims` });
    });
    article = store.saveArticle({ ...article, researchReport: research });
    if (research.status !== 'completed') {
      article = store.saveArticle({ ...article, status: 'idea' }, { note: 'research insufficient' });
      store.updateTopic(topic.id, { status: 'needs_research' });
      throw new StopRun('research_insufficient', research.notes.at(-1) || 'Research did not produce enough verified evidence');
    }

    const strategy = await stage('contentStrategy', async () => Object.assign(await runStrategist({ topic, research, inventory, gscOpportunities: gscData?.unmatchedQueries || [], llm, site: cfg.site }), { __summary: 'ok' }));
    delete strategy.__summary;
    article = store.saveArticle({ ...article, strategy });
    if (strategy.cannibalization.risk === 'serious') {
      article = store.saveArticle({ ...article, status: 'idea' }, { note: 'cannibalization' });
      store.updateTopic(topic.id, { status: 'needs_review', notes: `${topic.notes || ''}\n[engine] Serious cannibalization: ${strategy.cannibalization.explanation}`.trim() });
      throw new StopRun('cannibalization', `Serious cannibalization risk: ${strategy.cannibalization.explanation}`);
    }

    const existingSlugs = new Set(store.listArticles().filter((a) => a.id !== article.id && a.slug).map((a) => a.slug));
    let draft = await stage('writer', async () => runWriter({ topic, strategy, research, llm, site: cfg.site }));
    let optimized = await stage('optimizer', async () => applyOptimization(draft, await runOptimizer({ draft, strategy, inventory, llm, site: cfg.site }), { inventory, existingSlugs }));
    article = store.saveArticle({ ...assembleArticle({ base: article, topic, draft, optimized, research, strategy, site: cfg.site }), status: 'draft' }, { note: 'draft written' });

    // QA: deterministic + model fact-check, with at most one bounded revision.
    let det;
    let fc;
    for (let attempt = 0; ; attempt++) {
      det = deterministicFactCheck(article, research, { site: cfg.site, sourceTexts });
      fc = await stage(attempt ? `factCheck#${attempt + 1}` : 'factCheck', async () => runFactCheck({ article, research, llm, site: cfg.site }));
      const blocking = [...det.issues, ...fc.issues].filter((i) => i.severity !== 'minor');
      if ((fc.verdict === 'pass' && !blocking.length) || attempt >= MAX_REVISIONS) break;
      const notes = blocking.slice(0, 25).map((i) => `[block ${i.index}] ${i.type}/${i.severity}: ${i.problem} — "${String(i.excerpt).slice(0, 160)}"`);
      draft = await stage(`writer#${attempt + 2}`, async () => runWriter({ topic, strategy, research, llm, site: cfg.site, revisionNotes: notes }));
      optimized = await stage(`optimizer#${attempt + 2}`, async () => applyOptimization(draft, await runOptimizer({ draft, strategy, inventory, llm, site: cfg.site }), { inventory, existingSlugs }));
      article = store.saveArticle({ ...assembleArticle({ base: article, topic, draft, optimized, research, strategy, site: cfg.site }), status: 'draft' }, { note: 'revised after QA' });
    }

    const image = await stage('featuredImage', async () => {
      const r = await (deps.produceImage || produceFeaturedImage)({ cfg, article, logger });
      return Object.assign(r, { __summary: r.status });
    });
    if (image.status === 'generated') article = store.saveArticle({ ...article, featuredImage: image.publicPath, featuredImageFile: image.filename });

    const links = await stage('linkValidation', async () => {
      const r = await validateLinks(article, { site: cfg.site, inventory, research, ...(fetchPage ? { fetchPage } : {}) });
      return Object.assign(r, { __summary: `${r.checked} checked, ${r.failures.length} failing` });
    });

    const others = store.listArticles().filter((a) => a.id !== article.id);
    const seo = await stage('technicalSeo', async () => {
      const html = renderArticlePage({ ...article, publishedAt: article.publishedAt || now.toISOString() }, { site: cfg.site });
      const r = validateRenderedArticle(html, article, { site: cfg.site, otherArticles: others, requireFeaturedImage: cfg.requireFeaturedImage });
      return Object.assign(r, { __summary: r.ok ? 'ok' : r.errors.join('; ') });
    });
    const duplicate = duplicateScore(article, others);

    const gate = await stage('publicationGate', async () => {
      const g = publicationGate({ article, research, strategy, factCheck: fc, deterministic: det, links, seo, duplicate, requireFeaturedImage: cfg.requireFeaturedImage });
      return Object.assign(g, { __summary: g.decision });
    });
    delete gate.__summary;
    const qaReport = { gate, factCheck: fc, deterministic: { issues: det.issues, copiedRatio: det.copiedRatio }, links: { ok: links.ok, checked: links.checked, failures: links.failures }, seo: { ok: seo.ok, errors: seo.errors, warnings: seo.warnings }, duplicate };

    if (gate.decision === 'REJECTED') {
      article = store.saveArticle({ ...article, status: 'qa_failed', qaStatus: 'failed', qaReport }, { note: 'publication gate rejected' });
      store.updateTopic(topic.id, { status: 'needs_review' });
      buildPreview(cfg, store, article);
      await notify(cfg, run, { subject: `QA rejected: ${article.title}`, message: gate.reasons.join('\n'), level: 'warn' });
      throw new StopRun('qa_failed', `Publication gate rejected the article: ${gate.reasons.join(' | ')}`);
    }

    article = store.saveArticle({ ...article, qaStatus: 'passed', qaReport }, { note: 'publication gate approved' });
    store.updateTopic(topic.id, { status: 'drafted', currentArticleId: article.id });
    const preview = buildPreview(cfg, store, article);
    run.previewFile = preview;

    if (!cfg.autoPublish) {
      await notify(cfg, run, { subject: `Draft ready for approval: ${article.title}`, message: `All quality gates passed. Review the preview and approve with:\n  node bin/engine.js approve ${article.id}\nor in the admin interface.` });
      run.outcome = 'awaiting_approval';
    } else {
      await stage('publisher', async () => {
        const r = publishArticle(cfg, store, article.id);
        run.publishedUrl = r.url;
        return { __summary: `rendered ${r.url}` };
      });
      run.outcome = 'awaiting_live_verification';
      if (verifyInline) {
        const v = await stage('postPublication', async () => verifyPublication(cfg, store, article.id, { ...(fetchPage ? { fetchPage } : {}), logger, validateLinksFn: (a) => validateLinks(a, { site: cfg.site, inventory, research, ...(fetchPage ? { fetchPage } : {}) }) }));
        run.outcome = v.ok ? 'published' : 'publication_failed';
        if (v.ok) {
          store.updateTopic(topic.id, { status: 'published', publishedArticleId: article.id });
          run.backlinks = proposeBacklinks(cfg, store, article.id);
          run.sitemapSubmission = await submitArticlesSitemap(cfg, deps.gsc ? { client: deps.gsc } : {});
        } else {
          await notify(cfg, run, { subject: `Publication FAILED verification: ${article.title}`, message: v.verification.errors.join('\n'), level: 'error' });
        }
      }
    }
    run.status = 'completed';
  } catch (err) {
    if (err instanceof StopRun) {
      run.status = 'stopped';
      run.outcome = err.outcome;
      run.reason = err.message;
      if (['needs_research', 'llm_not_configured', 'research_insufficient', 'cannibalization'].includes(err.outcome)) {
        await notify(cfg, run, { subject: `Run stopped (${err.outcome})`, message: err.message, level: 'warn' });
      }
    } else {
      run.status = 'failed';
      run.errors.push(err.message);
      logger.error('pipeline failed', { err });
      if (article) {
        const current = store.getArticle(article.id);
        if (current && ['researching', 'draft'].includes(current.status)) store.saveArticle({ ...current, status: current.status === 'researching' ? 'idea' : 'qa_failed', qaStatus: current.status === 'draft' ? 'failed' : current.qaStatus, failure: err.message }, { note: 'run failed' });
      }
      if (topic) {
        const t = store.listTopics().find((x) => x.id === topic.id);
        if (t?.status === 'in_progress') store.updateTopic(topic.id, { status: 'needs_review' });
      }
      await notify(cfg, run, { subject: 'Run FAILED', message: err.message, level: 'error' });
    }
  } finally {
    run.finishedAt = new Date().toISOString();
    run.durationMs = new Date(run.finishedAt) - new Date(run.startedAt);
    store.saveRun(run);
    release();
  }
  return run;
}

/**
 * Scheduler entry point (GitHub Actions / Hostinger cron, hourly).
 * Runs only at the configured local day/hour and at most once per ISO week.
 */
export async function scheduledRun(cfg, store, { now = new Date(), force = false, ...opts } = {}) {
  const { due, runKey, local } = scheduleDue(cfg, now);
  if (!due && !force) return { status: 'skipped', reason: `not due (local ${local.weekday}/${local.hour}:00 ${cfg.timezone})`, runKey };
  const already = store.listRuns(500).find((r) => r.runKey === runKey && r.trigger === 'scheduled' && r.status !== 'skipped');
  if (already) return { status: 'skipped', reason: `already ran for ${runKey} (${already.runId}, ${already.status})`, runKey };
  return runPipeline(cfg, store, { ...opts, trigger: 'scheduled', runKey, deps: { ...(opts.deps || {}), now } });
}
