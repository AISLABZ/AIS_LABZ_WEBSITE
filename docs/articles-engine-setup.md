# AISLabz Articles Engine — Setup

This guide takes the engine from "installed" to "generating reviewed drafts every Tuesday". Auto-publishing stays **off** until you turn it on yourself.

## 0. Requirements

* Node.js **20.12 or newer** (22 LTS recommended). There are no npm dependencies, so `npm install` is not needed.
* A GitHub repository (this one) **or** a Hostinger plan with SSH + Node.js (Business/Cloud plans) for running the engine.
* File-based hosting for `www.aislabz.com` (Hostinger `public_html`). If the live site is built with **Hostinger Website Builder**, files cannot be added under `/articles/`. In that case either move the site to file hosting, serve the articles from a subdomain such as `articles.aislabz.com` (set `SITE_URL` accordingly), or proxy `/articles/` with a CDN rule.

```bash
node bin/engine.js migrate   # creates the editorial database + topic queue
node bin/engine.js status    # shows what is configured (never prints secret values)
npm test                     # runs the test suite
```

## 1. Match the live site's look and navigation

The build environment could not access www.aislabz.com, so these two files hold everything site-specific:

1. **`config/site.json`**
   * `brandName`, `organizationName`, `logoUrl` (absolute or site-relative; used in Organization schema), `defaultOgImage`.
   * `navigation` and `footerLinks`: copy the live header and footer links.
   * `contactUrl`: the real contact page path. The link validator checks it, so a wrong path will block publication.
   * `sameAs`: the official social profile URLs.
   * **`services`**: list only services that the live site actually offers:
     ```json
     { "name": "AI Automation", "url": "/services/ai-automation",
       "capabilities": ["workflow assessment", "automation design", "implementation"],
       "topics": ["automation", "workflows"] }
     ```
     Until this list is filled in, every article ends with a neutral "talk to us" CTA, and any AISLabz capability claim fails QA. That is deliberate.
   * `pillarPages`: optional list of `{ "title", "url" }` hub pages for internal linking.
2. **`assets/articles.css`**: change only the tokens in `:root` (fonts, colours, radius, container width) to match the site's design system. If the live site loads a web font, add the same font to `--ae-font-sans` and `--ae-font-serif`.

## 2. Required APIs and accounts

| Purpose | Required? | Provider options | Variables |
| --- | --- | --- | --- |
| LLM (planning, writing, QA) | Yes | OpenAI or Anthropic | `LLM_PROVIDER`, `LLM_MODEL`, `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |
| Web research | **Yes**: without it the engine stops and flags the topic | Brave Search API or Tavily | `RESEARCH_PROVIDER`, `RESEARCH_API_KEY` |
| Search Console | Recommended | Google Cloud service account | `GOOGLE_SEARCH_CONSOLE_PROPERTY`, `GOOGLE_SERVICE_ACCOUNT_JSON` |
| Featured images | Optional | OpenAI Images | `IMAGE_PROVIDER=openai`, `IMAGE_MODEL` (uses `OPENAI_API_KEY`) |
| Notifications | Recommended | Any Slack/Teams/Discord-style incoming webhook | `NOTIFY_WEBHOOK_URL` |
| Deployment (GitHub Actions path) | For automatic deploys | Hostinger FTP account | GitHub secrets `HOSTINGER_FTP_HOST`, `HOSTINGER_FTP_USER`, `HOSTINGER_FTP_PASSWORD`; variable `HOSTINGER_REMOTE_DIR` |

### LLM setup

Set `LLM_PROVIDER` (`openai` or `anthropic`) and `LLM_MODEL` to an exact model id from your provider's current model list. **No default model is assumed.** Use a strong model, because writing and fact-checking quality depend on it. Cost limits:

* `LLM_MAX_OUTPUT_TOKENS` (default 8000) caps each response.
* `LLM_MAX_CALLS_PER_RUN` (default 30) is a hard cap per run. A typical run uses about 15 calls: query planning, one extraction per source (up to `RESEARCH_MAX_SOURCES`), strategist, writer, optimizer, fact-check, plus one optional revision.
* `LLM_MONTHLY_TOKEN_BUDGET` (default 0 = off) stops all generation once that many tokens have been used in the calendar month. Usage is recorded in `data/engine-state.json`.
* Failed runs are **not** retried automatically. Only an administrator can retry, so an error cannot loop on paid APIs.

### Research provider setup

* **Brave Search API**: create a key at the Brave Search API dashboard, then set `RESEARCH_PROVIDER=brave` and `RESEARCH_API_KEY`.
* **Tavily**: create a key in the Tavily dashboard, then set `RESEARCH_PROVIDER=tavily` and `RESEARCH_API_KEY`.
* `RESEARCH_MAX_REQUESTS` (default 8) caps search queries per run; `RESEARCH_MAX_SOURCES` (default 10) caps pages fetched.

The engine fetches every source itself. A claim is kept only if its supporting quote appears **verbatim** in the fetched page text, and articles may only cite those verified URLs.

### Google Search Console setup

1. In Google Cloud Console, create a project, enable the **Google Search Console API**, and create a **service account**. Create a JSON key for it.
2. In Search Console, go to *Settings → Users and permissions → Add user*, enter the service account's email, and grant **Full** permission. Full is needed for sitemap submission; *Restricted* works for reporting only.
3. Set `GOOGLE_SEARCH_CONSOLE_PROPERTY` exactly as the property appears, e.g. `sc-domain:aislabz.com` or `https://www.aislabz.com/`.
4. Set `GOOGLE_SERVICE_ACCOUNT_JSON` to the key file contents, either raw JSON or base64: `base64 -w0 key.json`.
5. Test it with `node bin/engine.js gsc`.

