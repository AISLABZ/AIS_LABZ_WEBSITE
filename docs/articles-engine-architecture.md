# AISLabz Articles Engine — Architecture

Status: initial production build (auto-publishing **disabled** by default).

## 1. Existing architecture (audit findings)

The audit was performed on 2026-10-02 against everything available to the build environment.

| Area | Finding |
| --- | --- |
| Repository | `AISLABZ/AIS_LABZ_WEBSITE` was **empty** (no commits, no branches). No framework, CMS, database, API, auth, routing, design tokens, components, SEO, sitemap, robots.txt or analytics code exists in version control. |
| Live site | `https://www.aislabz.com/` could not be fetched from the build environment (egress blocked), so its HTML, header, footer, fonts, colours, sitemap and robots.txt could **not** be inspected. |
| Hosting | The owner's tooling references Hostinger. Whether the live site is a Hostinger *Website Builder* site or file-based hosting (`public_html`) could not be verified. |
| Other repos | `AISLABZ/best-tech-seo-audit` is a single static HTML page (unrelated audit report). `AISLABZ/aislabz-blog` (private) was not attached to this session and was not inspected. |
| Existing article/blog models | None in version control. |
| Environment-variable conventions | None. This build introduces `UPPER_SNAKE_CASE` variables documented in `.env.example`. |

Consequences:

* There is no existing architecture to preserve or break, so the Articles system is a **self-contained module** that produces static files for `/articles/` and a supplemental `sitemap-articles.xml`. It never touches other pages of the live site.
* Header, footer, navigation, colours and fonts cannot be copied from the live site. They are therefore **configuration**, not code: `config/site.json` (brand, navigation, footer links, contact URL, services) and the design tokens at the top of `assets/articles.css`. Matching the live site is a one-file edit for each, documented in `docs/articles-engine-setup.md`.
* AISLabz capabilities cannot be verified from the live site by the build environment. `config/site.json → services` ships **empty**; the engine never claims a capability that is not listed there, and the CTA falls back to a neutral "talk to us" message until services are filled in.

## 2. Proposed Articles architecture

```
                       ┌────────────── GitHub Actions (cron hourly, Mon–Wed UTC) ─────────────┐
                       │  or Hostinger cron → `node bin/engine.js scheduled-run`              │
                       │  or Hostinger cron → POST /cron/run (admin server, CRON_SECRET)      │
                       └──────────────────────────────┬───────────────────────────────────────┘
                                                      ▼
  data/*.json (git-versioned editorial DB)  ◄──  src/pipeline/*  (staged, schema-validated)
                                                      │
                                                      ▼
                         src/render/*  →  ARTICLES_OUTPUT_DIR (static HTML)
                                            /articles/index.html
                                            /articles/page/{n}/index.html
                                            /articles/{slug}/index.html
                                            /assets/articles/articles.css
                                            /sitemap-articles.xml
                                                      │
                                       deploy (FTP/SFTP step or direct write on Hostinger)
                                                      ▼
                         post-publication validator fetches the LIVE URL
```

Key decisions:

* **Zero runtime dependencies.** Node.js ≥ 20.12 built-ins only (`fetch`, `node:crypto`, `node:test`). This removes supply-chain risk and works on Hostinger Node.js hosting and GitHub runners alike.
* **Static output.** Articles are pre-rendered HTML. That is the fastest, most crawlable and most robust option for Hostinger, needs no application server for public traffic, and cannot leak admin functionality to the public.
* **AI output is never rendered as HTML.** Models return structured JSON *blocks* (`h2`, `h3`, `p`, `ul`, `ol`, `table`, `callout`). The renderer escapes all text and only understands a tiny inline syntax (`**bold**`, `*italic*`, `[text](url)` with `https:` or site-relative URLs). There is no path by which model output becomes raw HTML.
* **Pagination**: 12 articles per index page (`/articles/`, `/articles/page/2/`, …) with `rel=prev/next`-style links and self-canonicals, which scales to hundreds of articles.

