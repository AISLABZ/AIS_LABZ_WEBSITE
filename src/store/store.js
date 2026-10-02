import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ARTICLE_STATUSES = ['idea', 'researching', 'draft', 'qa_failed', 'approved', 'scheduled', 'published', 'publication_failed', 'needs_update', 'rejected', 'unpublished'];
export const TOPIC_STATUSES = ['queued', 'in_progress', 'needs_research', 'needs_review', 'drafted', 'published', 'covered_by_existing', 'suggested', 'paused'];
export const SEARCH_INTENTS = ['informational', 'commercial', 'transactional', 'navigational'];

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/** Git-versioned JSON document store with atomic writes and an exclusive run lock. */
export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    for (const sub of ['articles', 'runs', 'images', 'search-console', 'refresh', 'locks']) {
      fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
    }
  }

  file(rel) { return path.join(this.dir, rel); }

  readJson(rel, dflt) {
    try { return JSON.parse(fs.readFileSync(this.file(rel), 'utf8')); } catch (err) {
      if (err.code === 'ENOENT') return dflt;
      throw new Error(`Corrupt data file ${rel}: ${err.message}`);
    }
  }

  writeJson(rel, value) {
    const target = this.file(rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(tmp, target);
  }

  // ---------- articles ----------
  listArticles() {
    const dir = this.file('articles');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      .map((f) => this.readJson(`articles/${f}`))
      .filter(Boolean)
      .sort((a, b) => String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt)));
  }

  getArticle(id) {
    if (!/^art_[a-z0-9]+$/.test(String(id))) return null;
    return this.readJson(`articles/${id}.json`, null);
  }

  getArticleBySlug(slug) { return this.listArticles().find((a) => a.slug === slug) || null; }

  saveArticle(article, { note } = {}) {
    if (!ARTICLE_STATUSES.includes(article.status)) throw new Error(`Invalid article status ${article.status}`);
    const clash = this.listArticles().find((a) => a.slug === article.slug && a.id !== article.id && !['rejected', 'unpublished'].includes(a.status));
    if (article.slug && clash) throw new Error(`Slug "${article.slug}" already used by ${clash.id}`);
    const now = new Date().toISOString();
    const prev = this.getArticle(article.id);
    const next = { ...article, modifiedAt: now, createdAt: article.createdAt || now };
    if (prev && prev.status !== next.status) {
      next.history = [...(next.history || []), { at: now, from: prev.status, to: next.status, note: note || '' }].slice(-50);
    }
    this.writeJson(`articles/${article.id}.json`, next);
    return next;
  }

  // ---------- topics ----------
  listTopics() { return this.readJson('topics.json', []); }

  saveTopics(topics) {
    for (const t of topics) if (!TOPIC_STATUSES.includes(t.status)) throw new Error(`Invalid topic status ${t.status}`);
    this.writeJson('topics.json', topics);
  }

  updateTopic(id, patch) {
    const topics = this.listTopics();
    const i = topics.findIndex((t) => t.id === id);
    if (i < 0) throw new Error(`Unknown topic ${id}`);
    topics[i] = { ...topics[i], ...patch, updatedAt: new Date().toISOString() };
    this.saveTopics(topics);
    return topics[i];
  }

  // ---------- runs ----------
  saveRun(run) { this.writeJson(`runs/${run.runId}.json`, run); return run; }

  getRun(runId) {
    if (!/^run_[a-z0-9]+$/.test(String(runId))) return null;
    return this.readJson(`runs/${runId}.json`, null);
  }

  listRuns(limit = 50) {
    return fs.readdirSync(this.file('runs')).filter((f) => f.endsWith('.json'))
      .map((f) => this.readJson(`runs/${f}`))
      .filter(Boolean)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .slice(0, limit);
  }

  // ---------- engine state ----------
  getState() { return this.readJson('engine-state.json', { paused: false, usage: {} }); }

  updateState(patch) {
    const next = { ...this.getState(), ...patch };
    this.writeJson('engine-state.json', next);
    return next;
  }

  // ---------- search console ----------
  getSearchConsole(articleId) { return this.readJson(`search-console/${articleId}.json`, { daily: {}, queries: {}, inspections: [] }); }
  saveSearchConsole(articleId, data) { this.writeJson(`search-console/${articleId}.json`, data); }

  // ---------- lock ----------
  /** Acquire an exclusive lock. Returns a release function, or null if held. */
  acquireLock(name = 'engine', { staleMs = 2 * 3600 * 1000 } = {}) {
    const lockPath = this.file(`locks/${name}.lock`);
    const tryCreate = () => {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => { try { fs.unlinkSync(lockPath); } catch { /* already gone */ } };
    };
    try { return tryCreate(); } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age > staleMs) {
        fs.unlinkSync(lockPath);
        try { return tryCreate(); } catch { return null; }
      }
      return null;
    }
  }
}
