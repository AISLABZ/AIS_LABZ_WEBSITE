// 002 — keyword clusters (see docs/keyword-clusters.md).
// * Tags every topic with a clusterId matching config/site.json topicClusters.
// * Retargets queued topics that would compete with a live service page or /blog/ post.
// * Re-sequences the queue pillar-first, rotating across clusters.
// * Adds gap topics: AI clusters as `queued`, SEO clusters as `suggested` (promote by hand).
// Only topics still `queued` are edited; anything the engine has touched is left alone.
// Manual reversal: git revert the data/topics.json change, set data/schema-version.json version to 1.

const now = () => new Date().toISOString();

const PATCHES = {
  top_001: {
    clusterId: 'AI-1', priority: 1, relatedService: '/services/ai-consulting/',
    primaryQuery: 'what is ai consulting',
    secondaryQueries: ['ai consulting explained', 'ai pilot to production', 'measuring ai roi', 'what does an ai consultant do'],
    notes: 'Cluster AI-1 pillar (informational). /services/ai-consulting/ owns the commercial query "ai consulting services": never target it here, link to it instead. Distinct from top_010 (strategy framework) and top_006 (readiness).',
  },
  top_002: {
    clusterId: 'AI-2', priority: 2, relatedService: '/services/applied-ai-automation/',
    notes: 'Cluster AI-2 pillar; angle is oversight and control. top_008 is the narrower "what to automate" framework — link, do not duplicate. /blog/how-ai-helps-small-businesses-save-time/ owns small-business time/cost savings: do not target "small business" queries, link to it.',
  },
  top_005: {
    clusterId: 'AI-3', priority: 3, relatedService: '/services/organic-growth-seo/',
    secondaryQueries: ['what is generative engine optimization', 'geo vs seo', 'aeo vs seo', 'llm seo'],
    notes: 'Cluster AI-3 pillar: definitions and comparison. /blog/answer-engine-optimization-guide/ owns "what is answer engine optimization" and AEO tactics — summarise in one paragraph and link to it.',
  },
  top_003: { clusterId: 'AI-2', priority: 4, relatedService: '/services/applied-ai-automation/' },
  top_007: { clusterId: 'AI-4', priority: 5, relatedService: '/services/applied-ai-automation/', notes: 'Cluster AI-4 pillar. Use-case catalogue; every use case must be evidence-backed or explicitly hypothetical.' },
  top_010: { clusterId: 'AI-1', priority: 6, relatedService: '/services/ai-consulting/' },
  top_009: {
    clusterId: 'AI-3', priority: 7, relatedService: '/services/organic-growth-seo/',
    notes: 'Technical implementation angle; link to top_005 and to /blog/technical-seo-explained/ (which owns general technical SEO). Keep to what is specific to AI crawlers and generative search.',
  },
  top_008: { clusterId: 'AI-2', priority: 8, relatedService: '/services/applied-ai-automation/' },
  top_006: {
    clusterId: 'AI-1', priority: 10, relatedService: '/services/ai-consulting/',
    primaryQuery: 'ai readiness checklist',
    secondaryQueries: ['is my business ready for ai', 'ai readiness assessment questions', 'data readiness for ai'],
    notes: 'Checklist intent. /services/ai-consulting/ offers the readiness assessment itself, so this article owns the self-serve checklist and links to the service for the assessment.',
  },
  top_004: {
    clusterId: 'AI-3', status: 'covered_by_existing', relatedService: '/services/organic-growth-seo/',
    notes: 'Retired before drafting: /blog/answer-engine-optimization-guide/ already serves "get your brand cited by AI assistants". Refresh that post instead (docs/keyword-clusters.md, refresh queue). AI Overviews and llms.txt angles moved to top_013 and top_014.',
  },
};

