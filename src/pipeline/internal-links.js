import { liveArticles } from '../render/build.js';
import { insertLink } from './optimizer.js';
import { normalizeForMatch } from '../lib/text.js';

function anchorCandidates(article) {
  const list = [article.generationMetadata?.primaryQuery, article.primaryTopic, ...(article.secondaryTopics || [])]
    .filter((x) => x && x.length >= 6);
  return [...new Set(list.map((x) => x.trim()))];
}

/**
 * After publishing `target`, find older live articles that mention its core
 * phrases without already linking to it. Returns proposals; applies them only
 * when AUTO_UPDATE_INTERNAL_LINKS=true.
 */
export function proposeBacklinks(cfg, store, targetId, { apply = cfg.autoUpdateInternalLinks } = {}) {
  const target = store.getArticle(targetId);
  if (!target) return { proposals: [], applied: 0 };
  const path = `/articles/${target.slug}/`;
  const phrases = anchorCandidates(target);
  const proposals = [];
  for (const a of liveArticles(store)) {
    if (a.id === target.id) continue;
    if (JSON.stringify(a.content).includes(path)) continue;
    let found = null;
    a.content.forEach((b, index) => {
      if (found || b.type !== 'p') return;
      const text = normalizeForMatch(b.text);
      for (const ph of phrases) {
        const i = text.indexOf(normalizeForMatch(ph));
        if (i >= 0) {
          // Recover the original-cased anchor from the block text.
          const original = b.text.substr(b.text.toLowerCase().indexOf(ph.toLowerCase()), ph.length);
          if (original && original.toLowerCase() === ph.toLowerCase()) { found = { articleId: a.id, articleSlug: a.slug, blockIndex: index, anchorText: original, path }; return; }
        }
      }
    });
    if (found) proposals.push(found);
  }
  let applied = 0;
  if (apply) {
    for (const p of proposals) {
      const a = store.getArticle(p.articleId);
      const b = a.content[p.blockIndex];
      const r = insertLink(b.text, p.anchorText, p.path);
      if (!r.inserted) continue;
      const content = a.content.map((x, i) => (i === p.blockIndex ? { ...x, text: r.text } : x));
      // Adding a link is not a substantive editorial update: updatedAt is unchanged.
      store.saveArticle({ ...a, content, internalLinks: [...(a.internalLinks || []), { path: p.path, anchorText: p.anchorText, addedAutomatically: true }] });
      applied++;
    }
  }
  return { proposals, applied };
}
