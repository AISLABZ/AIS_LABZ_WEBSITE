import { tokens, jaccard } from '../lib/text.js';

export const CANNIBALIZATION_THRESHOLD = 0.5;

function topicTerms(t) {
  return tokens(`${t.primaryQuery} ${t.topic.split(':')[0]}`);
}

/**
 * Deterministic intent-overlap check between a topic and existing content.
 * Returns the strongest overlap (score 0..1).
 */
export function findOverlap(topic, inventoryPages) {
  const terms = topicTerms(topic);
  let best = { score: 0, page: null };
  for (const p of inventoryPages) {
    if (!p.title && !p.primaryQuery) continue;
    const pageTerms = tokens(`${p.primaryQuery || ''} ${String(p.title || '').split(/[|:–—-]/)[0]}`);
    const score = jaccard(terms, pageTerms);
    if (score > best.score) best = { score, page: p };
  }
  return best;
}

/**
 * Choose the next topic: highest priority queued topic whose intent is not
 * already covered by an existing article. Covered topics are flagged
 * `covered_by_existing` (update the existing article instead).
 * Returns { topic, skipped: [{topicId, reason}] }.
 */
export function selectTopic(topics, inventoryPages, { overrideTopicId } = {}) {
  const skipped = [];
  const articles = inventoryPages.filter((p) => p.type === 'article');
  const pool = overrideTopicId
    ? topics.filter((t) => t.id === overrideTopicId)
    : topics.filter((t) => t.status === 'queued').sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  for (const t of pool) {
    const overlap = findOverlap(t, articles);
    if (overlap.score >= CANNIBALIZATION_THRESHOLD) {
      skipped.push({ topicId: t.id, reason: `covered_by_existing: overlaps ${overlap.page.url} (similarity ${overlap.score.toFixed(2)})`, url: overlap.page.url });
      continue;
    }
    return { topic: t, skipped };
  }
  return { topic: null, skipped };
}
