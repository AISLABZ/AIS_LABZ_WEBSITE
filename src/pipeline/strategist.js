import { SEARCH_INTENTS } from '../store/store.js';
import { evidenceForPrompt, inventoryForPrompt, verifiedCapabilities } from './evidence.js';

export const STRATEGY_SCHEMA = {
  type: 'object',
  required: ['searchIntent', 'primaryQuery', 'secondaryQueries', 'longTailQuestions', 'semanticEntities', 'angle', 'outline', 'internalLinkOpportunities', 'relevantServices', 'recommendedCitations', 'cannibalization', 'aeoOpportunities', 'vsoQuestions', 'geoConsiderations'],
  properties: {
    searchIntent: { type: 'string', enum: SEARCH_INTENTS },
    primaryQuery: { type: 'string', minLength: 3 },
    secondaryQueries: { type: 'array', items: { type: 'string' }, maxItems: 15 },
    longTailQuestions: { type: 'array', items: { type: 'string' }, maxItems: 15 },
    semanticEntities: { type: 'array', items: { type: 'string' }, maxItems: 40 },
    angle: { type: 'string', minLength: 20 },
    outline: {
      type: 'array', minItems: 4, maxItems: 16,
      items: {
        type: 'object', required: ['heading', 'level', 'purpose'],
        properties: { heading: { type: 'string' }, level: { type: 'integer', enum: [2, 3] }, purpose: { type: 'string' }, evidenceIds: { type: 'array', items: { type: 'string' } }, answerFirst: { type: 'boolean' } },
      },
    },
    internalLinkOpportunities: { type: 'array', items: { type: 'object', required: ['path', 'reason'], properties: { path: { type: 'string' }, anchorIdea: { type: 'string' }, reason: { type: 'string' } } } },
    relevantServices: { type: 'array', items: { type: 'string' } },
    recommendedCitations: { type: 'array', items: { type: 'string', pattern: '^E\\d+$' } },
    cannibalization: {
      type: 'object', required: ['risk', 'explanation'],
      properties: { risk: { type: 'string', enum: ['none', 'low', 'serious'] }, conflictingPaths: { type: 'array', items: { type: 'string' } }, explanation: { type: 'string' } },
    },
    aeoOpportunities: { type: 'array', items: { type: 'string' } },
    vsoQuestions: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    geoConsiderations: { type: 'array', items: { type: 'string' } },
    contentGaps: { type: 'array', items: { type: 'string' } },
  },
};

export async function runStrategist({ topic, research, inventory, gscOpportunities = [], llm, site }) {
  const allowedPaths = new Set(inventoryForPrompt(inventory).map((p) => p.path));
  const strategy = await llm.json('strategist', {
    system: [
      'You are the content strategist for AISLabz, an applied-AI organisation. Plan ONE article that best satisfies the search intent of the topic for business decision-makers.',
      'Use only the supplied verified evidence for factual planning. Internal links may only use paths from the supplied site inventory.',
      'Relevant services may only be chosen from the supplied verified services list (it may be empty).',
      'Assess cannibalization honestly: if an existing page already serves substantially the same intent, set risk "serious".',
      'AEO: plan definition-first and question-led sections whose first sentence answers directly. VSO: at most 8 natural spoken-style questions, only where they fit. GEO: clear entities, explicit definitions, consistent terminology, an original framework only if it is genuinely useful.',
      'Never plan invented statistics, case studies, client results or quotes.',
    ].join(' '),
    user: JSON.stringify({
      topic,
      evidence: evidenceForPrompt(research),
      researchQuestions: research.questions,
      researchEntities: research.entities,
      siteInventory: inventoryForPrompt(inventory),
      verifiedServices: verifiedCapabilities(site),
      searchConsoleOpportunities: gscOpportunities.slice(0, 30),
    }),
    schema: STRATEGY_SCHEMA,
    maxTokens: 4000,
  });
  // Deterministic post-validation: drop links/citations that are not real.
  const evidenceIds = new Set(research.claims.map((c) => c.evidenceId));
  strategy.internalLinkOpportunities = strategy.internalLinkOpportunities.filter((l) => allowedPaths.has(l.path));
  strategy.recommendedCitations = strategy.recommendedCitations.filter((id) => evidenceIds.has(id));
  const serviceUrls = new Set((site.services || []).map((s) => s.url));
  strategy.relevantServices = strategy.relevantServices.filter((u) => serviceUrls.has(u));
  return strategy;
}
