// 001 — initial editorial database: engine state + approved topic queue.
// Manual reversal: delete data/topics.json and data/engine-state.json, set data/schema-version.json version to 0.

const now = () => new Date().toISOString();

const SEED = [
  {
    topic: 'AI Consulting Explained: How Businesses Can Move From AI Experiments to Measurable Results',
    primaryQuery: 'ai consulting',
    secondaryQueries: ['what is ai consulting', 'ai consulting services', 'ai pilot to production', 'measuring ai roi'],
    searchIntent: 'informational',
    priority: 1,
    relatedService: 'ai-consulting',
    notes: 'Pillar for consulting/strategy cluster. Focus on moving from pilots to measured outcomes; distinct from topic 10 (strategy framework) and topic 6 (readiness).',
  },
  {
    topic: 'AI Automation for Business: How to Automate Workflows Without Losing Human Control',
    primaryQuery: 'ai automation for business',
    secondaryQueries: ['human in the loop automation', 'ai automation governance', 'business process automation with ai'],
    searchIntent: 'informational',
    priority: 2,
    relatedService: 'ai-automation',
    notes: 'Pillar for automation cluster; angle is oversight and control. Topic 8 is the narrower "what to automate" selection framework — link, do not duplicate.',
  },
  {
    topic: 'AI Agents for Business: What They Are, How They Work, and Where They Create Value',
    primaryQuery: 'ai agents for business',
    secondaryQueries: ['what are ai agents', 'ai agents vs automation', 'how do ai agents work', 'ai agent use cases'],
    searchIntent: 'informational',
    priority: 3,
    relatedService: 'ai-agents',
    notes: 'Definition-led; must clearly distinguish agents from rule-based automation (supports topics 2 and 8).',
  },
  {
    topic: 'How to Get Your Business Mentioned by ChatGPT, Gemini and AI Search Engines',
    primaryQuery: 'how to get mentioned by chatgpt',
    secondaryQueries: ['ai search visibility', 'how do ai assistants choose sources', 'brand mentions in ai answers'],
    searchIntent: 'informational',
    priority: 4,
    relatedService: 'ai-search-optimization',
    notes: 'Brand/entity visibility angle. Topic 5 is the conceptual SEO/AEO/GEO comparison; topic 9 is the website build checklist.',
  },
  {
    topic: 'SEO vs AEO vs GEO: How Search Visibility Is Changing in the Age of AI',
    primaryQuery: 'seo vs aeo vs geo',
    secondaryQueries: ['what is answer engine optimization', 'what is generative engine optimization', 'aeo vs seo'],
    searchIntent: 'informational',
    priority: 5,
    relatedService: 'ai-search-optimization',
    notes: 'Comparison/definitions article. Must avoid overlapping with topic 4 tactics.',
  },
  {
    topic: 'AI Readiness Assessment: Is Your Business Actually Ready to Implement AI?',
    primaryQuery: 'ai readiness assessment',
    secondaryQueries: ['is my business ready for ai', 'ai readiness checklist', 'data readiness for ai'],
    searchIntent: 'informational',
    priority: 6,
    relatedService: 'ai-consulting',
    notes: 'Assessment/checklist intent.',
  },
  {
    topic: 'Generative AI for Business: Practical Use Cases That Go Beyond Chatbots',
    primaryQuery: 'generative ai use cases for business',
    secondaryQueries: ['generative ai examples in business', 'enterprise generative ai applications'],
    searchIntent: 'informational',
    priority: 7,
    relatedService: 'generative-ai',
    notes: 'Use-case catalogue; every use case must be evidence-backed or explicitly hypothetical.',
  },
  {
    topic: 'AI Workflow Automation: A Practical Framework for Choosing What to Automate',
    primaryQuery: 'ai workflow automation',
    secondaryQueries: ['which processes to automate', 'automation prioritization framework', 'workflow automation criteria'],
    searchIntent: 'informational',
    priority: 8,
    relatedService: 'ai-automation',
    notes: 'Supporting article to topic 2: decision framework only. Strategist must check cannibalization against topic 2 once published.',
  },
  {
    topic: 'How to Build an AI-Ready Website for Google, ChatGPT and Generative Search',
    primaryQuery: 'ai ready website',
    secondaryQueries: ['website for generative search', 'structured data for ai search', 'technical seo for ai crawlers'],
    searchIntent: 'informational',
    priority: 9,
    relatedService: 'ai-search-optimization',
    notes: 'Technical implementation angle; link to topics 4 and 5.',
  },
  {
    topic: 'AI Strategy for Business: A Step-by-Step Framework From Opportunity to Implementation',
    primaryQuery: 'ai strategy for business',
    secondaryQueries: ['ai strategy framework', 'how to create an ai strategy', 'ai roadmap'],
    searchIntent: 'informational',
    priority: 10,
    relatedService: 'ai-consulting',
    notes: 'Framework/process article. Distinct from topic 1 (what consulting is / pilots to results).',
  },
];

export async function up(store) {
  if (!store.readJson('engine-state.json')) {
    store.writeJson('engine-state.json', { paused: false, usage: {} });
  }
  const existing = store.listTopics();
  if (existing.length) return; // never overwrite an existing queue
  const topics = SEED.map((t, i) => ({
    id: `top_${String(i + 1).padStart(3, '0')}`,
    ...t,
    status: 'queued',
    publishedArticleId: null,
    createdAt: now(),
    updatedAt: now(),
  }));
  store.saveTopics(topics);
}
