# AiS LABZ — Keyword clusters

The cluster map for www.aislabz.com: which page owns which search intent, what the Articles Engine writes next, and how rankings decide content work each month.

* **Where clusters live:** `config/site.json` → `topicClusters` (hub sections and strategist context). Each topic in `data/topics.json` carries a `clusterId`. Each article inherits its topic's `clusterId`.
* **Set up:** 2026-10-04, from the live sitemap, `/services/` and the 13 `/blog/` posts. **No Search Console data was available**, so positions below read *baseline pending GSC*. The first monthly review fills them in (see [Monthly review](#monthly-keyword-cluster-review)).
* **One cluster = one owner page per intent.** A service page owns the commercial query. A `/blog/` post owns the queries it already targets. A new article only takes intents that nobody owns yet.

## Cluster map

### AI clusters: written by the Articles Engine (`/articles/`)

| ID | Cluster | Commercial owner | Existing pages in cluster | Queued articles (priority · primary keyword) |
|---|---|---|---|---|
| AI-1 | AI consulting & strategy | `/services/ai-consulting/` | none | 1 · what is ai consulting (pillar) · 6 · ai strategy for business · 10 · ai readiness checklist · 11 · how to choose an ai consultant |
| AI-2 | AI automation & agents | `/services/applied-ai-automation/` | `/blog/how-ai-helps-small-businesses-save-time/` | 2 · ai automation for business (pillar) · 4 · ai agents for business · 8 · ai workflow automation · 12 · ai lead scoring |
| AI-3 | AI search visibility (AEO & GEO) | `/services/organic-growth-seo/` | `/blog/answer-engine-optimization-guide/`, `/blog/technical-seo-explained/` | 3 · seo vs aeo vs geo (pillar) · 7 · ai ready website · 9 · how to appear in google ai overviews · 13 · llms.txt |
| AI-4 | Generative AI in business | `/services/applied-ai-automation/` | none | 5 · generative ai use cases for business (pillar) · 14 · generative ai for marketing · 15 · does google penalize ai content |
| AI-5 | AI, data & measurement | `/services/data-analytics/` | none | 16 · ai marketing attribution (pillar) |

At one article a week, the queue runs about four months (16 articles). The pillars go first and the work rotates across clusters, so every hub section has an article within five weeks.

### SEO clusters: owned by `/blog/`

Gap topics sit in the queue as `suggested`. The engine never picks a `suggested` topic. To promote one, set it to `queued` (Admin → topic queue, or `edit-topic`).

| ID | Cluster | Pillar | Supporting posts | Gap topic (`suggested`) |
|---|---|---|---|---|
| S-1 | Technical SEO & audits | `/blog/technical-seo-explained/` | `/blog/what-is-an-seo-audit/` | top_018 · how to improve core web vitals |
| S-2 | Link building & authority | `/blog/quality-link-building-strategies/` | `/blog/how-a-link-building-agency-improves-rankings/`, `/blog/how-to-identify-low-quality-backlinks/`, `/blog/professional-seo-link-building-consultancy/` | top_019 · digital pr for seo |
| S-3 | SEO strategy & organic growth | `/blog/organic-growth-and-seo/` | `/blog/how-long-does-seo-take/`, `/blog/seo-consultancy-vs-agency-retainer/` | top_020 · how much does seo cost ⚠ business-fact gate |
| S-4 | Local SEO | `/blog/local-seo-strategies-to-reach-more-customers/` | (local SEO case studies under `/work/`) | top_021 · google business profile optimization |
| S-5 | International & MENA SEO | `/blog/seo-for-startups-saudi-arabia-uae/` | — | top_022 · arabic seo |

### Tracked keywords

Each cluster's primary keyword, tagged with its cluster ID. Positions come from GSC (28 days); this table holds the baseline once the first review runs.

| Cluster | Keyword | Target URL | Position (baseline) |
|---|---|---|---|
| AI-1 | what is ai consulting | /articles/ (top_001) | pending GSC |
| AI-1 | ai consulting services | /services/ai-consulting/ | pending GSC |
| AI-2 | ai automation for business | /articles/ (top_002) | pending GSC |
| AI-2 | ai automation services | /services/applied-ai-automation/ | pending GSC |
| AI-3 | seo vs aeo vs geo | /articles/ (top_005) | pending GSC |
| AI-3 | answer engine optimization | /blog/answer-engine-optimization-guide/ | pending GSC |
| AI-4 | generative ai use cases for business | /articles/ (top_007) | pending GSC |
| AI-5 | ai marketing attribution | /articles/ (top_017) | pending GSC |
| S-1 | technical seo | /blog/technical-seo-explained/ | pending GSC |
| S-1 | what is an seo audit | /blog/what-is-an-seo-audit/ | pending GSC |
| S-2 | link building strategies | /blog/quality-link-building-strategies/ | pending GSC |
| S-2 | toxic backlinks | /blog/how-to-identify-low-quality-backlinks/ | pending GSC |
| S-3 | how long does seo take | /blog/how-long-does-seo-take/ | pending GSC |
| S-3 | seo consultancy vs agency | /blog/seo-consultancy-vs-agency-retainer/ | pending GSC |
| S-4 | local seo strategies | /blog/local-seo-strategies-to-reach-more-customers/ | pending GSC |
| S-5 | seo saudi arabia | /blog/seo-for-startups-saudi-arabia-uae/ | pending GSC |

## Decisions made at setup

| Tag | Decision | Why |
|---|---|---|
| R7 · AI-3 | top_004 *How to get your business mentioned by ChatGPT* → `covered_by_existing` | `/blog/answer-engine-optimization-guide/` already targets "get your brand cited by AI assistants". A second page would split the intent. Refresh the blog post instead (refresh queue #1). |
| R7 · AI-3 | top_005 drops "what is answer engine optimization" and adds GEO/LLM-SEO queries | The AEO definition belongs to the blog post. top_005 summarises it and links there. |
| R6 · AI-1 | top_001 primary keyword "ai consulting" → "what is ai consulting"; "ai consulting services" removed | `/services/ai-consulting/` owns the commercial query. The article must link to it, not compete with it. |
| R6 · AI-1 | top_006 primary keyword "ai readiness assessment" → "ai readiness checklist" | The service page sells the assessment. The article owns the self-serve checklist. |
| R8 · AI-1…5 | Six gap topics queued (top_011–017, excluding top_004) | Intents with no page on the site. Each maps to a capability listed on a live service page. |
| R8 · S-1…5 | Five SEO gap topics added as `suggested` | Adjacent to existing blog pillars. They need a human decision on whether the engine or the blog writes them. |
| — | `/articles/` becomes the topic hub | Its first page lists every cluster: its articles, the existing blog posts and the owning service page. Until the first article ships, the page stays `noindex`. |
| — | Cannibalisation watch: `/blog/professional-seo-link-building-consultancy/` vs `/blog/how-a-link-building-agency-improves-rankings/` | Both answer "why hire outside link building help". Check in the first GSC review whether both rank for the same queries (R7). |

### Confirmed-claims register

Copy may use these facts only. Each one comes from the live site on 2026-10-04.

* Services and their listed capabilities: `config/site.json` → `services`.
* "Free 15-minute diagnostic"; one-to-two-week diagnostic (from `/services/`).
* Pricing *model*: project work is quoted fixed scope and fixed date; ongoing work is a fixed monthly retainer, month to month after a three-month setup period. **No prices.** top_020 stays `suggested` until the owner confirms what the article may say about cost.
* Markets: United States, Saudi Arabia, UAE, United Kingdom, Singapore, Canada, Pakistan; remote-first with no public office.

## Content rules (apply the first that fits)

Once GSC data exists, apply these to every page in a cluster, `/blog/` posts included.

| Rule | When | Action | Risk |
|---|---|---|---|
| R1 Snippet | pos ≤ 3, ≥ 30 impr, CTR < 3% | rewrite title + meta description | L |
| R2 Striking distance | pos 4–10, ≥ 20 impr | primary keyword in title/H1/first 100 words, 40–60 word direct answer, supporting keywords as H2s, 2–3 exact-anchor internal links in | meta/links L · copy H |
| R3 Expand | pos 11–20 | add the sections the supporting keywords ask for + internal links | H |
| R4 Rewrite/rethink | pos > 20, ≥ 50 impr | check intent against page one; rewrite or retarget | H |
| R5 Slipped | down ≥ 3 positions MoM, ≥ 20 impr | find the cause first (ranking URL changed? noindex? recent edit?), then revert or refresh | depends |
| R6 Wrong page | ranking URL ≠ target | exact-anchor internal links to the target, align its title/H1; never weaken a page ranking ≤ 3 | links L · copy H |
| R7 Cannibalised | two or more of our URLs on one cluster | keep the best, merge, 301 the rest | H + L |
| R8 Gap | ≥ 30 impr/month and no page, or a strategic cluster with no page | add a topic (`add-topic` with `clusterId`) | H |

**Guardrails:**

* At most 4 content refreshes a month (R2–R4, R7), highest impressions first. Meta and link changes don't count toward the limit.
* 28-day cool-down per page.
* Copy may only use facts from the confirmed-claims register.
* Tag every action with rule + cluster ID (e.g. `R2 · AI-3`).
* Engine articles are refreshed by hand per [Operations → Article updates](articles-engine-operations.md#article-updates). Never rewrite them automatically.
* L changes (meta, links, redirects, schema) can ship in the weekly run. H changes (visible copy, merges, new pages) go out as a reviewed PR.

## Refresh queue

| # | Cluster · rule | Page | Action | Status | Last changed | Result next month |
|---|---|---|---|---|---|---|
| 1 | AI-3 · R7 | /blog/answer-engine-optimization-guide/ | Absorb the retired top_004 intent: add a "How to get mentioned by ChatGPT and Gemini" H2 with a 40–60 word direct answer; link out to top_005 and top_011 once they are live | open | — | — |
| 2 | AI-2 · R6 | /blog/how-ai-helps-small-businesses-save-time/ | Once top_002 is live, add one exact-anchor link "AI automation for business" to it | waits on top_002 | — | — |
| 3 | S-1 · R6 | /blog/technical-seo-explained/ | Once top_009 is live, link it from the structured-data section | waits on top_009 | — | — |
| 4 | S-2 · R7 | /blog/professional-seo-link-building-consultancy/ vs /blog/how-a-link-building-agency-improves-rankings/ | Check for shared queries in the first GSC pull; if shared, differentiate or merge | needs GSC | — | — |

## Monthly keyword-cluster review

This runs after the Search Console pull, once a month (also listed in [Operations](articles-engine-operations.md#monthly-keyword-cluster-review)):

1. **Pull:** Search Console Performance, last 28 days vs the previous 28. Export by query and by page, all four metrics. Keep queries with ≥ 8 impressions.
2. **Re-cluster:** map each query to a cluster above. Off-topic and zero-click generic queries are orphans: report them only, take no action.
3. **Find ranking URLs:** for each cluster's primary and supporting keywords, record the URL that ranks. Flag cases where the ranking URL differs from the target, where two of our URLs compete, and where demand has no page.
4. **Apply the rules** (R1–R8, first that fits) within the guardrails. Write each action into the refresh queue with its rule and cluster tag.
5. **Write the work:** new intents go in as topics (`add-topic` with `clusterId`). Refreshes go in as PRs against `data/articles/<id>.json`, or against the blog source for `/blog/` posts.
6. **Close the loop:** fill in last month's "Result next month" column (before → after position and clicks), update the tracked-keywords table, and commit this file.

Nothing goes live without a reviewed PR. The first review sets the baseline, so the R5 "slipped" rule starts applying from the second month.
