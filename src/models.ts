import {directAccessToken} from './codex-direct-auth.js';
import type { EffectiveSettings } from './settings.js';
import type { Environment } from './config.js';
import { isRecord, isArray } from './validation.js';
import { createCodexContext } from './codex-context.js';
import { createCodexRunner, type CodexRunner } from './codex.js';

export const gatewayEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export interface ModelInfo { contextWindow?: number; id: string; label: string; reasoning: string[] | null; reasoningStatus: 'advertised' | 'unknown' | 'unsupported-transport'; defaultReasoning?: string; reasoningDefaultEnabled?: boolean; reasoningMandatory?: boolean; reasoningBudgetSupported?: boolean; advertisedReasoning?: string[]; note?: string }
export interface ModelCatalog { source: string; fetchedAt: string; cached: boolean; models: ModelInfo[]; note: string }
interface DiscoveryOptions { env: Environment; dataDir: string; refresh?: boolean; request?: typeof fetch; codex?: CodexRunner }
const cache = new Map<string, { time: number; result: ModelCatalog }>();
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(value);

/** Parse only metadata fields. Never retain provider descriptions, internal prompts or credentials. */
export function parseModels(raw: unknown, provider: string): ModelInfo[] {
  if (!isRecord(raw)) throw new Error('Invalid model catalog');
  const items = provider === 'codex' ? raw.models : raw.data;
  if (!isArray(items)) throw new Error('Invalid model catalog');
  const models: ModelInfo[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = provider === 'codex' ? item.slug : item.id;
    if (!safeId(id)) continue;
    let reasoning: string[] | null = null;
    let defaultReasoning: string | undefined;
    let note: string | undefined;
    let reasoningDefaultEnabled: boolean | undefined;
    let reasoningMandatory: boolean | undefined;
    let reasoningBudgetSupported: boolean | undefined;
    let advertisedReasoning: string[] | undefined;
    if (provider === 'codex' && isArray(item.supported_reasoning_levels)) {
      advertisedReasoning = item.supported_reasoning_levels.flatMap(level => isRecord(level) && safeId(level.effort) ? [level.effort] : []);
      reasoning = item.supported_reasoning_levels.flatMap(level => isRecord(level) && typeof level.effort === 'string' && gatewayEfforts.includes(level.effort) ? [level.effort] : []);
      if (typeof item.default_reasoning_level === 'string') defaultReasoning = item.default_reasoning_level;
      note = 'Account catalog metadata; not proof of model readiness. Ultra/delegating presets are not exposed.';
    } else if (provider === 'openrouter' && isRecord(item.reasoning)) {
      reasoningDefaultEnabled = typeof item.reasoning.default_enabled === 'boolean' ? item.reasoning.default_enabled : undefined;
      reasoningMandatory = typeof item.reasoning.mandatory === 'boolean' ? item.reasoning.mandatory : undefined;
      reasoningBudgetSupported = typeof item.reasoning.supports_max_tokens === 'boolean' ? item.reasoning.supports_max_tokens : undefined;
      const levels = item.reasoning.supported_efforts;
      reasoning = levels === null ? [...gatewayEfforts] : isArray(levels) ? levels.filter((value): value is string => typeof value === 'string' && gatewayEfforts.includes(value)) : null;
      if (item.reasoning.mandatory === true && reasoning) reasoning = reasoning.filter(level => level !== 'none');
      if (typeof item.reasoning.default_effort === 'string' && gatewayEfforts.includes(item.reasoning.default_effort)) defaultReasoning = item.reasoning.default_effort;
    }
    const label = provider === 'codex' ? item.display_name : item.name;
    const limit = provider === 'openrouter' ? item.context_length : provider === 'codex' ? item.context_window : undefined;
    const contextWindow = typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0 ? limit : undefined;
    models.push({ ...(contextWindow ? { contextWindow } : {}), id, reasoningDefaultEnabled, reasoningMandatory, reasoningBudgetSupported, advertisedReasoning, reasoningStatus: ['lmstudio', 'live'].includes(provider) ? 'unsupported-transport' : reasoning === null ? 'unknown' : 'advertised', label: typeof label === 'string' ? label.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 120) : id, reasoning, defaultReasoning, note });
  }
  return models;
}

