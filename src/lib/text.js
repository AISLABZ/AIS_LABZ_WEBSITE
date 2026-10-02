export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'how', 'what', 'is', 'are', 'your', 'from', 'by', 'it', 'its', 'without', 'that', 'this', 'their', 'you', 'can', 'do', 'does', 'be', 'vs', 'into', 'at', 'as', 'beyond', 'go', 'they', 'where', 'step']);

/** Clean, short, keyword-led slug: no dates, no stop-word padding, max 6 words. */
export function slugify(input, { maxWords = 6 } = {}) {
  const base = String(input || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(':')[0]
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  const meaningful = base.filter((w) => !STOP.has(w));
  const words = (meaningful.length >= 2 ? meaningful : base).slice(0, maxWords);
  return words.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length >= 3 && slug.length <= 80 && SLUG_RE.test(slug) && !/\b(19|20)\d{2}\b/.test(slug);
}

/** Strip the inline syntax used in content blocks, returning plain text. */
export function plainInline(s) {
  return String(s ?? '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

export function blocksToPlainText(blocks = []) {
  const out = [];
  for (const b of blocks) {
    if (b.text) out.push(plainInline(b.text));
    if (b.title) out.push(plainInline(b.title));
    if (Array.isArray(b.items)) out.push(...b.items.map(plainInline));
    if (Array.isArray(b.header)) out.push(b.header.map(plainInline).join(' '));
    if (Array.isArray(b.rows)) out.push(...b.rows.map((r) => r.map(plainInline).join(' ')));
  }
  return out.join('\n');
}

export function countWords(text) {
  const m = String(text || '').match(/[A-Za-z0-9][A-Za-z0-9'’.-]*/g);
  return m ? m.length : 0;
}

export function readingTimeMinutes(wordCount, wpm = 230) {
  return Math.max(1, Math.round(wordCount / wpm));
}

export function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(s) {
  return normalizeForMatch(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
}

export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Word n-gram shingles for duplication/plagiarism checks. */
export function shingles(text, n = 8) {
  const w = normalizeForMatch(text).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(' '));
  return set;
}

export function overlapRatio(aSet, bSet) {
  if (!aSet.size) return 0;
  let hit = 0;
  for (const s of aSet) if (bSet.has(s)) hit++;
  return hit / aSet.size;
}

export function truncate(s, max) {
  const str = String(s || '');
  return str.length <= max ? str : str.slice(0, max);
}
