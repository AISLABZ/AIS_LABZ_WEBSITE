import fs from 'node:fs';
import path from 'node:path';
import { apiJson } from '../lib/http.js';

/**
 * Generate the featured image if an image provider is configured; otherwise
 * keep the brief for manual production. Never blocks unless REQUIRE_FEATURED_IMAGE=true
 * (enforced by the publication gate, not here).
 */
export async function produceFeaturedImage({ cfg, article, logger, fetchImpl = fetch }) {
  const brief = article.featuredImageBrief;
  if (!brief) return { status: 'no_brief' };
  const { provider, model, apiKey } = cfg.image;
  if (!provider || !model || !apiKey) return { status: 'manual', note: 'No image provider configured; brief stored for manual production.' };
  if (provider !== 'openai') return { status: 'manual', note: `Unsupported IMAGE_PROVIDER "${provider}"` };
  try {
    const res = await apiJson('https://api.openai.com/v1/images/generations', {
      headers: { authorization: `Bearer ${apiKey}` },
      body: { model, prompt: `${brief.prompt}\nEditorial illustration. No text, letters, logos or watermarks in the image.`, size: '1536x1024', n: 1 },
      timeoutMs: 180000,
      fetchImpl,
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) return { status: 'failed', note: 'Image API returned no image data' };
    const filename = path.basename(brief.filename || `${article.slug}.png`).replace(/[^a-z0-9.-]/gi, '-');
    const file = path.join(cfg.dataDir, 'images', filename);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { status: 'generated', filename, publicPath: `/articles/${article.slug}/${filename}` };
  } catch (err) {
    logger?.warn('image generation failed', { err });
    return { status: 'failed', note: err.message };
  }
}
