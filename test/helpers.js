import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadConfig } from '../src/config.js';
import { Store } from '../src/store/store.js';
import { migrate } from '../src/store/migrate.js';

/** Isolated project root (config + assets copied) with its own data/dist dirs. */
export async function setup(envOverrides = {}, siteOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-test-'));
  fs.mkdirSync(path.join(dir, 'config'));
  fs.mkdirSync(path.join(dir, 'assets'));
  const site = { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'site.json'), 'utf8')), ...siteOverrides };
  fs.writeFileSync(path.join(dir, 'config', 'site.json'), JSON.stringify(site));
  fs.copyFileSync(path.join(ROOT, 'assets', 'articles.css'), path.join(dir, 'assets', 'articles.css'));
  const env = { ARTICLE_ENGINE_TIMEZONE: 'Europe/London', ...envOverrides };
  const cfg = loadConfig(env, { root: dir });
  const store = new Store(cfg.dataDir);
  await migrate(store, { migrationsDir: path.join(ROOT, 'migrations') });
  return { dir, cfg, store, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export const SOURCES = {
  'https://www.nist.gov/itl/ai-risk-management-framework': {
    title: 'AI Risk Management Framework | NIST',
    text: 'The NIST AI Risk Management Framework is intended for voluntary use and to improve the ability to incorporate trustworthiness considerations into the design, development, use, and evaluation of AI products, services, and systems. The framework was released on January 26, 2023. It is organized around four functions: Govern, Map, Measure and Manage. Organizations can use the framework to manage risks to individuals, organizations, and society associated with artificial intelligence.',
  },
  'https://oecd.ai/en/ai-principles': {
    title: 'OECD AI Principles',
    text: 'The OECD AI Principles promote use of AI that is innovative and trustworthy and that respects human rights and democratic values. Adopted in May 2019, they set standards for AI that are practical and flexible enough to stand the test of time. The principles were updated in May 2024 to reflect technological and policy developments. Governments use the principles to shape policies and create AI risk frameworks.',
  },
  'https://arxiv.org/abs/2401.00001': {
    title: 'Measuring outcomes of enterprise AI pilots',
    text: 'In a sample of 120 enterprise AI pilots, projects with a defined baseline metric before launch were more likely to progress to production. We find that pilot success depends on data readiness, process ownership and an explicit evaluation plan agreed before development begins. Pilots without an owner for the business process rarely reached production in our sample.',
  },
};

export function pageHtml(title, text) {
  const body = `${text} `.repeat(3);
  return `<!doctype html><html><head><title>${title}</title><meta property="article:published_time" content="2024-05-03"></head><body><article><p>${body}</p></article></body></html>`;
}

/** Fake web: research sources, live site sitemap, and (optionally) a served output dir. */
export function fakeFetch({ outputDir, siteUrl = 'https://www.aislabz.com', broken = [] } = {}) {
  return async (url, opts = {}) => {
    const u = new URL(url);
    const headers = new Headers();
    if (broken.includes(url)) return { ok: false, status: 404, url, headers, body: '' };
    if (SOURCES[`${u.origin}${u.pathname}`]) {
      const s = SOURCES[`${u.origin}${u.pathname}`];
      return { ok: true, status: 200, url, headers, body: opts.method === 'HEAD' ? '' : pageHtml(s.title, s.text) };
    }
    if (u.origin === siteUrl) {
      if (u.pathname === '/sitemap.xml') {
        return { ok: true, status: 200, url, headers, body: `<?xml version="1.0"?><urlset><url><loc>${siteUrl}/</loc></url><url><loc>${siteUrl}/contact</loc></url></urlset>` };
      }
      if (u.pathname === '/' || u.pathname === '/contact') return { ok: true, status: 200, url, headers, body: '<title>AISLabz</title>' };
      if (outputDir) {
        const rel = u.pathname.endsWith('/') ? `${u.pathname}index.html` : u.pathname;
        const file = path.join(outputDir, rel);
        if (fs.existsSync(file)) return { ok: true, status: 200, url, headers, body: opts.method === 'HEAD' ? '' : fs.readFileSync(file, 'utf8') };
      }
      return { ok: false, status: 404, url, headers, body: 'not found' };
    }
    return { ok: false, status: 404, url, headers, body: '' };
  };
}

export function fakeSearch() {
  return async () => Object.entries(SOURCES).map(([url, s]) => ({ url, title: s.title, snippet: '' }));
}

const SENTENCE = 'Leaders should agree what success means before work starts, name an owner for the process being changed, and decide how results will be measured against a baseline.';

export function goodDraft() {
  const nist = 'https://www.nist.gov/itl/ai-risk-management-framework';
  const oecd = 'https://oecd.ai/en/ai-principles';
  const arxiv = 'https://arxiv.org/abs/2401.00001';
  const para = (n) => ({ type: 'p', text: `${SENTENCE} This section explains point ${n} in practical terms for business teams planning their next step.` });
  return {
    title: 'AI Consulting Explained: How Businesses Move From AI Experiments to Measurable Results',
    excerpt: 'What AI consulting is, why many AI pilots stall, and a practical way to move from experiments to measured business results with clear ownership and evaluation.',
    content: [
      { type: 'h2', text: 'What is AI consulting?' },
      { type: 'p', text: 'AI consulting is advisory and delivery support that helps an organisation decide where AI can create value, and then design, implement and govern those systems. Leaders should agree what success means before work starts.' },
      { type: 'h2', text: 'Why do AI pilots stall?' },
      { type: 'p', text: `Pilots stall when nobody owns the process being changed. Research on enterprise pilots found that [projects with a defined baseline metric](${arxiv}) were more likely to reach production.`, evidence: ['E5'] },
      para(1),
      { type: 'h3', text: 'Data readiness and ownership' },
      para(2),
      { type: 'h2', text: 'How should risk be governed?' },
      { type: 'p', text: `The [NIST AI Risk Management Framework](${nist}) is organised around four functions: Govern, Map, Measure and Manage. The [OECD AI Principles](${oecd}) were updated in May 2024.`, evidence: ['E1', 'E3'] },
      { type: 'ul', items: ['Define a baseline before launch.', 'Name a process owner.', 'Agree an evaluation plan.'] },
      { type: 'h2', text: 'A practical path from experiment to results' },
      para(3),
      para(4),
    ],
  };
}

export const STRATEGY = {
  searchIntent: 'informational',
  primaryQuery: 'ai consulting',
  secondaryQueries: ['what is ai consulting'],
  longTailQuestions: ['what does an ai consultant do'],
  semanticEntities: ['NIST AI RMF', 'OECD AI Principles'],
  angle: 'From pilots to measured outcomes with ownership and evaluation.',
  outline: [
    { heading: 'What is AI consulting?', level: 2, purpose: 'definition' },
    { heading: 'Why do AI pilots stall?', level: 2, purpose: 'problem' },
    { heading: 'How should risk be governed?', level: 2, purpose: 'governance' },
    { heading: 'A practical path', level: 2, purpose: 'framework' },
  ],
  internalLinkOpportunities: [{ path: '/contact', reason: 'contact' }],
  relevantServices: [],
  recommendedCitations: ['E1'],
  cannibalization: { risk: 'none', explanation: 'No existing article.' },
  aeoOpportunities: ['definition'],
  vsoQuestions: ['What is AI consulting?'],
  geoConsiderations: ['explicit definitions'],
};

export const OPTIMIZATION = {
  seoTitle: 'AI Consulting Explained: From Pilots to Results',
  metaDescription: 'What AI consulting is, why AI pilots stall, and how to move from experiments to measurable results with clear ownership and evaluation.',
  slug: 'ai-consulting-explained',
  primaryTopic: 'AI Consulting',
  secondaryTopics: ['AI strategy', 'AI governance'],
  headingEdits: [],
  internalLinks: [],
  featuredImage: { concept: 'A team mapping a workflow on a whiteboard', prompt: 'Editorial photo of a team mapping a business workflow on a whiteboard', alt: 'Team mapping a business workflow on a whiteboard' },
};

/** Fake LLM keyed by stage. `overrides[stage]` may be a value or a function(opts, callNo). */
export function fakeLlm(overrides = {}) {
  const calls = [];
  const responses = {
    'research.plan': { queries: ['ai consulting framework', 'ai pilot to production'] },
    'research.extract': (opts) => {
      const { sourceUrl } = JSON.parse(opts.user);
      const s = SOURCES[sourceUrl];
      const sentences = s.text.split(/(?<=\.)\s+/).slice(0, 2);
      return {
        claims: [
          ...sentences.map((q) => ({ claim: q, quote: q, confidence: 'high' })),
          { claim: 'Fabricated statistic', quote: 'Ninety-nine percent of companies adopted AI in 2025 according to this page.', confidence: 'high' },
        ],
        entities: [s.title],
        questions: ['What is AI consulting?'],
      };
    },
    strategist: STRATEGY,
    writer: goodDraft(),
    optimizer: OPTIMIZATION,
    factcheck: { verdict: 'pass', summary: 'All claims supported.', issues: [] },
    ...overrides,
  };
  return {
    configured: true,
    calls,
    async json(stage, opts) {
      calls.push(stage);
      const r = responses[stage];
      if (r instanceof Error) throw r;
      const v = typeof r === 'function' ? r(opts, calls.filter((c) => c === stage).length) : r;
      if (v instanceof Error) throw v;
      return JSON.parse(JSON.stringify(v));
    },
  };
}

export const silentLogger = { info() {}, warn() {}, error() {}, child() { return silentLogger; } };
