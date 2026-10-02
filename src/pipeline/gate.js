import { blocksToPlainText, shingles, overlapRatio } from '../lib/text.js';

export const DUPLICATE_THRESHOLD = 0.2;

/** Share of this article's 8-word sequences that appear in any other article. */
export function duplicateScore(article, others) {
  const mine = shingles(blocksToPlainText(article.content), 8);
  let worst = { ratio: 0, id: null };
  for (const o of others) {
    if (o.id === article.id || !o.content) continue;
    const r = overlapRatio(mine, shingles(blocksToPlainText(o.content), 8));
    if (r > worst.ratio) worst = { ratio: r, id: o.id };
  }
  return worst;
}

/**
 * Publication gate. Pure function over the stage reports. Any failed check
 * → REJECTED. REJECTED content can never be published automatically.
 */
export function publicationGate({ article, research, strategy, factCheck, deterministic, links, seo, duplicate, requireFeaturedImage }) {
  const reasons = [];
  const checks = {};
  const check = (name, ok, reason) => { checks[name] = ok; if (!ok) reasons.push(reason); };

  check('researchCompleted', research?.status === 'completed', `Research not completed (${research?.status || 'missing'})`);
  check('noSeriousCannibalization', strategy?.cannibalization?.risk !== 'serious', `Serious cannibalization: ${strategy?.cannibalization?.explanation || ''}`);
  const blocking = [...(deterministic?.issues || []), ...(factCheck?.issues || [])].filter((i) => i.severity === 'critical' || i.severity === 'major');
  check('claimsSupported', factCheck?.verdict === 'pass' && blocking.length === 0, `Fact-check failed: ${blocking.slice(0, 5).map((i) => `${i.type}: ${i.problem} (“${String(i.excerpt).slice(0, 80)}”)`).join('; ') || factCheck?.summary || 'no fact-check report'}`);
  check('noInventedCitations', !(deterministic?.issues || []).some((i) => i.type === 'hallucinated_source'), 'Citations not backed by verified research');
  check('noPlagiarism', !(deterministic?.issues || []).some((i) => /plagiarism/i.test(i.problem)), 'Verbatim overlap with sources');
  check('noPlaceholders', !(deterministic?.issues || []).some((i) => /placeholder/i.test(i.problem)), 'Placeholder or raw HTML in content');
  check('noUnsupportedAislabzClaims', !(deterministic?.issues || []).some((i) => i.type === 'aislabz_claim') && !(factCheck?.issues || []).some((i) => i.type === 'aislabz_claim' && i.severity !== 'minor'), 'Unsupported AISLabz claims');
  check('noDuplication', (duplicate?.ratio ?? 0) < DUPLICATE_THRESHOLD, `Substantial duplication with ${duplicate?.id}`);
  check('linksValid', links?.ok === true, `Broken links: ${(links?.failures || []).slice(0, 5).map((f) => `${f.href} (${f.reason || f.status})`).join(', ')}`);
  check('technicalSeo', seo?.ok === true, `Technical SEO: ${(seo?.errors || []).join('; ')}`);
  check('metadataPresent', Boolean(article?.seoTitle && article?.metaDescription && article?.slug), 'SEO title / meta description / slug missing');
  check('featuredImage', !requireFeaturedImage || Boolean(article?.featuredImage), 'Featured image required but missing');

  return { decision: reasons.length ? 'REJECTED' : 'APPROVED', reasons, checks, evaluatedAt: new Date().toISOString() };
}
