import { slugify, isValidSlug } from '../lib/text.js';
import { inventoryForPrompt } from './evidence.js';

export const OPTIMIZE_SCHEMA = {
  type: 'object',
  required: ['seoTitle', 'metaDescription', 'slug', 'primaryTopic', 'secondaryTopics', 'headingEdits', 'internalLinks', 'featuredImage'],
  properties: {
    seoTitle: { type: 'string', minLength: 20, maxLength: 65 },
    metaDescription: { type: 'string', minLength: 70, maxLength: 160 },
    slug: { type: 'string', minLength: 3, maxLength: 80 },
    primaryTopic: { type: 'string', minLength: 2, maxLength: 40 },
    secondaryTopics: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 60 } },
    headingEdits: { type: 'array', maxItems: 12, items: { type: 'object', required: ['index', 'text'], properties: { index: { type: 'integer', minimum: 0 }, text: { type: 'string', minLength: 3, maxLength: 140 } } } },
    internalLinks: { type: 'array', maxItems: 10, items: { type: 'object', required: ['index', 'anchorText', 'path'], properties: { index: { type: 'integer', minimum: 0 }, anchorText: { type: 'string', minLength: 3, maxLength: 80 }, path: { type: 'string' } } } },
    featuredImage: {
      type: 'object', required: ['concept', 'prompt', 'alt'],
      properties: { concept: { type: 'string' }, prompt: { type: 'string', maxLength: 1500 }, alt: { type: 'string', minLength: 10, maxLength: 200 } },
    },
  },
};

const MAX_INTERNAL_LINKS = 6;

/** Insert [anchor](path) at the first unlinked, verbatim occurrence of anchor in the text. */
export function insertLink(text, anchor, path) {
  // Split out existing links so we never nest.
  const parts = String(text).split(/(\[[^\]]+\]\([^)]+\))/g);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue;
    const idx = parts[i].indexOf(anchor);
    if (idx >= 0) {
      parts[i] = `${parts[i].slice(0, idx)}[${anchor}](${path})${parts[i].slice(idx + anchor.length)}`;
      return { text: parts.join(''), inserted: true };
    }
  }
  return { text, inserted: false };
}

/** Apply optimizer output deterministically and safely to a draft. */
export function applyOptimization(draft, opt, { inventory, existingSlugs = new Set() }) {
  const content = draft.content.map((b) => ({ ...b }));
  const applied = { headingEdits: 0, internalLinks: [] };

  for (const e of opt.headingEdits) {
    const b = content[e.index];
    if (b && (b.type === 'h2' || b.type === 'h3') && !/[[\]]/.test(e.text)) { b.text = e.text; applied.headingEdits++; }
  }

  const allowed = new Set(inventoryForPrompt(inventory).map((p) => p.path));
  const usedPaths = new Set();
  const usedAnchors = new Set();
  for (const l of opt.internalLinks) {
    if (applied.internalLinks.length >= MAX_INTERNAL_LINKS) break;
    const anchorKey = l.anchorText.toLowerCase();
    if (!allowed.has(l.path) || usedPaths.has(l.path) || usedAnchors.has(anchorKey) || /[[\]()]/.test(l.anchorText)) continue;
    const b = content[l.index];
    if (!b || !['p', 'ul', 'ol'].includes(b.type)) continue;
    if (b.type === 'p') {
      const r = insertLink(b.text, l.anchorText, l.path);
      if (!r.inserted) continue;
      b.text = r.text;
    } else {
      const j = b.items.findIndex((it) => insertLink(it, l.anchorText, l.path).inserted);
      if (j < 0) continue;
      b.items = b.items.map((it, k) => (k === j ? insertLink(it, l.anchorText, l.path).text : it));
    }
    usedPaths.add(l.path);
    usedAnchors.add(anchorKey);
    applied.internalLinks.push({ path: l.path, anchorText: l.anchorText });
  }

  let slug = isValidSlug(opt.slug) ? opt.slug : slugify(opt.slug || draft.title);
  if (!isValidSlug(slug)) slug = slugify(draft.title);
  let candidate = slug;
  let n = 2;
  while (existingSlugs.has(candidate)) candidate = `${slug}-${n++}`;

  return {
    content,
    seoTitle: opt.seoTitle.trim(),
    metaDescription: opt.metaDescription.trim(),
    slug: candidate,
    primaryTopic: opt.primaryTopic.trim(),
    secondaryTopics: opt.secondaryTopics,
    featuredImageBrief: {
      concept: opt.featuredImage.concept,
      prompt: opt.featuredImage.prompt,
      alt: opt.featuredImage.alt,
      filename: `${candidate}.png`,
    },
    applied,
  };
}

export async function runOptimizer({ draft, strategy, inventory, llm, site }) {
  const indexed = draft.content.map((b, index) => ({ index, type: b.type, text: b.text, items: b.items }));
  const opt = await llm.json('optimizer', {
    system: [
      'You are the SEO/AEO/VSO/GEO optimiser. Optimise for user intent first; never keyword-stuff.',
      'seoTitle: unique, descriptive, max ~60 characters, may end with " | ' + site.brandName + '" only if it fits.',
      'metaDescription: 120–155 characters, specific, no hype. slug: short, lowercase, hyphenated, keyword-led, no dates or filler words (e.g. "ai-consulting-explained").',
      'primaryTopic: short category label (e.g. "AI Consulting"). headingEdits: only where a heading becomes clearer or answers a real question better; keep exactly the same hierarchy.',
      'internalLinks: choose anchorText that appears VERBATIM in the referenced block, is descriptive (not "click here"), varied (no repeated exact-match anchors), and link only to paths from the inventory.',
      'featuredImage: a meaningful editorial concept tied to the article (no robot heads, glowing brains or circuit boards), a detailed generation prompt with no text in the image, and concise alt text describing the image.',
    ].join(' '),
    user: JSON.stringify({ title: draft.title, excerpt: draft.excerpt, primaryQuery: strategy.primaryQuery, secondaryQueries: strategy.secondaryQueries, internalLinkOpportunities: strategy.internalLinkOpportunities, blocks: indexed, inventory: inventoryForPrompt(inventory) }),
    schema: OPTIMIZE_SCHEMA,
    maxTokens: 3000,
  });
  return opt;
}
