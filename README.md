# AISLabz — Articles section & Articles Engine

The public **Articles** section of www.aislabz.com (`/articles/`, `/articles/{slug}/`) and the engine that researches, writes, checks and publishes **one evidence-backed article per week**.

* Zero runtime dependencies (Node.js ≥ 20.12).
* Static, fast, crawlable output: `/articles/`, paginated index, article pages, `sitemap-articles.xml`.
* A staged pipeline with a separate model call per responsibility: research → strategy → writing → SEO/AEO/VSO/GEO optimisation → fact-check → link/technical-SEO validation → publication gate → publish → live verification → Search Console monitoring.
* Research is verified, not remembered: every claim carries a verbatim quote that must appear in the fetched source page.
* **Human approval by default** (`ARTICLE_AUTO_PUBLISH=false`).

```bash
node bin/engine.js migrate     # set up the editorial database + topic queue
node bin/engine.js status      # what's configured, queue, recent runs
npm test                       # test suite
node bin/engine.js help        # all commands
npm run admin                  # admin interface (after setting ADMIN_* variables)
```

Documentation:

* [Architecture](docs/articles-engine-architecture.md)
* [Setup](docs/articles-engine-setup.md): APIs, environment variables, Search Console, Hostinger, auto-publishing
* [Operations](docs/articles-engine-operations.md): weekly workflow, monitoring, QA failures, updates, rollback
* [Keyword clusters](docs/keyword-clusters.md): cluster map, topic queue rationale, ranking rules and the monthly review

Layout:

```
bin/engine.js            CLI
src/pipeline/            stages, orchestrator (run.js), publication gate, admin actions
src/research/            search providers, source scoring, research agent
src/render/              HTML templates, structured data, sitemap, static build
src/gsc/                 Search Console client + monitoring
src/admin/               admin server (auth, CSRF, cron endpoint)
config/site.json         brand, navigation, contact URL, verified services
assets/articles.css      Articles design (tokens at the top)
data/                    editorial database (git-versioned JSON)
migrations/              data migrations
.github/workflows/       CI + scheduled engine + Hostinger deploy
```