## 3. Database / content model

The editorial database is a set of JSON documents under `data/`, versioned in git (history, review via pull requests, and `git revert` rollback come for free). Writes are atomic (write temp file → rename). Schema changes are applied by numbered migrations in `migrations/` and tracked in `data/schema-version.json`.

| Collection | Path | Purpose |
| --- | --- | --- |
| Articles | `data/articles/{id}.json` | One document per article (fields below). |
| Topics | `data/topics.json` | Editorial topic queue. |
| Runs | `data/runs/{runId}.json` | Pipeline run log (observability). |
| Engine state | `data/engine-state.json` | Pause flag, monthly token usage. |
| Search Console | `data/search-console/{articleId}.json` | Daily metrics per article + inspection results. |
| Refresh reports | `data/refresh/{date}.json` | Content refresh opportunities. |
| Images | `data/images/{slug}.{ext}` | Generated featured images (optional). |

Article fields: `id, title, slug, seoTitle, metaDescription, excerpt, content (blocks), status, primaryTopic, secondaryTopics, searchIntent, featuredImage, featuredImageAlt, featuredImagePrompt, featuredImageBrief, publishedAt, updatedAt (last substantive editorial update), createdAt, modifiedAt (any record change), canonicalUrl, sources, internalLinks, externalLinks, cta, schema, wordCount, readingTime, generationMetadata, qaStatus, qaReport, researchReport, strategy, searchConsoleData (summary), topicId, history`.

Statuses: `idea, researching, draft, qa_failed, approved, scheduled, published, publication_failed, needs_update, rejected, unpublished`.

* `draft` + `qaStatus=passed` = waiting for human approval (manual mode).
* `scheduled` = rendered into the output and awaiting live verification.
* `published` is set **only** by the post-publication validator.

Topic fields: `id, topic, primaryQuery, secondaryQueries, searchIntent, priority, status, relatedService, publishedArticleId, notes, createdAt, updatedAt`. Topic statuses: `queued, in_progress, needs_research, needs_review, drafted, published, covered_by_existing, suggested, paused`.

No secrets are ever stored in any record.

## 4. Publishing workflow

```
QA gate APPROVED ──► ARTICLE_AUTO_PUBLISH=false ──► status=draft (qa passed) + preview + notify ──► human Approve ──► Publish
                └──► ARTICLE_AUTO_PUBLISH=true  ──► Publish
Publish = re-run deterministic gate → status=scheduled → render → deploy → verify live URL
verify OK  → status=published (+ sitemap ping/submit if GSC configured)
verify bad → status=publication_failed + alert
QA gate REJECTED ──► status=qa_failed, never published automatically
```

## 5. AI workflow (one model call per responsibility)

| Stage | Module | Model? | Output |
| --- | --- | --- | --- |
| Scheduler | `pipeline/scheduler.js` | no | due / not due, run key |
| Topic selector | `pipeline/topic-selector.js` | no | topic or `covered_by_existing` |
| Site inventory | `pipeline/inventory.js` | no | live URL inventory from `sitemap.xml` + config |
| Search Console data | `gsc/*` | no | query/page opportunities |
| Research agent | `research/*` | yes (query plan + per-source extraction) | evidence JSON; every claim carries a **verbatim quote verified against the fetched page text** |
| Content strategist | `pipeline/strategist.js` | yes | intent, outline, links, cannibalization verdict |
| Article writer | `pipeline/writer.js` | yes | structured blocks citing evidence IDs |
| SEO/AEO/VSO/GEO optimizer | `pipeline/optimizer.js` | yes | metadata, image brief, targeted heading edits, internal links inserted only on verbatim anchors |
| Fact-check / QA agent | `pipeline/factcheck.js` | yes + deterministic | issues by severity |
| Link validator | `pipeline/link-validator.js` | no | HTTP status per link |
| Technical SEO validator | `pipeline/seo-validator.js` | no | checks on the rendered HTML |
| Publication gate | `pipeline/gate.js` | no | `APPROVED` / `REJECTED` + reasons |
| Publisher | `pipeline/publisher.js` | no | rendered output |
| Post-publication validator | `pipeline/post-publish.js` | no | live verification |
| Editorial DB update | `store/*` | no | statuses, run log |
| Search Console monitoring + refresh | `gsc/*`, `pipeline/refresh.js` | no | metrics, refresh opportunities |

