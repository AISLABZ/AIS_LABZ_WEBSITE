import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env for local/Hostinger use. Real environment variables always win.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(envFile); } catch { /* ignore malformed .env; validated below */ }
}

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function bool(v, dflt) {
  if (v === undefined || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function int(v, dflt, { min = -Infinity, max = Infinity } = {}) {
  if (v === undefined || v === '') return dflt;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid integer value "${v}"`);
  return n;
}

function str(v, dflt = '') {
  return v === undefined || v === '' ? dflt : String(v).trim();
}

export function loadSiteConfig(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, 'config', 'site.json'), 'utf8'));
}

/**
 * Build the runtime configuration from an env object. Pure (apart from reading
 * config/site.json) so tests can pass a custom env.
 */
export function loadConfig(env = process.env, { root = ROOT } = {}) {
  const site = loadSiteConfig(root);
  const timezone = str(env.ARTICLE_ENGINE_TIMEZONE, 'UTC');
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch {
    throw new Error(`ARTICLE_ENGINE_TIMEZONE "${timezone}" is not a valid IANA time zone`);
  }
  const publishDay = str(env.ARTICLE_PUBLISH_DAY, 'TUESDAY').toUpperCase();
  if (!DAYS.includes(publishDay)) throw new Error(`ARTICLE_PUBLISH_DAY must be one of ${DAYS.join(', ')}`);

  const siteUrl = str(env.SITE_URL, site.siteUrl).replace(/\/+$/, '');
  if (!/^https:\/\//.test(siteUrl)) throw new Error('SITE_URL must be an https:// URL');

  const llmProvider = str(env.LLM_PROVIDER, '').toLowerCase();
  const researchProvider = str(env.RESEARCH_PROVIDER, '').toLowerCase();

  return {
    root,
    site: { ...site, siteUrl },
    dataDir: path.resolve(root, str(env.ARTICLES_DATA_DIR, 'data')),
    outputDir: path.resolve(root, str(env.ARTICLES_OUTPUT_DIR, 'dist')),
    previewDir: path.resolve(root, 'preview'),

    enabled: bool(env.ARTICLE_ENGINE_ENABLED, true),
    autoPublish: bool(env.ARTICLE_AUTO_PUBLISH, false),
    timezone,
    publishDay,
    publishDayIndex: DAYS.indexOf(publishDay),
    publishHour: int(env.ARTICLE_PUBLISH_HOUR, 9, { min: 0, max: 23 }),
    requireFeaturedImage: bool(env.REQUIRE_FEATURED_IMAGE, false),
    autoUpdateInternalLinks: bool(env.AUTO_UPDATE_INTERNAL_LINKS, false),
    postPublishTimeoutSeconds: int(env.POST_PUBLISH_VERIFY_TIMEOUT_SECONDS, 600, { min: 0, max: 7200 }),

    llm: {
      provider: llmProvider, // 'openai' | 'anthropic' | ''
      model: str(env.LLM_MODEL),
      apiKey: llmProvider === 'anthropic' ? str(env.ANTHROPIC_API_KEY) : str(env.OPENAI_API_KEY),
      maxOutputTokens: int(env.LLM_MAX_OUTPUT_TOKENS, 8000, { min: 256, max: 64000 }),
      maxCallsPerRun: int(env.LLM_MAX_CALLS_PER_RUN, 30, { min: 1, max: 200 }),
      monthlyTokenBudget: int(env.LLM_MONTHLY_TOKEN_BUDGET, 0, { min: 0 }), // 0 = no guard
    },
    research: {
      provider: researchProvider, // 'brave' | 'tavily' | ''
      apiKey: str(env.RESEARCH_API_KEY),
      maxRequests: int(env.RESEARCH_MAX_REQUESTS, 8, { min: 1, max: 50 }),
      maxSourcesFetched: int(env.RESEARCH_MAX_SOURCES, 10, { min: 3, max: 30 }),
    },
    image: {
      provider: str(env.IMAGE_PROVIDER, '').toLowerCase(), // 'openai' | ''
      model: str(env.IMAGE_MODEL),
      apiKey: str(env.OPENAI_API_KEY),
    },
    gsc: {
      property: str(env.GOOGLE_SEARCH_CONSOLE_PROPERTY),
      serviceAccountJson: str(env.GOOGLE_SERVICE_ACCOUNT_JSON),
    },
    admin: {
      host: str(env.ADMIN_HOST, '127.0.0.1'),
      port: int(env.ADMIN_PORT, 8787, { min: 1, max: 65535 }),
      username: str(env.ADMIN_USERNAME),
      passwordHash: str(env.ADMIN_PASSWORD_HASH),
      sessionSecret: str(env.ADMIN_SESSION_SECRET),
    },
    cronSecret: str(env.CRON_SECRET),
    notifyWebhookUrl: str(env.NOTIFY_WEBHOOK_URL),
  };
}

/** Human-readable list of what is and is not configured (never values). */
export function describeConfig(cfg) {
  return {
    engineEnabled: cfg.enabled,
    autoPublish: cfg.autoPublish,
    schedule: `${cfg.publishDay} ${String(cfg.publishHour).padStart(2, '0')}:00 ${cfg.timezone}`,
    llmConfigured: Boolean(cfg.llm.provider && cfg.llm.model && cfg.llm.apiKey),
    researchConfigured: Boolean(cfg.research.provider && cfg.research.apiKey),
    imageGenerationConfigured: Boolean(cfg.image.provider && cfg.image.model && cfg.image.apiKey),
    searchConsoleConfigured: Boolean(cfg.gsc.property && cfg.gsc.serviceAccountJson),
    adminConfigured: Boolean(cfg.admin.username && cfg.admin.passwordHash && cfg.admin.sessionSecret),
    cronSecretConfigured: Boolean(cfg.cronSecret),
    outputDir: cfg.outputDir,
  };
}
