import { escapeHtml, slugify } from '../lib/text.js';

/** Schema for article content: structured blocks, never raw HTML. */
export const BLOCK_SCHEMA = {
  type: 'object',
  required: ['type'],
  properties: {
    type: { type: 'string', enum: ['h2', 'h3', 'p', 'ul', 'ol', 'table', 'callout'] },
    text: { type: 'string', maxLength: 4000 },
    title: { type: 'string', maxLength: 200 },
    items: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 1500 } },
    header: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 300 } },
    rows: { type: 'array', maxItems: 30, items: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 600 } } },
    caption: { type: 'string', maxLength: 300 },
    evidence: { type: 'array', items: { type: 'string', pattern: '^E\\d+$' } },
  },
};

export const CONTENT_SCHEMA = { type: 'array', minItems: 3, maxItems: 400, items: BLOCK_SCHEMA };

/** Is the href allowed? https absolute URLs or site-relative paths only. */
export function safeHref(href) {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  if (/^\/(?!\/)[A-Za-z0-9\-._~/?#=&%+]*$/.test(h)) return h;
  try {
    const u = new URL(h);
    if (u.protocol === 'https:' && !u.username && !u.password) return u.toString();
  } catch { /* fallthrough */ }
  return null;
}

export function isInternalHref(href, siteUrl) {
  if (href.startsWith('/')) return true;
  try { return new URL(href).host === new URL(siteUrl).host; } catch { return false; }
}

function renderEmphasis(escaped) {
  return escaped
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
}

/**
 * Render the restricted inline syntax: **bold**, *italic*, [text](href).
 * Everything else is HTML-escaped. Unsafe hrefs are rendered as plain text.
 */
export function renderInline(text, { siteUrl }) {
  const src = String(text ?? '');
  const re = /\[([^\]]{1,300})\]\(([^)\s]{1,2000})\)/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    out += renderEmphasis(escapeHtml(src.slice(last, m.index)));
    const href = safeHref(m[2]);
    const label = renderEmphasis(escapeHtml(m[1]));
    if (!href) {
      out += label;
    } else if (isInternalHref(href, siteUrl)) {
      out += `<a href="${escapeHtml(href)}">${label}</a>`;
    } else {
      out += `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${label}</a>`;
    }
    last = m.index + m[0].length;
  }
  out += renderEmphasis(escapeHtml(src.slice(last)));
  return out;
}

export function extractLinks(blocks) {
  const links = [];
  const re = /\[([^\]]{1,300})\]\(([^)\s]{1,2000})\)/g;
  const scan = (s) => { let m; while ((m = re.exec(String(s ?? '')))) links.push({ text: m[1], href: m[2] }); };
  for (const b of blocks || []) {
    scan(b.text); scan(b.title);
    (b.items || []).forEach(scan);
    (b.rows || []).forEach((r) => r.forEach(scan));
  }
  return links;
}

/** Add stable unique ids to headings (used for anchors and the table of contents). */
export function headingIds(blocks) {
  const used = new Set();
  return blocks.map((b) => {
    if (b.type !== 'h2' && b.type !== 'h3') return null;
    let id = slugify(b.text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), { maxWords: 8 }) || 'section';
    let n = 2;
    const base = id;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return id;
  });
}

export function renderBlocks(blocks, { siteUrl }) {
  const ids = headingIds(blocks);
  const inl = (s) => renderInline(s, { siteUrl });
  return blocks.map((b, i) => {
    switch (b.type) {
      case 'h2': return `<h2 id="${ids[i]}">${inl(b.text)}</h2>`;
      case 'h3': return `<h3 id="${ids[i]}">${inl(b.text)}</h3>`;
      case 'p': return `<p>${inl(b.text)}</p>`;
      case 'ul':
      case 'ol': return `<${b.type}>${(b.items || []).map((it) => `<li>${inl(it)}</li>`).join('')}</${b.type}>`;
      case 'callout': return `<aside class="ae-callout">${b.title ? `<p class="ae-callout__title">${inl(b.title)}</p>` : ''}<p>${inl(b.text)}</p></aside>`;
      case 'table': {
        const head = (b.header || []).map((h) => `<th scope="col">${inl(h)}</th>`).join('');
        const rows = (b.rows || []).map((r) => `<tr>${r.map((c) => `<td>${inl(c)}</td>`).join('')}</tr>`).join('');
        return `<div class="ae-table-wrap" role="region" aria-label="${escapeHtml(b.caption || 'Table')}" tabindex="0"><table>${b.caption ? `<caption>${inl(b.caption)}</caption>` : ''}${head ? `<thead><tr>${head}</tr></thead>` : ''}<tbody>${rows}</tbody></table></div>`;
      }
      default: return '';
    }
  }).join('\n');
}
