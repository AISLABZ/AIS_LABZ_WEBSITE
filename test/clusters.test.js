import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { up } from '../migrations/002_keyword_clusters.js';
import { selectTopic } from '../src/pipeline/topic-selector.js';
import { clusterForPrompt } from '../src/pipeline/evidence.js';
import * as actions from '../src/pipeline/actions.js';

test('keyword-cluster migration: every topic belongs to a configured cluster, intents stay unique', async () => {
  const { cfg, store, cleanup } = await setup();
  try {
    const topics = store.listTopics();
    const clusterIds = new Set(cfg.site.topicClusters.map((c) => c.id));
    for (const t of topics) assert.ok(clusterIds.has(t.clusterId), `${t.id} has unknown cluster ${t.clusterId}`);
    const queries = topics.map((t) => t.primaryQuery.toLowerCase());
    assert.equal(new Set(queries).size, queries.length, 'primary queries are unique');
    assert.equal(topics.find((t) => t.id === 'top_004').status, 'covered_by_existing');
    assert.equal(topics.find((t) => t.id === 'top_001').primaryQuery, 'what is ai consulting', 'service page keeps the commercial query');
    assert.ok(topics.filter((t) => t.clusterId.startsWith('S-')).every((t) => t.status === 'suggested'), 'SEO gaps are never auto-selected');
    const { topic } = selectTopic(topics, []);
    assert.equal(topic.id, 'top_001', 'queue starts with the AI-1 pillar');

    // Idempotent, and never touches topics the engine has already picked up.
    store.updateTopic('top_002', { status: 'drafted', primaryQuery: 'kept as is' });
    await up(store);
    const again = store.listTopics();
    assert.equal(again.length, topics.length);
    assert.equal(again.find((t) => t.id === 'top_002').primaryQuery, 'kept as is');
  } finally { cleanup(); }
});

test('topics accept a clusterId; strategist gets the cluster context', async () => {
  const { cfg, store, cleanup } = await setup();
  try {
    const t = actions.addTopic(store, { topic: 'A brand new topic for testing', primaryQuery: 'brand new query', clusterId: 'AI-2' });
    assert.equal(t.clusterId, 'AI-2');
    assert.throws(() => actions.addTopic(store, { topic: 'Another topic for testing', primaryQuery: 'other query', clusterId: 'bad id' }));
    actions.editTopic(store, 'top_003', { priority: 40 });
    const ctx = clusterForPrompt(cfg.site, { clusterId: 'AI-3' });
    assert.equal(ctx.serviceUrl, '/services/organic-growth-seo/');
    assert.ok(ctx.existingPagesInCluster.some((p) => p.url === '/blog/answer-engine-optimization-guide/'));
    assert.equal(clusterForPrompt(cfg.site, { clusterId: undefined }), null);
  } finally { cleanup(); }
});
