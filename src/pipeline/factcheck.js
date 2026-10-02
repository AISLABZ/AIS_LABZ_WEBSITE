import { extractLinks, isInternalHref } from '../render/blocks.js';
import { plainInline, blocksToPlainText, shingles, overlapRatio } from '../lib/text.js';
import { evidenceForPrompt, verifiedCapabilities } from './evidence.js';

export const FACTCHECK_SCHEMA = {
  type: 'object',
  required: ['issues', 'verdict', 'summary'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    summary: { type: 'string' },
    issues: {
      type: 'array', maxItems: 60,
      items: {
        type: 'object', required: ['index', 'excerpt', 'problem', 'severity', 'type'],
        properties: {
          index: { type: 'integer', minimum: -1 },
          excerpt: { type: 'string', maxLength: 600 },
          problem: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          type: { type: 'string', enum: ['unsupported_claim', 'misattributed', 'invented_statistic', 'outdated', 'aislabz_claim', 'hallucinated_source', 'other'] },
        },
      },
    },
  },
};

const NUMERIC_CLAIM = /(\d+(?:\.\d+)?\s?(?:%|percent|per cent)|\$\s?\d|£\s?\d|€\s?\d|\b\d+(?:\.\d+)?\s?(?:million|billion|trillion|x)\b|\b\d{1,3}(?:,\d{3})+\b)/i;
const ATTRIBUTION = /\b(studies show|research shows|research suggests|according to|a survey|surveys? found|reports? (?:found|show)|data shows|experts say)\b/i;
const PLACEHOLDER = /(lorem ipsum|\bTODO\b|\bTBD\b|\[insert|\{\{|\}\}|xx%|\[citation needed\]|example\.com|<\/?[a-z][^>]*>)/i;
const BANNED = /(ai is revolutioni[sz]ing|rapidly evolving (?:digital )?landscape|in today'?s fast[- ]paced|game[- ]changer|unlock the power|\bdelve\b)/i;

function blockStrings(b) {
  return [b.text, b.title, ...(b.items || []), ...((b.rows || []).flat()), ...(b.header || [])].filter(Boolean);
}

/** Deterministic checks that do not depend on a model. */
export function deterministicFactCheck(article, research, { site, sourceTexts = {} }) {
  const issues = [];
  const evidenceUrls = new Set(research.claims.map((c) => c.sourceUrl));
  const evidenceIds = new Set(research.claims.map((c) => c.evidenceId));

  article.content.forEach((b, index) => {
    const strings = blockStrings(b);
    const links = extractLinks([b]);
    const externalLinks = links.filter((l) => !isInternalHref(l.href, site.siteUrl));
    for (const l of externalLinks) {
      if (!evidenceUrls.has(l.href)) issues.push({ index, excerpt: l.href, problem: 'External link is not a verified research source', severity: 'critical', type: 'hallucinated_source' });
    }
    for (const id of b.evidence || []) {
      if (!evidenceIds.has(id)) issues.push({ index, excerpt: id, problem: 'Unknown evidence id', severity: 'critical', type: 'hallucinated_source' });
    }
    const cited = externalLinks.length > 0 || (b.evidence || []).length > 0;
    for (const s of strings) {
      const plain = plainInline(s);
      const sentences = plain.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (/hypothetical|imagine|for illustration/i.test(sentence)) continue;
        if (NUMERIC_CLAIM.test(sentence) && !cited) issues.push({ index, excerpt: sentence.slice(0, 300), problem: 'Numeric claim without a citation', severity: 'major', type: 'invented_statistic' });
        if (ATTRIBUTION.test(sentence) && !cited) issues.push({ index, excerpt: sentence.slice(0, 300), problem: 'Attributed claim without a citation', severity: 'major', type: 'unsupported_claim' });
      }
      if (PLACEHOLDER.test(s)) issues.push({ index, excerpt: s.slice(0, 200), problem: 'Placeholder or raw HTML content', severity: 'critical', type: 'other' });
      if (BANNED.test(s)) issues.push({ index, excerpt: s.slice(0, 200), problem: 'Banned generic phrasing', severity: 'minor', type: 'other' });
    }
    if (/aislabz/i.test(strings.join(' '))) issues.push({ index, excerpt: strings.join(' ').slice(0, 200), problem: 'AISLabz mentioned in body (only allowed in CTA)', severity: 'major', type: 'aislabz_claim' });
  });

  if (article.cta && !(site.services || []).length && !article.cta.neutral) {
    issues.push({ index: -1, excerpt: article.cta.text, problem: 'CTA makes capability claims but no services are verified in config/site.json', severity: 'critical', type: 'aislabz_claim' });
  }

  // Plagiarism / verbatim copying against fetched sources.
  const articleShingles = shingles(blocksToPlainText(article.content), 8);
  const sourceShingles = new Set();
  for (const t of Object.values(sourceTexts)) for (const s of shingles(t, 8)) sourceShingles.add(s);
  const copied = overlapRatio(articleShingles, sourceShingles);
  if (copied > 0.05) issues.push({ index: -1, excerpt: `${(copied * 100).toFixed(1)}% of 8-word sequences match source text`, problem: 'Possible plagiarism: too much verbatim overlap with sources', severity: 'critical', type: 'other' });

  return { issues, copiedRatio: copied };
}

/** Model-assisted fact check against the evidence, plus AISLabz claim check. */
export async function runFactCheck({ article, research, llm, site }) {
  const indexed = article.content.map((b, index) => ({ index, ...b }));
  return llm.json('factcheck', {
    system: [
      'You are a strict fact-checker. Compare every factual statement in the article to the supplied evidence (claims + verbatim quotes).',
      'Flag: claims not supported by evidence (unsupported_claim), claims attributed to the wrong source or overstated beyond the quote (misattributed), numbers not present in evidence (invented_statistic), statements likely outdated given evidence dates (outdated), and any statement about AISLabz capabilities not in verifiedServices (aislabz_claim).',
      'General reasoning, clearly-labelled opinion and clearly-labelled hypothetical examples are acceptable without citations.',
      'Severity: critical = fabricated or false; major = unsupported or overstated factual claim; minor = wording/precision.',
      'verdict is "fail" if any critical or major issue exists.',
    ].join(' '),
    user: JSON.stringify({ title: article.title, cta: article.cta || null, blocks: indexed, evidence: evidenceForPrompt(research), verifiedServices: verifiedCapabilities(site) }),
    schema: FACTCHECK_SCHEMA,
    maxTokens: 4000,
  });
}
