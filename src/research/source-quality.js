// Heuristic source-authority scoring used to prioritise which search results are fetched.
// It does not replace judgement: the fact-check stage and human review still apply.

const STANDARDS_AND_INTERGOV = ['nist.gov', 'iso.org', 'oecd.org', 'oecd.ai', 'europa.eu', 'w3.org', 'ietf.org', 'ieee.org', 'un.org', 'worldbank.org', 'imf.org', 'weforum.org', 'gov.uk', 'ico.org.uk'];
const ACADEMIC = ['arxiv.org', 'nature.com', 'science.org', 'acm.org', 'springer.com', 'sciencedirect.com', 'nber.org', 'ssrn.com', 'mit.edu', 'stanford.edu', 'harvard.edu', 'ox.ac.uk', 'cam.ac.uk', 'hbr.org', 'sloanreview.mit.edu'];
const PRIMARY_VENDOR_DOCS = ['developers.google.com', 'support.google.com', 'blog.google', 'openai.com', 'platform.openai.com', 'help.openai.com', 'anthropic.com', 'docs.anthropic.com', 'learn.microsoft.com', 'microsoft.com', 'aws.amazon.com', 'cloud.google.com', 'ai.google.dev', 'schema.org', 'bing.com', 'blogs.bing.com', 'perplexity.ai'];
const INDUSTRY_RESEARCH = ['mckinsey.com', 'bcg.com', 'deloitte.com', 'pwc.com', 'gartner.com', 'forrester.com', 'accenture.com', 'ibm.com', 'kpmg.com', 'ey.com', 'pewresearch.org', 'stateof.ai', 'hai.stanford.edu', 'epoch.ai'];
const LOW_QUALITY = ['pinterest.', 'quora.com', 'reddit.com', 'medium.com', 'linkedin.com/pulse', 'facebook.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com'];

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function classifySource(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return { score: -100, kind: 'invalid', sourceType: 'secondary' }; }
  const host = u.hostname.replace(/^www\./, '');
  const full = host + u.pathname;
  if (u.protocol !== 'https:') return { score: -50, kind: 'insecure', sourceType: 'secondary' };
  if (LOW_QUALITY.some((d) => full.includes(d))) return { score: -20, kind: 'user-generated', sourceType: 'secondary' };
  if (/\.gov$|\.gov\.[a-z]{2}$|\.gouv\.|\.go\.[a-z]{2}$/.test(host) || STANDARDS_AND_INTERGOV.some((d) => hostMatches(host, d))) return { score: 100, kind: 'government/standards', sourceType: 'primary' };
  if (/\.edu$|\.ac\.[a-z]{2}$/.test(host) || ACADEMIC.some((d) => hostMatches(host, d))) return { score: 90, kind: 'academic', sourceType: 'primary' };
  if (PRIMARY_VENDOR_DOCS.some((d) => hostMatches(host, d))) return { score: 85, kind: 'primary documentation', sourceType: 'primary' };
  if (INDUSTRY_RESEARCH.some((d) => hostMatches(host, d))) return { score: 70, kind: 'industry research', sourceType: 'secondary' };
  return { score: 30, kind: 'other', sourceType: 'secondary' };
}