Every model response is parsed as JSON and validated against a schema (`lib/validate.js`). An invalid response gets one bounded repair attempt, then the stage fails and the run stops.

## 6. Search Console integration

* Auth: service account JWT (RS256 via `node:crypto`), scope `https://www.googleapis.com/auth/webmasters`.
* Search Analytics API: clicks, impressions, CTR and position by page and by query, stored per article per date.
* URL Inspection API: index/coverage diagnostics stored **verbatim** as returned. The engine never invents an "indexed" status; Search Console cannot guarantee indexing.
* Sitemaps API: submits `sitemap-articles.xml`.
* The Google Indexing API is **not** used (it is restricted to job-posting and livestream pages).

## 7. Sitemap / indexing strategy

The live site's own sitemap is not modified (it could not be inspected). The engine publishes a supplemental `/sitemap-articles.xml` containing the articles index and every `published`/`scheduled` article with `lastmod = updatedAt`. Discovery comes from (a) a `Sitemap:` line in robots.txt, (b) submission via the Search Console Sitemaps API, and (c) internal links from the articles index and the site navigation. If the live site uses a sitemap index, add `sitemap-articles.xml` to it (see setup doc).

## 8. Security approach

* Secrets only in environment variables or GitHub Actions secrets; `.env` is git-ignored and `.env.example` lists names only.
* The logger redacts any value of a variable whose name contains `KEY`, `SECRET`, `TOKEN`, `PASSWORD` or `JSON`, and anything that looks like a bearer token.
* Admin server: binds to `127.0.0.1` by default; scrypt password hash; HMAC-signed `HttpOnly; SameSite=Strict` session cookie; CSRF token on every POST; login rate limiting; strict CSP; input validation on every action.
* Cron endpoint: `POST /cron/run` with `Authorization: Bearer $CRON_SECRET`, compared in constant time; rate limited; same lock as all other runs.
* Outbound fetches (research, link checks) only allow `http(s)`, refuse private/loopback addresses (SSRF), have timeouts and size caps.
* AI content is untrusted: escaped rendering, URL allow-listing (`https:` / site-relative only), no raw HTML.

## 9. Scheduling approach

GitHub Actions cron (`0 * * * 1-3`, hourly Monday–Wednesday UTC) calls `scheduled-run`. The engine converts "now" to `ARTICLE_ENGINE_TIMEZONE` with `Intl` and only proceeds when the local day and hour match `ARTICLE_PUBLISH_DAY` / `ARTICLE_PUBLISH_HOUR` (default Tuesday 09:00). This handles daylight-saving changes without touching cron. The same command works from a Hostinger cron job.

Duplicate-run prevention:

1. An exclusive lock file (`data/locks/engine.lock`, created with `O_EXCL`, stale after 2 h).
2. An idempotency key per ISO week in the configured timezone (e.g. `weekly:2026-W40`); a week with a completed or failed scheduled run is not run again automatically (failed runs are retried only by an administrator, preventing paid-API error loops).
3. A GitHub Actions `concurrency` group.

## 10. Rollback strategy

* Content: every change is a git commit; `git revert <sha>` restores any prior state.
* Single article: `node bin/engine.js unpublish <id>` sets the status to `unpublished`, re-renders (page removed from index and sitemap) and the deploy step removes it. Deleting the generated directory on the host completes removal; return a 410 if desired (see operations doc).
* Engine: `node bin/engine.js pause` or `ARTICLE_ENGINE_ENABLED=false` stops all scheduled work immediately.
* Schema: migrations are additive; each migration file documents its manual reversal.
