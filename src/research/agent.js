import { safeFetch, extractHtml } from '../lib/http.js';
import { normalizeForMatch, truncate } from '../lib/text.js';
import { assertValid } from '../lib/validate.js';
import { classifySource } from './source-quality.js';

const PLAN_SCHEMA = {
  type: 'object',
  required: ['queries'],
  properties: {
    queries: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 3, maxLength: 200 } },
    hypothesisedGaps: { type: 'array', items: { type: 'string' } },
  },
};

const EXTRACT_SCHEMA = {
  type: 'object',
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        required: ['claim', 'quote', 'confidence'],
        properties: {
          claim: { type: 'string', minLength: 10, maxLength: 600 },
          quote: { type: 'string', minLength: 20, maxLength: 800 },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    entities: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
  },
};

export const RESEARCH_REPORT_SCHEMA = {
  type: 'object',
  required: ['topic', 'researchDate', 'claims', 'questions', 'entities', 'contentGaps', 'notes', 'status'],
  properties: {
    status: { type: 'string', enum: ['completed', 'insufficient', 'failed'] },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        required: ['evidenceId', 'claim', 'quote', 'sourceTitle', 'sourceUrl', 'publisher', 'publishedDate', 'accessedDate', 'sourceType', 'confidence'],
        properties: {
          sourceUrl: { type: 'string', pattern: '^https://' },
          sourceType: { type: 'string', enum: ['primary', 'secondary'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

const MIN_VERIFIED_CLAIMS = 6;
const MIN_DISTINCT_SOURCES = 3;
const CONF_RANK = { low: 0, medium: 1, high: 2 };

export function quoteAppearsIn(quote, text) {
  const q = normalizeForMatch(quote).replace(/["'.…]+$/g, '').replace(/^["'.…]+/g, '');
  if (q.length < 20) return false;
  return normalizeForMatch(text).includes(q);
}

function canonicalUrl(u) {
  try { const x = new URL(u); x.hash = ''; return x.toString(); } catch { return null; }
}

/**
 * Research agent. Uses a configured search API to find sources, fetches every
 * source, and keeps only claims whose verbatim supporting quote is present in
 * the fetched page text. Nothing is taken from model memory.
 */
export async function runResearch({ topic, cfg, llm, search, fetchPage = (url) => safeFetch(url, { timeoutMs: 15000 }), logger, now = new Date() }) {
  const researchDate = now.toISOString().slice(0, 10);
  const notes = [];

  // 1. Query plan (model proposes queries; it does not supply facts).
  const plan = await llm.json('research.plan', {
    system: 'You plan web research for an evidence-based business article. Propose precise search queries that will surface primary sources: official documentation, government and standards bodies, academic research, original surveys and reputable industry research. Do not state any facts.',
    user: JSON.stringify({ topic: topic.topic, primaryQuery: topic.primaryQuery, secondaryQueries: topic.secondaryQueries, maxQueries: cfg.research.maxRequests }),
    schema: PLAN_SCHEMA,
    maxTokens: 1200,
  });
  const queries = [...new Set([topic.primaryQuery, ...plan.queries].map((q) => q.trim()).filter(Boolean))].slice(0, cfg.research.maxRequests);

  // 2. Search (bounded by RESEARCH_MAX_REQUESTS).
  const seen = new Map();
  let searchErrors = 0;
  for (const [qi, q] of queries.entries()) {
    try {
      const results = await search(q, { count: 10 });
      for (const [ri, r] of results.entries()) {
        const url = canonicalUrl(r.url);
        if (!url || seen.has(url)) continue;
        const cls = classifySource(url);
        if (cls.score < 0) continue;
        seen.set(url, { ...r, url, ...cls, rank: cls.score - qi * 2 - ri });
      }
    } catch (err) {
      searchErrors++;
      logger?.warn('search failed', { query: q, err });
    }
  }
  if (searchErrors === queries.length) {
    return { report: emptyReport(topic, researchDate, 'failed', ['All search requests failed; research could not be performed.']), sourceTexts: {} };
  }

  // 3. Fetch the strongest candidates (max RESEARCH_MAX_SOURCES), at most 3 per host.
  const perHost = {};
  const candidates = [...seen.values()].sort((a, b) => b.rank - a.rank).filter((c) => {
    const h = new URL(c.url).hostname;
    perHost[h] = (perHost[h] || 0) + 1;
    return perHost[h] <= 3;
  }).slice(0, cfg.research.maxSourcesFetched);

  const sourceTexts = {};
  const claims = [];
  const entities = new Set();
  const questions = new Set();
  let n = 0;
  for (const c of candidates) {
    let page;
    try {
      const res = await fetchPage(c.url);
      if (!res.ok) { notes.push(`Skipped ${c.url}: HTTP ${res.status}`); continue; }
      page = extractHtml(res.body);
    } catch (err) {
      notes.push(`Skipped ${c.url}: ${err.message}`);
      continue;
    }
    if (page.text.length < 800) { notes.push(`Skipped ${c.url}: too little readable text`); continue; }
    sourceTexts[c.url] = page.text;

    // 4. Extraction: the model may only restate what the page says, with a verbatim quote.
    let extracted;
    try {
      extracted = await llm.json('research.extract', {
        system: 'Extract factual claims relevant to the article topic from the SOURCE TEXT only. Every claim must be supported by a verbatim quote copied exactly from the source text (no paraphrasing inside the quote, no ellipses joining separate passages). Do not add facts that are not in the text. Prefer specific, checkable claims (definitions, statistics with their population and date, official guidance). Return {"claims":[{"claim","quote","confidence"}],"entities":[],"questions":[]}.',
        user: JSON.stringify({ topic: topic.topic, sourceUrl: c.url, sourceTitle: page.title || c.title, sourceText: truncate(page.text, 14000) }),
        schema: EXTRACT_SCHEMA,
        maxTokens: 2500,
      });
    } catch (err) {
      notes.push(`Extraction failed for ${c.url}: ${err.message}`);
      if (err.name === 'BudgetError') break;
      continue;
    }
    let kept = 0;
    for (const cl of extracted.claims) {
      if (!quoteAppearsIn(cl.quote, page.text)) continue; // unverifiable → dropped
      const maxConf = c.sourceType === 'primary' ? 'high' : (c.kind === 'industry research' ? 'high' : 'medium');
      const confidence = CONF_RANK[cl.confidence] <= CONF_RANK[maxConf] ? cl.confidence : maxConf;
      claims.push({
        evidenceId: `E${++n}`,
        claim: cl.claim,
        quote: cl.quote,
        sourceTitle: page.title || c.title || new URL(c.url).hostname,
        sourceUrl: c.url,
        publisher: page.publisher || new URL(c.url).hostname.replace(/^www\./, ''),
        publishedDate: page.published || c.publishedDate || '',
        accessedDate: researchDate,
        sourceType: c.sourceType,
        sourceKind: c.kind,
        confidence,
      });
      kept++;
    }
    const dropped = extracted.claims.length - kept;
    if (dropped) notes.push(`${dropped} claim(s) from ${c.url} dropped: quote not found verbatim in source`);
    (extracted.entities || []).forEach((e) => entities.add(e));
    (extracted.questions || []).forEach((q) => questions.add(q));
  }

  const distinctSources = new Set(claims.map((c) => c.sourceUrl)).size;
  const sufficient = claims.length >= MIN_VERIFIED_CLAIMS && distinctSources >= MIN_DISTINCT_SOURCES;
  if (!sufficient) notes.push(`Insufficient verified evidence: ${claims.length} claims from ${distinctSources} sources (need ${MIN_VERIFIED_CLAIMS} from ${MIN_DISTINCT_SOURCES}).`);

  const report = {
    topic: topic.topic,
    researchDate,
    status: sufficient ? 'completed' : 'insufficient',
    queries,
    claims,
    questions: [...questions].slice(0, 30),
    entities: [...entities].slice(0, 40),
    contentGaps: (plan.hypothesisedGaps || []).map((g) => `Hypothesis (unverified): ${g}`).slice(0, 10),
    notes,
    sourcesConsidered: candidates.length,
  };
  assertValid(report, RESEARCH_REPORT_SCHEMA, 'research report');
  return { report, sourceTexts };
}

function emptyReport(topic, researchDate, status, notes) {
  return { topic: topic.topic, researchDate, status, queries: [], claims: [], questions: [], entities: [], contentGaps: [], notes, sourcesConsidered: 0 };
}