function catalogSource(effective: EffectiveSettings): string {
  const provider = effective.provider.value;
  return provider === 'codex' ? 'https://api.openai.com/v1/models' : provider === 'openrouter' ? 'https://openrouter.ai/api/v1/models' : effective.endpoint.value.replace(/\/?$/, '/') + 'models';
}
/** Passive observation only: never performs I/O, including when metadata is stale. */
export function cachedModelCatalog(effective: EffectiveSettings): (ModelCatalog & {stale: boolean}) | undefined {
  const entry = cache.get(`${effective.provider.value}:${catalogSource(effective)}`);
  return entry ? { ...structuredClone(entry.result), cached: true, stale: Date.now() - entry.time >= 300000 } : undefined;
}

/** Metadata only. Discovery is explicit, bounded, no generation, and never falls back to a new host. */
export async function discoverModels(effective: EffectiveSettings, options: DiscoveryOptions): Promise<ModelCatalog> {
  const provider = effective.provider.value;
  const source = catalogSource(effective);
  if (provider === 'demo') return { source: 'built-in demo', fetchedAt: new Date().toISOString(), cached: false, models: [], note: 'Demo has no model or reasoning control.' };
  const key = `${provider}:${source}`;
  const found = cache.get(key);
  if (!options.refresh && !options.request && !options.codex && found && Date.now() - found.time < 300000) return { ...structuredClone(found.result), cached: true };
  let raw: unknown;
  try {
    if (provider === 'codex' && options.codex) {
      // Legacy injected fixtures only; production never launches the CLI for direct selection.
      raw = JSON.parse(await options.codex(['debug','models','--bundled']));
    } else {
      const url = new URL(source);
      if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Unsafe metadata endpoint');
      const response = await (options.request || fetch)(url, {
        headers: provider==='codex'?{Authorization:`Bearer ${await directAccessToken(options.dataDir,options.request||fetch)}`}:{}, redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Metadata request rejected');
      const text = await response.text();
      if (text.length > 5 * 1024 * 1024) throw new Error('Catalog too large');
      raw = JSON.parse(text);
    }
    const result: ModelCatalog = { source, fetchedAt: new Date().toISOString(), cached: false, models: parseModels(raw, provider), note: 'Metadata is not an availability guarantee. Unknown reasoning stays unknown; manual model IDs remain supported.' };
    if (!options.request && !options.codex) cache.set(key, { time: Date.now(), result: structuredClone(result) });
    return result;
  } catch { throw new Error('Model discovery unavailable; existing settings are unchanged. Enter a model ID manually and keep reasoning at default, or refresh later.'); }
}

export function validateEffort(provider: string, effort: string): void {
  if (!effort || effort === 'default') return;
  if (!['openrouter', 'codex'].includes(provider)) throw new Error('Explicit reasoning effort is not supported by this adapter; use default');
  if (!gatewayEfforts.includes(effort)) throw new Error('Unsupported reasoning effort; inspect the selected model, or use default');
}

/** Fail before generation unless current model metadata explicitly supports the selected effort. */
export async function verifyReasoning(effective: EffectiveSettings, options: DiscoveryOptions): Promise<void> {
  const effort = effective.reasoning.value;
  validateEffort(effective.provider.value, effort);
  if (!effort || effort === 'default') return;
  if (!effective.model.value) throw new Error('Choose an explicit model before selecting a reasoning effort');
  const catalog = await discoverModels(effective, options);
  const model = catalog.models.find(model => model.id === effective.model.value);
  if (!model?.reasoning?.includes(effort)) throw new Error('Selected model does not advertise that reasoning effort. Use default or inspect reasoning choices.');
}

export async function verifyProviderSelection(provider: string, options: { env: Environment; model?: string; reasoning?: string; dataDir?: string }): Promise<void> {
  const effort = options.reasoning || 'default';
  validateEffort(provider, effort);
  if (effort === 'default') return;
  const model = options.model || (provider === 'codex' ? options.env.STAF_CODEX_MODEL : options.env.STAF_MODEL) || '';
  const value = (value: string): EffectiveSettings['provider'] => ({ value, source: 'CLI' });
  await verifyReasoning({ provider: value(provider), model: value(model), reasoning: value(effort), endpoint: value(provider === 'openrouter' ? 'https://openrouter.ai/api/v1/' : ''), warnings: [] }, { env: {}, dataDir: options.dataDir || '.staf' });
}
