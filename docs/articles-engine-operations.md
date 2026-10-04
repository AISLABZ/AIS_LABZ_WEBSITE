# AISLabz Articles Engine — Operations

## Weekly workflow

Every Tuesday at 09:00 (in `ARTICLE_ENGINE_TIMEZONE`), the engine:

1. **Site inventory**: reads the live `sitemap.xml`, the configured services and pillar pages, and existing articles.
2. **Search Console**: collects 28 days of clicks, impressions, CTR, position and queries per article, plus URL Inspection diagnostics.
3. **Content refresh**: flags existing articles with broken sources or internal links, low CTR, unanswered queries, possible cannibalization, or more than 12 months since review.
4. **Topic selection**: picks the highest-priority `queued` topic. It skips topics an existing article already covers (`covered_by_existing`) so you can update that article instead.
5. **Research**: runs searches, fetches sources and extracts claims. Each claim must carry a verbatim quote found in the fetched page. The run stops with `needs_research` if evidence is insufficient (fewer than 6 verified claims from 3 sources).
6. **Strategy**: plans intent, outline, AEO/VSO/GEO opportunities and internal links. It stops with `needs_review` if cannibalization is serious.
7. **Writer → optimizer**: produces structured content, metadata, internal links and a featured-image brief.
8. **QA**: runs deterministic checks plus a model fact-check against the evidence. One revision is allowed, then the result is final.
9. **Link validation, technical SEO validation, duplication check → publication gate** (`APPROVED` / `REJECTED`).
10. **Manual mode (default)**: the article is saved as `draft` (QA passed), a preview is rendered and you are notified. **Auto mode:** it is rendered, deployed, then verified live.

## Monitoring

* **Admin dashboard** shows the topic queue, current article, drafts, QA results, published articles, recent runs with failures and durations, next scheduled run, Search Console performance, refresh opportunities and monthly LLM usage.
* **Run logs** are stored in `data/runs/<runId>.json`. Each run records trigger, stages (status, duration, summary, error), selected topic, article id, published URL, notifications and per-call LLM token usage. They never contain secret values.
* **CLI:** `node bin/engine.js status`.
* **Notifications** (`NOTIFY_WEBHOOK_URL`) cover: draft awaiting approval, QA rejection, stopped runs (missing research, cannibalization), failed runs and failed live verification.

## QA failures

A `qa_failed` article has a full report under Admin → article. It lists:

* **Gate reasons**, e.g. "Citations not backed by verified research", "Numeric claim without a citation", "Broken links", "Technical SEO".
* **Issues** with severity (critical/major/minor), type and the offending excerpt.

Options:
* **Regenerate**: rejects the draft and reruns the topic.
* **Reject**: marks the topic `needs_review`; edit the topic first (e.g. narrow the primary query), then set it back to `queued`.
* Never hand-edit a draft to bypass the gate. If you edit content in `data/articles/<id>.json`, rerun QA by regenerating.

## Article updates

* The refresh engine **never rewrites articles automatically** and never changes dates.
* An article with broken sources moves to `needs_update`. It stays live, and the dashboard explains why.
* To update an article, edit its JSON (content blocks, sources) in a pull request and set `updatedAt` to now **only if the change is substantive**. Then run `node bin/engine.js build` and deploy. Fixing a typo or adding a link is not a substantive update.
* Internal links to a newly published article are **proposed** in the run output. They are applied automatically only when `AUTO_UPDATE_INTERNAL_LINKS=true`, and applying them does not change `updatedAt`.

## Interpreting Search Console data

| Signal | Meaning | Action |
| --- | --- | --- |
| High impressions, CTR below 1.5%, position 1–12 | Ranks but doesn't attract clicks | Test a clearer title or meta description |
| Queries in the article's data that the text doesn't cover | Unmet intent | Consider a substantive expansion |
| Two AISLabz URLs earning impressions for the same query | Possible cannibalization | Consolidate, or differentiate intent |
| High-impression site queries with no matching article | Content gap | Add a topic if the intent is distinct |
| URL Inspection `coverageState` | Google's own words, stored verbatim | "Discovered/Crawled – currently not indexed" is normal for new pages; improve internal links and wait |

Search Console data lags about 2–3 days and is noisy for new pages. Judge trends over 4+ weeks. Indexing is never guaranteed, and the engine never reports "indexed" by itself.

## Monthly keyword-cluster review

Run this once a month, after the Search Console data is in. The steps, rules (R1–R8) and guardrails live in [keyword-clusters.md](keyword-clusters.md#monthly-keyword-cluster-review). In short: re-cluster the queries, find the ranking URL for each cluster, apply the first rule that fits, write the actions into the refresh queue or the topic queue, fill in last month's before → after results, and commit the doc.

* Every topic has a `clusterId` that matches `config/site.json` → `topicClusters`. Articles inherit it. It drives the `/articles/` topic hub, related articles and the strategist's cluster context.
* `/blog/` posts that already own an intent are listed in each cluster's `relatedReading`. The strategist is told not to target their queries.

## Adding topics

* Admin → *Add topic*, or `node bin/engine.js add-topic '{"topic":"…","primaryQuery":"…","secondaryQueries":["…"],"priority":20,"clusterId":"AI-2"}'`. Always set a `clusterId` from [keyword-clusters.md](keyword-clusters.md).
* `suggested` topics are never picked automatically. Set them to `queued` to schedule them.
* Lower numbers run first. Edit priority or status from the dashboard or with `edit-topic`.
* Duplicate primary queries are refused. Keep each topic's intent distinct, and use `notes` to record how it differs from neighbouring topics.

## Stopping automation

* Pause the schedule: Admin → *Pause automation*, or `node bin/engine.js pause`.
* Stop everything: `ARTICLE_ENGINE_ENABLED=false`.
* Stop publishing but keep drafting: `ARTICLE_AUTO_PUBLISH=false`.
* On GitHub you can also disable the *Articles Engine* workflow.

## Failures and recovery

| Situation | What happened | Recovery |
| --- | --- | --- |
| `stopped / needs_research` | Research provider missing, or not enough verified evidence | Configure the provider or adjust the topic, then *Retry* the run |
| `stopped / llm_not_configured` | LLM variables missing | Configure them, then retry |
| `stopped / cannibalization` | An existing page serves the same intent | Update that page instead, or redefine the topic |
| `stopped / qa_failed` | Gate rejected the draft | Read the report; regenerate or reject |
| `failed` | Unexpected error (API outage, budget reached) | Read `errors` in the run; fix, then *Retry*. Failed runs never auto-retry |
| `publication_failed` | Live URL didn't verify (HTTP status, title, canonical, robots, body, schema, image, sitemap) | Fix the deploy, then *Publish* again or run `node bin/engine.js verify <id>` |
| Lock stuck | A crashed process left `data/locks/engine.lock` | It expires after 2 h; or delete the file once no run is active |

## Rollback

* **One article:** `node bin/engine.js unpublish <id> "reason"` (or Admin → *Unpublish*), then deploy. It is removed from the index, related links and sitemap. To tell crawlers it is gone, optionally add a `410` rule for the URL in `.htaccess`.
* **Any data change:** every change is a git commit in `data/`, so `git revert <sha>`, then `node bin/engine.js build` and deploy.
* **Engine version:** revert the code commit; the data format is versioned (`data/schema-version.json`) and migrations are additive.
* **Whole section:** delete `articles/`, `assets/articles/` and `sitemap-articles.xml` from the server and remove the `Sitemap:` line from robots.txt. The rest of the site is unaffected.