The engine uses the Search Analytics API (performance), the URL Inspection API (diagnostics, stored verbatim) and the Sitemaps API. It does **not** use the Google Indexing API, which only supports job-posting and livestream pages.

## 3. Choose where the engine runs

### Option A (recommended): GitHub Actions + FTPS deploy to Hostinger

1. Under *Repository → Settings → Secrets and variables → Actions*, add:
   * **Secrets:** `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, `RESEARCH_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `NOTIFY_WEBHOOK_URL`, `HOSTINGER_FTP_HOST`, `HOSTINGER_FTP_USER`, `HOSTINGER_FTP_PASSWORD`.
   * **Variables:** `LLM_PROVIDER`, `LLM_MODEL`, `RESEARCH_PROVIDER`, `ARTICLE_ENGINE_TIMEZONE` (e.g. `Europe/London`), `ARTICLE_AUTO_PUBLISH=false`, `GOOGLE_SEARCH_CONSOLE_PROPERTY`, `HOSTINGER_REMOTE_DIR` (usually `public_html` or `domains/aislabz.com/public_html`), plus any optional settings from `.env.example`.
2. The **Articles Engine** workflow (`.github/workflows/articles-engine.yml`) runs hourly Monday to Wednesday UTC. The engine itself decides when the local Tuesday 09:00 slot has arrived (daylight-saving aware) and runs once per ISO week.
3. The workflow commits `data/` (the editorial database) back to the repository and uploads draft previews as a downloadable **artifact** named `article-previews`.
4. Deployment uploads only `articles/`, `assets/articles/` and `sitemap-articles.xml` over FTPS. It never touches other files on the server. The `articles/` folder on the server is mirrored with deletion, so it must contain only engine output.

### Option B: directly on Hostinger (SSH + Node.js)

1. Clone the repository outside `public_html`, e.g. `~/articles-engine`, then copy `.env.example` to `.env` and fill it in.
2. Set `ARTICLES_OUTPUT_DIR` to the site's `public_html` path. The build writes only `articles/`, `assets/articles/` and `sitemap-articles.xml` there.
3. In hPanel → **Advanced → Cron Jobs**, add an hourly job:
   ```
   cd ~/articles-engine && /usr/bin/env node bin/engine.js scheduled-run --verify >> data/runs/cron.log 2>&1
   ```
   (Use the Node path hPanel shows for your plan.) `--verify` checks the live URL straight after rendering, because no separate deploy step is needed.
4. Alternatively, run the admin server as a Node.js app and trigger it by cron:
   `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<admin-host>/cron/run?verify=1`

## 4. robots.txt and sitemaps

Add this line to the live `robots.txt` (and keep any existing `Sitemap:` lines):

```
Sitemap: https://www.aislabz.com/sitemap-articles.xml
```

If the site already has a sitemap **index**, also add `https://www.aislabz.com/sitemap-articles.xml` to it. Make sure `robots.txt` does not disallow `/articles/`. Submit the sitemap in Search Console once; the engine resubmits automatically when Search Console is configured. Add an **Articles** link to the live site's main navigation so the section is discoverable.

## 5. Admin interface

```bash
echo -n 'a-long-unique-password' | node bin/engine.js hash-password   # → ADMIN_PASSWORD_HASH
openssl rand -base64 48                                                # → ADMIN_SESSION_SECRET
ADMIN_USERNAME=editor npm run admin                                    # http://127.0.0.1:8787
```

The admin server binds to `127.0.0.1` by default. To reach it remotely, use an SSH tunnel (`ssh -L 8787:127.0.0.1:8787 host`) or put it behind HTTPS. If `ADMIN_HOST` is not localhost, cookies are marked `Secure`, so HTTPS is required. On the GitHub Actions path, the same controls are available as **workflow_dispatch** commands.

## 6. Enable or disable automation

| Goal | How |
| --- | --- |
| Stop everything immediately | `ARTICLE_ENGINE_ENABLED=false` (GitHub variable or `.env`) |
| Pause the weekly schedule only (manual runs still work) | Admin → *Pause automation*, or `node bin/engine.js pause` |
| Resume | Admin → *Resume automation*, or `node bin/engine.js resume` |
| Change day/time | `ARTICLE_PUBLISH_DAY`, `ARTICLE_PUBLISH_HOUR`, `ARTICLE_ENGINE_TIMEZONE` |

## 7. Enable auto-publishing (only after testing)

Recommended threshold: at least **three** drafts reviewed and published manually with no factual corrections needed.

1. Set `ARTICLE_AUTO_PUBLISH=true`.
2. From then on, an article is published **only** if every gate passes: research, fact-check, links, technical SEO, duplication and cannibalization. Rejected drafts are never published.
3. Keep `NOTIFY_WEBHOOK_URL` configured so failures reach you.

To turn auto-publishing off again, set `ARTICLE_AUTO_PUBLISH=false`; it takes effect on the next run.

## 8. Manually approve an article

1. Open the draft preview: Admin → article → *Open preview*, or download the `article-previews` artifact from the workflow run.
2. Read it fully. Check every source in the **Research** table, since each claim shows the verbatim quote it came from.
3. Approve: Admin → *Approve*, or `node bin/engine.js approve <articleId>`, or workflow_dispatch `approve` with the id.
4. Publish: Admin → *Publish*, or `node bin/engine.js publish <articleId>`, or workflow_dispatch `publish`. This renders the page, deploys it, then runs `verify`.
5. The status becomes `published` **only** after the live URL passes verification.

## 9. Recover from failures

See `docs/articles-engine-operations.md` → *Failures and recovery*.
