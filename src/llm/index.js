import { apiJson, retry } from '../lib/http.js';
import { validate } from '../lib/validate.js';

export class BudgetError extends Error {
  constructor(msg) { super(msg); this.name = 'BudgetError'; }
}

export class LlmNotConfiguredError extends Error {
  constructor() { super('LLM is not configured (set LLM_PROVIDER, LLM_MODEL and the provider API key)'); this.name = 'LlmNotConfiguredError'; }
}

async function callOpenAI({ apiKey, model, system, user, maxTokens, fetchImpl }) {
  const res = await apiJson('https://api.openai.com/v1/chat/completions', {
    headers: { authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      max_completion_tokens: maxTokens,
    },
    fetchImpl,
  });
  return {
    text: res.choices?.[0]?.message?.content || '',
    finish: res.choices?.[0]?.finish_reason,
    inputTokens: res.usage?.prompt_tokens || 0,
    outputTokens: res.usage?.completion_tokens || 0,
  };
}

async function callAnthropic({ apiKey, model, system, user, maxTokens, fetchImpl }) {
  const res = await apiJson('https://api.anthropic.com/v1/messages', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: {
      model,
      max_tokens: maxTokens,
      system: `${system}\n\nRespond with a single JSON object only. No prose, no code fences.`,
      messages: [{ role: 'user', content: user }],
    },
    fetchImpl,
  });
  return {
    text: (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''),
    finish: res.stop_reason,
    inputTokens: res.usage?.input_tokens || 0,
    outputTokens: res.usage?.output_tokens || 0,
  };
}

function parseJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(cleaned);
}

/**
 * Bounded LLM client. Every call:
 *  - counts against LLM_MAX_CALLS_PER_RUN and the optional monthly token budget,
 *  - must return JSON matching `schema` (one repair attempt, then the stage fails),
 *  - is logged (stage, tokens, duration) without prompt or key contents.
 */
export function createLlm(cfg, store, { run, logger, transport } = {}) {
  const { provider, model, apiKey, maxOutputTokens, maxCallsPerRun, monthlyTokenBudget } = cfg.llm;
  const configured = Boolean(transport || (provider && model && apiKey));
  let calls = 0;
  const usageLog = [];

  const doCall = transport || ((args) => (provider === 'anthropic' ? callAnthropic : callOpenAI)({ apiKey, model, ...args }));

  function checkBudget() {
    if (calls >= maxCallsPerRun) throw new BudgetError(`LLM call limit reached (${maxCallsPerRun} per run)`);
    if (monthlyTokenBudget > 0) {
      const month = new Date().toISOString().slice(0, 7);
      const used = store.getState().usage?.[month]?.tokens || 0;
      if (used >= monthlyTokenBudget) throw new BudgetError(`Monthly LLM token budget exhausted (${used}/${monthlyTokenBudget})`);
    }
  }

  function recordUsage(stage, r, ms) {
    const month = new Date().toISOString().slice(0, 7);
    const state = store.getState();
    const usage = state.usage || {};
    const m = usage[month] || { tokens: 0, calls: 0 };
    m.tokens += r.inputTokens + r.outputTokens;
    m.calls += 1;
    usage[month] = m;
    store.updateState({ usage });
    const entry = { stage, model: model || 'test', inputTokens: r.inputTokens, outputTokens: r.outputTokens, ms };
    usageLog.push(entry);
    if (run) run.llmUsage = usageLog;
    logger?.info('llm call', entry);
  }

  async function json(stage, { system, user, schema, maxTokens = maxOutputTokens }) {
    if (!configured) throw new LlmNotConfiguredError();
    let prompt = user;
    for (let attempt = 0; attempt < 2; attempt++) {
      checkBudget();
      calls++;
      const t0 = Date.now();
      const r = await retry(() => doCall({ system, user: prompt, maxTokens: Math.min(maxTokens, maxOutputTokens) }), { attempts: 2, delayMs: 2000 });
      recordUsage(stage, r, Date.now() - t0);
      let parsed;
      let errors;
      try {
        parsed = parseJson(r.text);
        errors = schema ? validate(parsed, schema) : [];
      } catch (err) {
        errors = [`invalid JSON: ${err.message}${r.finish === 'length' || r.finish === 'max_tokens' ? ' (output truncated at token limit)' : ''}`];
      }
      if (!errors.length) return parsed;
      if (attempt === 1) {
        const e = new Error(`${stage}: model output failed validation: ${errors.slice(0, 5).join('; ')}`);
        e.validationErrors = errors;
        throw e;
      }
      prompt = `${user}\n\nYour previous response was rejected for these reasons:\n- ${errors.slice(0, 10).join('\n- ')}\nReturn corrected JSON only.`;
    }
    throw new Error('unreachable');
  }

  return { json, get calls() { return calls; }, configured, usageLog };
}
