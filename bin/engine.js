#!/usr/bin/env node
// AISLabz Articles Engine CLI. Run `node bin/engine.js help`.
import { loadConfig, describeConfig } from '../src/config.js';
import { Store } from '../src/store/store.js';
import { migrate } from '../src/store/migrate.js';
import { buildSite, buildPreview } from '../src/render/build.js';
import { runPipeline, scheduledRun } from '../src/pipeline/run.js';
import { nextScheduledRun } from '../src/lib/time.js';
import * as actions from '../src/pipeline/actions.js';
import { createGscClient } from '../src/gsc/client.js';
import { collectSearchConsole } from '../src/gsc/monitor.js';
import { hashPassword } from '../src/admin/auth.js';

const HELP = `AISLabz Articles Engine

Usage: node bin/engine.js <command> [args]

Setup
  migrate                     Apply data migrations (idempotent)
  status                      Show configuration status (no secret values) and queue
  hash-password               Read a password from stdin, print ADMIN_PASSWORD_HASH

Pipeline
  scheduled-run [--verify] [--force]
                              Run if due (configured day/hour/timezone), once per week
  run [--topic <id>] [--verify]
                              Run the pipeline now (manual trigger)
  retry <runId>               Retry a failed/stopped run
  regenerate <articleId>      Reject a draft and regenerate its topic

Editorial
  approve <articleId>         Approve a draft that passed QA (manual mode)
  reject <articleId> [reason] Reject a draft
  publish <articleId>         Render an approved article for publication (status: scheduled)
  verify [articleId]          Verify live URL(s); sets published or publication_failed
  unpublish <articleId> [reason]
  preview <articleId>         Render a noindex preview into ./preview
  build                       Re-render /articles/ + sitemap into ARTICLES_OUTPUT_DIR
  pause | resume              Pause/resume scheduled automation

Topics
  topics                      List the topic queue
  add-topic '<json>'          Add a topic {topic, primaryQuery, ...}
  edit-topic <id> '<json>'    Edit a topic (e.g. '{"priority":3}')

Search Console
  gsc                         Collect Search Console data now
`;

function flag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const next = args[i + 1];
  args.splice(i, next && !next.startsWith('--') ? 2 : 1);
  return next && !next.startsWith('--') ? next : true;
}

function print(obj) { process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`); }

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main() {
  const [cmd = 'help', ...args] = process.argv.slice(2);
  if (cmd === 'help' || cmd === '--help') { process.stdout.write(HELP); return 0; }
  if (cmd === 'hash-password') {
    const pw = await readStdin();
    if (pw.length < 12) throw new Error('Use a password of at least 12 characters');
    process.stdout.write(`${hashPassword(pw)}\n`);
    return 0;
  }

  const cfg = loadConfig();
  const store = new Store(cfg.dataDir);
  await migrate(store);

  switch (cmd) {
    case 'migrate': print({ ok: true, version: store.readJson('schema-version.json').version }); return 0;
    case 'status': {
      const topics = store.listTopics();
      const articles = store.listArticles();
      print({
        config: describeConfig(cfg),
        paused: store.getState().paused,
        nextScheduledRun: nextScheduledRun(new Date(), cfg)?.toISOString(),
        topics: topics.reduce((m, t) => ({ ...m, [t.status]: (m[t.status] || 0) + 1 }), {}),
        articles: articles.map((a) => ({ id: a.id, status: a.status, qa: a.qaStatus, title: a.title, slug: a.slug })),
        lastRuns: store.listRuns(5).map((r) => ({ runId: r.runId, trigger: r.trigger, status: r.status, outcome: r.outcome, reason: r.reason, startedAt: r.startedAt })),
      });
      return 0;
    }
    case 'scheduled-run': {
      const verifyInline = Boolean(flag(args, '--verify'));
      const force = Boolean(flag(args, '--force'));
      const r = await scheduledRun(cfg, store, { verifyInline, force });
      print(r);
      return r.status === 'failed' ? 1 : 0;
    }
    case 'run': {
      const topicId = flag(args, '--topic');
      const verifyInline = Boolean(flag(args, '--verify'));
      const r = await runPipeline(cfg, store, { trigger: 'manual', topicId: typeof topicId === 'string' ? topicId : undefined, verifyInline });
      print(r);
      return r.status === 'failed' ? 1 : 0;
    }
    case 'retry': { const r = await actions.retryRun(cfg, store, args[0]); print(r); return r.status === 'failed' ? 1 : 0; }
    case 'regenerate': { const r = await actions.regenerate(cfg, store, args[0]); print(r); return r.status === 'failed' ? 1 : 0; }
    case 'approve': print(actions.approveArticle(store, args[0], { by: 'cli' })); return 0;
    case 'reject': print(actions.rejectArticle(store, args[0], { by: 'cli', reason: args.slice(1).join(' ') })); return 0;
    case 'publish': { const r = actions.publishApproved(cfg, store, args[0], { by: 'cli' }); print({ url: r.url, status: r.article.status, build: r.build }); return 0; }
    case 'verify': {
      const results = args[0] ? [{ id: args[0], ...(await actions.verifyArticle(cfg, store, args[0])) }] : await actions.verifyPending(cfg, store);
      print(results.map((r) => ({ id: r.id, ok: r.ok, status: r.article.status, errors: r.verification.errors, backlinkProposals: r.backlinks?.proposals })));
      return results.every((r) => r.ok) ? 0 : 1;
    }
    case 'unpublish': { const r = actions.unpublishArticle(cfg, store, args[0], { by: 'cli', reason: args.slice(1).join(' ') }); print({ status: r.article.status, build: r.build }); return 0; }
    case 'preview': {
      const a = store.getArticle(args[0]);
      if (!a) throw new Error(`Unknown article ${args[0]}`);
      print({ file: buildPreview(cfg, store, a) });
      return 0;
    }
    case 'build': print(buildSite(cfg, store)); return 0;
    case 'pause': print(actions.setPaused(store, true)); return 0;
    case 'resume': print(actions.setPaused(store, false)); return 0;
    case 'topics': print(store.listTopics().map((t) => ({ id: t.id, priority: t.priority, status: t.status, topic: t.topic }))); return 0;
    case 'add-topic': print(actions.addTopic(store, JSON.parse(args[0] || '{}'))); return 0;
    case 'edit-topic': print(actions.editTopic(store, args[0], JSON.parse(args[1] || '{}'))); return 0;
    case 'gsc': {
      const r = await collectSearchConsole(cfg, store, createGscClient(cfg));
      print({ range: r.range, opportunities: r.opportunities.slice(0, 20), cannibalization: r.cannibalization });
      return 0;
    }
    default:
      process.stderr.write(`Unknown command "${cmd}"\n\n${HELP}`);
      return 2;
  }
}

main().then((code) => { process.exitCode = code; }).catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exitCode = 1;
});
