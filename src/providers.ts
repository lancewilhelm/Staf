import { chatSystemMessage } from './prompts.js';
import { httpUsage } from './usage.js';
import { validateEffort } from './models.js';
import type { Provider } from './types.js';
import { isArray, isAssistantMessage, isRecord } from './validation.js';

// Deterministic demonstration, explicitly not a language model.
export const demoProvider: Provider = {
  name: 'demo',
  capabilities: { toolCalls: true, incrementalText: false, transport: 'demo' },
  async complete(messages) {
    const last = messages.at(-1);
    if (!last) throw new Error('Demo requires a message');
    if (last.role === 'tool') return { role: 'assistant', content: `Demo tool result: ${last.content}` };
    if (/\btime\b/i.test(last.content ?? '')) return {
      role: 'assistant', content: null,
      tool_calls: [{ id: 'clock-demo', type: 'function', function: { name: 'clock', arguments: '{}' } }],
    };
    return { role: 'assistant', content: `Demo (offline): ${last.content}. User turns saved: ${messages.filter(m => m.role === 'user').length}. Ask "what time is it?" to see a tool call.` };
  },
};

function compatibleProvider(env: Record<string, string | undefined>, request: typeof fetch, requireKey: boolean, effort?: string, usageProvider: 'openrouter'|'lmstudio'|'live' = 'live'): Provider {
  const { STAF_API_KEY: key, STAF_MODEL: model } = env;
  if ((requireKey && !key) || !model) throw new Error('Live mode requires STAF_API_KEY and STAF_MODEL');
  const endpoint = new URL(env.STAF_BASE_URL || 'https://api.openai.com/v1/');
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) {
    throw new Error('Use HTTPS, or HTTP on localhost');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Base URL cannot contain credentials, query or fragment');
  endpoint.pathname = endpoint.pathname.replace(/\/?$/, '/') + 'chat/completions';
  return {
    capabilities: { toolCalls: true, incrementalText: false, transport: 'chat-completions' },
    name: `live:${endpoint.origin}${endpoint.pathname}:${model}`,
    async complete(messages, tools) {
      let response: Response;
      try { response = await request(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [chatSystemMessage, ...messages.map(message => {const {usage, responseReplay, ...visible} = message.role === 'assistant' ? message : {...message,usage:undefined,responseReplay:undefined};return visible;})], tools, ...(effort && effort !== 'default' ? { reasoning: { effort } } : {}) }),
      }); } catch { throw new Error('Provider connection failed or timed out; check endpoint and server availability'); }
      if (!response.ok) {
        const hint = response.status === 401 ? 'check your API key' : response.status === 402 ? 'provider credits are required' : response.status === 429 ? 'rate limit reached; retry later' : 'request failed';
        throw new Error(`Provider HTTP ${response.status}: ${hint}`);
      }
      let body: unknown;
      try { body = await response.json(); } catch { throw new Error('Invalid provider JSON response'); }
      if (!isRecord(body) || !isArray(body.choices) || !isRecord(body.choices[0])) {
        throw new Error('Invalid provider response');
      }
      const message = body.choices[0].message;
      if (!isAssistantMessage(message)) throw new Error('Invalid provider response');
      const usage = httpUsage(body, usageProvider);
      if (message.tool_calls?.length) return {
        usage,
        role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls,
      };
      if (typeof message.content !== 'string') throw new Error('Invalid provider response');
      return { role: 'assistant', content: message.content, usage };
    },
  };
}

/** OpenRouter uses its official endpoint and a key separate from Codex login. */
export function openRouterProvider(env: Record<string, string | undefined>, model?: string, request: typeof fetch = fetch, effort?: string): Provider {
  validateEffort('openrouter', effort || 'default');
  if (!env.OPENROUTER_API_KEY) throw new Error('OpenRouter requires OPENROUTER_API_KEY in the shell or project .env');
  const selected = model || env.STAF_MODEL;
  if (!selected) throw new Error('OpenRouter requires --model PROVIDER/MODEL or STAF_MODEL');
  const provider = compatibleProvider({ STAF_API_KEY: env.OPENROUTER_API_KEY, STAF_MODEL: selected, STAF_BASE_URL: 'https://openrouter.ai/api/v1/' }, request, true, effort, 'openrouter');
  return { ...provider, name: `openrouter:${selected}${effort && effort !== 'default' ? `:reasoning=${effort}` : ''}` };
}

export function liveProvider(env: Record<string, string | undefined> = process.env, request: typeof fetch = fetch): Provider {
  return compatibleProvider(env, request, true);
}

/** Use LM Studio's OpenAI-compatible local server; authentication is optional. */
export function lmStudioProvider(env: Record<string, string | undefined>, model?: string, request: typeof fetch = fetch): Provider {
  const selected = model || env.LMSTUDIO_MODEL;
  if (!selected) throw new Error('LM Studio requires --model LOADED_MODEL_ID or LMSTUDIO_MODEL');
  const base = env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1/';
  const provider = compatibleProvider({ STAF_MODEL: selected, STAF_BASE_URL: base, STAF_API_KEY: env.LMSTUDIO_API_KEY }, request, false, undefined, 'lmstudio');
  return { ...provider, name: `lmstudio:${new URL(base).origin}${new URL(base).pathname.replace(/\/?$/, '/')}:${selected}` };
}
