import { CONTENT_SCHEMA } from '../render/blocks.js';
import { evidenceForPrompt, verifiedCapabilities } from './evidence.js';

export const DRAFT_SCHEMA = {
  type: 'object',
  required: ['title', 'excerpt', 'content'],
  properties: {
    title: { type: 'string', minLength: 20, maxLength: 140 },
    excerpt: { type: 'string', minLength: 80, maxLength: 320 },
    content: CONTENT_SCHEMA,
    cta: {
      type: 'object', required: ['heading', 'text'],
      properties: { heading: { type: 'string', maxLength: 90 }, text: { type: 'string', maxLength: 600 } },
    },
  },
};

export const STYLE_RULES = [
  'Write an original, expert-level article for business leaders. Professional, specific, human, evidence-based, helpful.',
  'Typical length 1,800–3,000 words, but never add filler to reach a length. Stop when the reader is fully served.',
  'Output structured content blocks only: h2, h3, p, ul, ol, table, callout. NEVER output an h1 (the title is the H1) and never output HTML or markdown headings.',
  'Inline syntax allowed inside text: **bold**, *italic*, [anchor text](url). Nothing else.',
  'Every factual claim, statistic, definition from an authority, or dated fact must come from the supplied evidence. Cite it inline as [descriptive anchor](sourceUrl) using the exact sourceUrl, and list the evidence ids on the block in "evidence".',
  'Never invent statistics, studies, quotes, URLs, dates, company capabilities, client results, case studies, authors or credentials. If evidence is missing for a point, either omit it or present it explicitly as reasoning/opinion without numbers.',
  'Hypothetical examples are allowed only when explicitly labelled "hypothetical" or "for example, imagine".',
  'AEO: question-led H2s where natural; the first sentence after such a heading must answer it directly in a way that makes sense out of context. Open definitional sections with a concise standalone definition.',
  'VSO: include natural-language questions only where a reader would really ask them; answer in one or two spoken-friendly sentences before elaborating.',
  'GEO: explicit definitions, clear entities, consistent terminology, descriptive headings, logical relationships between concepts.',
  'Banned: "AI is revolutionizing", "rapidly evolving digital landscape", "in today\'s fast-paced world", "game-changer", "unlock the power", "delve", fake urgency, keyword stuffing, repetitive intros/conclusions, unsupported predictions, excessive sales language.',
  'Do not mention AISLabz in the body. AISLabz appears only in the CTA, and only with capabilities from the verified services list; if that list is empty, omit the cta field.',
].join('\n');

export async function runWriter({ topic, strategy, research, llm, site, revisionNotes }) {
  const services = verifiedCapabilities(site).filter((s) => strategy.relevantServices.includes(s.url));
  const draft = await llm.json('writer', {
    system: STYLE_RULES,
    user: JSON.stringify({
      task: revisionNotes ? 'Revise the article to resolve every QA issue listed in revisionNotes.' : 'Write the article.',
      topic: topic.topic,
      strategy,
      evidence: evidenceForPrompt(research),
      verifiedServices: services,
      revisionNotes: revisionNotes || undefined,
      outputShape: '{"title","excerpt","content":[{"type","text"|"items"|"header"+"rows"|"title"+"text","evidence":["E1"]}],"cta":{"heading","text"}}',
    }),
    schema: DRAFT_SCHEMA,
  });
  if (!services.length) delete draft.cta;
  return draft;
}

/** CTA used when no verified services exist: truthful, contextual, no capability claims. */
export function neutralCta(topic, site) {
  const subject = topic.topic.split(':')[0].trim();
  return {
    heading: `Questions about ${subject.toLowerCase().startsWith('how') ? 'this topic' : subject}?`,
    text: `If you are weighing how this applies to your organisation, you can contact the ${site.organizationName} team to talk it through.`,
    href: site.contactUrl,
    buttonLabel: site.contactLabel,
    neutral: true,
  };
}