const NEW_TOPICS = [
  {
    id: 'top_011', clusterId: 'AI-3', priority: 9, status: 'queued', searchIntent: 'informational', relatedService: '/services/organic-growth-seo/',
    topic: 'Google AI Overviews: How Websites Get Cited and What You Can Influence',
    primaryQuery: 'how to appear in google ai overviews',
    secondaryQueries: ['ai overviews seo', 'google ai overviews citations', 'ai overviews traffic impact'],
    notes: 'Google-specific; the assistant-citation angle belongs to /blog/answer-engine-optimization-guide/. Only claims backed by Google documentation or measured studies.',
  },
  {
    id: 'top_012', clusterId: 'AI-1', priority: 11, status: 'queued', searchIntent: 'commercial', relatedService: '/services/ai-consulting/',
    topic: 'How to Choose an AI Consultant: Questions to Ask Before You Hire',
    primaryQuery: 'how to choose an ai consultant',
    secondaryQueries: ['hiring an ai consultant', 'ai consultant vs in-house team', 'questions to ask an ai consultant'],
    notes: 'Commercial investigation; mirrors the format of /blog/how-a-link-building-agency-improves-rankings/. No pricing figures unless confirmed in docs/keyword-clusters.md.',
  },
  {
    id: 'top_013', clusterId: 'AI-2', priority: 12, status: 'queued', searchIntent: 'informational', relatedService: '/services/applied-ai-automation/',
    topic: 'AI Lead Scoring: How It Works and When It Beats Rules-Based Scoring',
    primaryQuery: 'ai lead scoring',
    secondaryQueries: ['predictive lead scoring', 'machine learning lead scoring', 'lead scoring model'],
    notes: 'Lead scoring models are a listed capability of /services/applied-ai-automation/.',
  },
  {
    id: 'top_014', clusterId: 'AI-3', priority: 13, status: 'queued', searchIntent: 'informational', relatedService: '/services/organic-growth-seo/',
    topic: 'What Is llms.txt and Does Your Website Need One?',
    primaryQuery: 'llms.txt',
    secondaryQueries: ['what is llms.txt', 'llms.txt vs robots.txt', 'how to create llms.txt'],
    notes: 'Supporting article to top_009. State plainly which AI providers document support and which do not; no speculation presented as fact.',
  },
  {
    id: 'top_015', clusterId: 'AI-4', priority: 14, status: 'queued', searchIntent: 'informational', relatedService: '/services/applied-ai-automation/',
    topic: 'Generative AI for Marketing Teams: Workflows That Save Time Without Diluting Quality',
    primaryQuery: 'generative ai for marketing',
    secondaryQueries: ['generative ai marketing use cases', 'ai content workflow', 'ai for marketing teams'],
    notes: 'Marketing-team slice of top_007; link up to it. Do not repeat the general use-case catalogue.',
  },
  {
    id: 'top_016', clusterId: 'AI-4', priority: 15, status: 'queued', searchIntent: 'informational', relatedService: '/services/organic-growth-seo/',
    topic: 'Does Google Penalise AI-Generated Content? What the Guidelines Actually Say',
    primaryQuery: 'does google penalize ai content',
    secondaryQueries: ['ai generated content seo', 'google helpful content ai', 'is ai content bad for seo'],
    notes: 'Bridges AI-4 and the SEO clusters. Cite Google Search Central guidance directly.',
  },
  {
    id: 'top_017', clusterId: 'AI-5', priority: 16, status: 'queued', searchIntent: 'informational', relatedService: '/services/data-analytics/',
    topic: 'AI in Marketing Attribution: What It Can and Cannot Tell You',
    primaryQuery: 'ai marketing attribution',
    secondaryQueries: ['ai attribution model', 'data driven attribution', 'marketing mix modelling vs attribution'],
    notes: 'Cluster AI-5 pillar. Attribution modelling is a listed capability of /services/data-analytics/.',
  },
  // SEO clusters: gaps next to the live /blog/ posts. `suggested` = never picked automatically.
  {
    id: 'top_018', clusterId: 'S-1', priority: 30, status: 'suggested', searchIntent: 'informational', relatedService: '/services/organic-growth-seo/',
    topic: 'How to Improve Core Web Vitals: Fixing LCP, INP and CLS',
    primaryQuery: 'how to improve core web vitals',
    secondaryQueries: ['improve lcp', 'reduce cls', 'what is inp'],
    notes: 'Deep dive below /blog/technical-seo-explained/ (pillar), which only introduces Core Web Vitals.',
  },
  {
    id: 'top_019', clusterId: 'S-2', priority: 31, status: 'suggested', searchIntent: 'informational', relatedService: '/services/organic-growth-seo/',
    topic: 'Digital PR for SEO: How to Earn Links Journalists Actually Use',
    primaryQuery: 'digital pr for seo',
    secondaryQueries: ['digital pr link building', 'digital pr strategy', 'digital pr examples'],
    notes: 'Digital PR & authority is a listed capability. /blog/quality-link-building-strategies/ only mentions digital PR in passing.',
  },
  {
    id: 'top_020', clusterId: 'S-3', priority: 32, status: 'suggested', searchIntent: 'commercial', relatedService: '/services/organic-growth-seo/',
    topic: 'How Much Does SEO Cost? Retainers, Projects and What Drives the Price',
    primaryQuery: 'how much does seo cost',
    secondaryQueries: ['seo pricing', 'seo retainer cost', 'seo audit cost'],
    notes: 'BUSINESS FACT GATE: needs AiS LABZ pricing approach confirmed in docs/keyword-clusters.md before it is queued.',
  },
  {
    id: 'top_021', clusterId: 'S-4', priority: 33, status: 'suggested', searchIntent: 'informational', relatedService: '/services/organic-growth-seo/',
    topic: 'Google Business Profile Optimisation: A Step-by-Step Checklist',
    primaryQuery: 'google business profile optimization',
    secondaryQueries: ['optimize google business profile', 'google business profile ranking factors', 'gbp checklist'],
    notes: 'Expands strategy 1 of /blog/local-seo-strategies-to-reach-more-customers/ (pillar). Link to the local SEO case studies under /work/.',
  },
  {
    id: 'top_022', clusterId: 'S-5', priority: 34, status: 'suggested', searchIntent: 'informational', relatedService: '/services/organic-growth-seo/',
    topic: 'Arabic SEO: Keyword Research, Content and hreflang for Bilingual Sites',
    primaryQuery: 'arabic seo',
    secondaryQueries: ['arabic keyword research', 'hreflang arabic english', 'seo in saudi arabia'],
    notes: 'Deep dive below /blog/seo-for-startups-saudi-arabia-uae/ (pillar); that post owns the startup/market overview.',
  },
];

export async function up(store) {
  const topics = store.listTopics();
  const at = now();
  const next = topics.map((t) => {
    const patch = PATCHES[t.id];
    if (!patch) return t;
    if (t.status !== 'queued') return t.clusterId ? t : { ...t, clusterId: patch.clusterId, updatedAt: at };
    return { ...t, ...patch, updatedAt: at };
  });
  const ids = new Set(next.map((t) => t.id));
  const queries = new Set(next.map((t) => t.primaryQuery.toLowerCase()));
  for (const t of NEW_TOPICS) {
    if (ids.has(t.id) || queries.has(t.primaryQuery.toLowerCase())) continue;
    next.push({ ...t, publishedArticleId: null, createdAt: at, updatedAt: at });
  }
  store.saveTopics(next);
}
