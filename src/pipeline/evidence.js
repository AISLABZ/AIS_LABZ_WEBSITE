/** Compact evidence list handed to model stages (only verified research claims). */
export function evidenceForPrompt(research) {
  return research.claims.map((c) => ({
    id: c.evidenceId,
    claim: c.claim,
    quote: c.quote,
    sourceTitle: c.sourceTitle,
    sourceUrl: c.sourceUrl,
    publisher: c.publisher,
    publishedDate: c.publishedDate || 'unknown',
    sourceType: c.sourceType,
    confidence: c.confidence,
  }));
}

/** Inventory summary for prompts: internal URLs the model may link to. */
export function inventoryForPrompt(inventory, { limit = 120 } = {}) {
  return inventory.pages
    .filter((p) => p.title && !p.fetchError && (!p.status || p.status === 200))
    .slice(0, limit)
    .map((p) => ({ path: p.path === '/' ? '/' : `${p.path}${p.type === 'article' ? '/' : ''}`, title: p.title, type: p.type }));
}

/**
 * The topic's keyword cluster (config/site.json topicClusters): the service page
 * that owns the commercial intent and the existing pages that already own
 * neighbouring queries. Null when the topic has no cluster.
 */
export function clusterForPrompt(site, topic) {
  const c = (site.topicClusters || []).find((x) => x.id === topic?.clusterId);
  if (!c) return null;
  return { id: c.id, name: c.name, description: c.description, serviceUrl: c.serviceUrl || null, existingPagesInCluster: c.relatedReading || [] };
}

/** Verified AISLabz capabilities (from config/site.json only). */
export function verifiedCapabilities(site) {
  return (site.services || []).map((s) => ({ name: s.name, url: s.url, capabilities: s.capabilities || [], topics: s.topics || [] }));
}

export function evidenceUrlSet(research) {
  return new Set(research.claims.map((c) => c.sourceUrl));
}
