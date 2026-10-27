import { discoverModels, validateEffort, verifyReasoning } from './models.js';
import { mkdir, open, rename, unlink, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hasCode, isRecord } from './validation.js';
import { providerRegistry } from './registry.js';
import { redactor, type Environment } from './config.js';

export const providers = Object.keys(providerRegistry);
export const settingKeys = ['provider', 'model.openrouter', 'model.codex', 'model.lmstudio', 'model.live', 'endpoint.lmstudio', 'endpoint.live', 'reasoning.openrouter', 'reasoning.codex', 'reasoning.lmstudio', 'reasoning.live'];
export type SettingsValues = Record<string, string>;
export interface SettingsDocument { version: 1; defaults: SettingsValues }
export type SettingSource = 'built-in' | 'saved default' | '.env' | 'shell' | 'CLI' | 'this session';
export interface EffectiveValue { value: string; source: SettingSource; detail?: string }
export interface EffectiveSettings {
  provider: EffectiveValue; model: EffectiveValue; reasoning: EffectiveValue; endpoint: EffectiveValue;
  warnings: string[];
}
export interface SettingsInput {
  saved: SettingsValues; file: Environment; shell: Environment;
  cli: { provider?: string; model?: string; reasoning?: string }; session: SettingsValues;
}

/** Validate only nonsecret, documented fields. Missing setup is allowed as a draft. */
export function validateSetting(key: string, value: string, secrets: Environment = {}): void {
  if (!settingKeys.includes(key)) throw new Error('Unknown setting; use settings keys');
  if (!value || value.length > 2048 || redactor(secrets)(value) !== value || /sk-[A-Za-z0-9_-]+/i.test(value)) throw new Error('Setting must be nonempty and nonsecret; keep credentials outside settings');
  if (key === 'provider') {
    if (!providers.includes(value)) throw new Error('Provider must be demo, openrouter, codex, lmstudio or live');
  } else if (key.startsWith('reasoning.')) {
    validateEffort(key.slice('reasoning.'.length), value);
  } else if (key.startsWith('model.')) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(value)) throw new Error('Model must be a model identifier, not credentials or prose');
  } else {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Endpoint must be an API-root URL'); }
    if (url.username || url.password || url.search || url.hash) throw new Error('Endpoint cannot contain credentials, a query or a fragment');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Endpoint requires HTTPS except on loopback');
    if (url.pathname.replace(/\/$/, '').endsWith('/chat/completions')) throw new Error('Use the API root, not the complete chat endpoint');
  }
}

function parseDocument(raw: unknown, secrets: Environment): SettingsDocument {
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.defaults) || Object.keys(raw).some(k => !['version', 'defaults'].includes(k))) throw new Error('Unsupported or malformed settings file; use settings path for manual recovery');
  const defaults: SettingsValues = {};
  for (const [key, value] of Object.entries(raw.defaults)) {
    if (typeof value !== 'string') throw new Error('Malformed settings value');
    validateSetting(key, value, secrets); defaults[key] = value;
  }
  return { version: 1, defaults };
}

/** Atomic locked read-modify-write; corrupt files are never silently replaced. */
export class SettingsStore {
  readonly path: string;
  private readonly directory: string;
  readonly root: string;
  constructor(root: string, private readonly secrets: Environment = {}, private readonly replace: typeof rename = rename) {
    this.root = resolve(root); this.directory = join(this.root, 'config'); this.path = join(this.directory, 'settings.json');
  }
  async load(): Promise<SettingsDocument> {
    let file;
    try {
      const root = await lstat(this.root);
      if (root.isSymbolicLink() || !root.isDirectory()) throw new Error('Settings data directory cannot be a symlink');
      const parent = await lstat(this.directory);
      if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error('Settings directory cannot be a symlink');
      file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return { version: 1, defaults: {} };
      throw new Error('Cannot open settings safely; use settings path');
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 65536) throw new Error('Settings must be a regular file under 64 KiB');
      let raw: unknown;
      try { raw = JSON.parse(await file.readFile('utf8')); } catch { throw new Error('Malformed settings JSON; use settings path for manual recovery'); }
      return parseDocument(raw, this.secrets);
    } finally { await file.close(); }
  }
  async update(key: string, value?: string, related: SettingsValues = {}): Promise<SettingsDocument> {
    if (!settingKeys.includes(key)) throw new Error('Unknown setting; use settings keys');
    if (value !== undefined) validateSetting(key, value, this.secrets);
    for (const [field, entry] of Object.entries(related)) validateSetting(field, entry, this.secrets);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const root = await lstat(this.root);
    if (root.isSymbolicLink() || !root.isDirectory()) throw new Error('Settings data directory cannot be a symlink');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const parent = await lstat(this.directory);
    if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error('Settings directory cannot be a symlink');
    const lockPath = join(this.directory, 'settings.lock');
    const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Settings are busy or locked after a crash; inspect settings path'); });
    const temp = join(this.directory, `settings.${randomUUID()}.tmp`);
    try {
      const doc = await this.load();
      if (value === undefined) delete doc.defaults[key]; else doc.defaults[key] = value;
      Object.assign(doc.defaults, related);
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(doc, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
      await this.replace(temp, this.path);
      return doc;
    } finally { await unlink(temp).catch(() => {}); await lock.close(); await unlink(lockPath); }
  }
}

/** Pure effective-value resolution; no provider, network, credentials or UI dependency. */
export function resolveSettings(input: SettingsInput): EffectiveSettings {
  const { saved, file, shell, cli, session } = input;
  const secrets = { ...file, ...shell };
  for (const values of [saved, session]) for (const [key, value] of Object.entries(values)) validateSetting(key, value, secrets);
  const provider: EffectiveValue = session.provider ? { value: session.provider, source: 'this session' }
    : cli.provider ? { value: cli.provider, source: 'CLI' }
    : saved.provider ? { value: saved.provider, source: 'saved default' } : { value: 'demo', source: 'built-in' };
  validateSetting('provider', provider.value, secrets);
  const name = provider.value;
  function field(key: string, variable: string, fallback: string, cliValue?: string): EffectiveValue {
    let result: EffectiveValue = { value: saved[key] ?? fallback, source: saved[key] === undefined ? 'built-in' : 'saved default' };
    if (Object.hasOwn(file, variable)) result = { value: file[variable] ?? '', source: '.env' };
    if (Object.hasOwn(shell, variable)) result = { value: shell[variable] ?? '', source: 'shell' };
    if (cliValue !== undefined) result = { value: cliValue, source: 'CLI' };
    const override = session[key];
    if (override !== undefined) result = { value: override, source: 'this session' };
    if (!result.value && fallback) result = { value: fallback, source: result.source, detail: 'Empty value selects the built-in fallback' };
    if (result.value) validateSetting(key, result.value, secrets);
    return result;
  }
  const modelVar = name === 'codex' ? 'STAF_CODEX_MODEL' : name === 'lmstudio' ? 'LMSTUDIO_MODEL' : 'STAF_MODEL';
  const model: EffectiveValue = name === 'demo' ? { value: '', source: 'built-in' } : field(`model.${name}`, modelVar, '', cli.model);
  if (name === 'demo' && cli.model && session.provider !== 'demo') throw new Error('--model requires a live provider');
  const endpoint: EffectiveValue = name === 'lmstudio' ? field('endpoint.lmstudio', 'LMSTUDIO_BASE_URL', 'http://localhost:1234/v1/')
    : name === 'live' ? field('endpoint.live', 'STAF_BASE_URL', 'https://api.openai.com/v1/')
    : { value: name === 'openrouter' ? 'https://openrouter.ai/api/v1/' : '', source: 'built-in' };
  const reasoningVar = name === 'openrouter' ? 'OPENROUTER_REASONING_EFFORT' : name === 'codex' ? 'STAF_CODEX_REASONING' : name === 'lmstudio' ? 'LMSTUDIO_REASONING_EFFORT' : 'STAF_REASONING_EFFORT';
  const reasoning: EffectiveValue = name === 'demo' ? { value: 'default', source: 'built-in' } : field(`reasoning.${name}`, reasoningVar, 'default', cli.reasoning);
  if (name === 'demo' && cli.reasoning && cli.reasoning !== 'default') throw new Error('Demo has no reasoning control');
  validateEffort(name, reasoning.value);
  const warnings: string[] = [];
  if (['openrouter', 'live', 'lmstudio', 'codex'].includes(name) && !model.value) warnings.push('A model identifier is required before chatting.');
  if (name === 'openrouter' && !secrets.OPENROUTER_API_KEY) warnings.push('OPENROUTER_API_KEY is missing; configure it outside settings.');
  if (name === 'live' && !secrets.STAF_API_KEY) warnings.push('STAF_API_KEY is missing; configure it outside settings.');
  if (reasoning.value !== 'default') warnings.push(model.value ? 'Reasoning support is verified against model metadata before generation.' : 'Explicit reasoning requires an explicit model identifier.');
  if (name === 'codex') warnings.push('Direct Staf ChatGPT registration is required; existing CLI login is not borrowed. Use /auth codex status inside Staf.');
  return { provider, model, reasoning, endpoint, warnings };
}

/** Build the adapter options from validated values without persisting credentials. */
export function adapterSettings(effective: EffectiveSettings, env: Environment): { env: Environment; model?: string; reasoning?: string } {
  const settings = { ...env };
  if (effective.provider.value === 'lmstudio') { settings.LMSTUDIO_MODEL = effective.model.value; settings.LMSTUDIO_BASE_URL = effective.endpoint.value; }
  if (effective.provider.value === 'live') settings.STAF_BASE_URL = effective.endpoint.value;
  return { env: settings, model: effective.model.value || undefined, reasoning: effective.reasoning.value };
}

/** Hold launch-time defaults steady while offering explicit nonpersistent overrides. */
export class SettingsSession {
  private overrides: SettingsValues = {};
  private constructor(readonly store: SettingsStore, private readonly input: Omit<SettingsInput, 'session'>) {}
  static async begin(store: SettingsStore, input: Omit<SettingsInput, 'session' | 'saved'>): Promise<SettingsSession> {
    const saved = (await store.load()).defaults;
    return new SettingsSession(store, structuredClone({ ...input, saved }));
  }
  effective(): EffectiveSettings { return resolveSettings({ ...this.input, session: this.overrides }); }
  lockSession(): void { /* Compatibility: settings now apply between turns. */ }
  setSession(key: string, value: string, locked = false): void {
    const proposal = this.propose(key, value);
    this.input.cli = proposal.cli; this.overrides = proposal.overrides;
  }
  private propose(key: string, value: string) {
    validateSetting(key, value, { ...this.input.file, ...this.input.shell });
    const before = this.effective();
    const target = key === 'provider' ? value : key.split('.')[1] || before.provider.value;
    const changingProvider = target !== before.provider.value;
    const cli = { ...this.input.cli };
    const overrides = { ...this.overrides, provider: target, [key]: value };
    const related: SettingsValues = {};
    const notes: string[] = [];
    if (changingProvider) {
      delete cli.model; delete cli.reasoning;
      notes.push('Provider changes use its own model settings; generic launch model/reasoning overrides are cleared.');
    }
    if (target !== 'demo' && (changingProvider || key.startsWith('model.'))) {
      overrides[`reasoning.${target}`] = 'default';
      related[`reasoning.${target}`] = 'default';
      notes.push('Reasoning resets to provider default; choose a supported effort for the selected model separately.');
    }
    const effective = resolveSettings({ ...this.input, cli, session: overrides });
    notes.push(`Next request: ${effective.provider.value} / ${effective.model.value || '(provider default model)'} / reasoning ${effective.reasoning.value}.`);
    if (changingProvider || key.startsWith('endpoint.')) notes.push('Existing conversation history will be sent to the selected destination on the next request. Transport, context limits and native tool behavior may differ; history is preserved.');
    if (target === 'codex') notes.push('Codex direct uses its separate Staf grant; only Staf-dispatched tools are exposed.');
    notes.push('Readiness is not probed: credentials/login/server/model availability may still fail on the next request; settings remain available.');
    for (const field of ['provider', 'model', 'reasoning', 'endpoint'] as const) {
      if (['CLI', 'shell', '.env'].includes(before[field].source) && effective[field].value !== before[field].value) notes.push(`Explicit interactive override replaces ${field} from ${before[field].source}.`);
    }
    notes.push(...effective.warnings);
    return { cli, overrides, effective, related, notes };
  }
  preview(key: string, value: string): string[] { return this.propose(key, value).notes; }
  async apply(key: string, value: string, remember: boolean, verify = verifyReasoning): Promise<string[]> {
    const proposal = this.propose(key, value);
    await verify(proposal.effective, { env: {}, dataDir: this.store.root });
    // Persist before activation: a failed validation/write leaves the active snapshot intact.
    if (remember) await this.store.update(key, value, { ...proposal.related, provider: proposal.effective.provider.value });
    this.input.cli = proposal.cli; this.overrides = proposal.overrides;
    return proposal.notes;
  }
  async saveDefault(key: string, value?: string): Promise<void> { await this.store.update(key, value); }
  async modelContext(provider: string, scope: 'session' | 'default'): Promise<EffectiveSettings> {
    const saved = scope === 'default' ? (await this.store.load()).defaults : this.input.saved;
    return resolveSettings({ ...this.input, saved, cli: scope === 'default' ? {} : { ...this.input.cli, model: provider === this.effective().provider.value ? this.input.cli.model : undefined }, session: { ...(scope === 'session' ? this.overrides : {}), provider } });
  }
  async scopedModels(provider: string, scope: 'session' | 'default') {
    return discoverModels(await this.modelContext(provider, scope), { env: {}, dataDir: this.store.root });
  }
  async models(refresh = false) { return discoverModels(this.effective(), { env: {}, dataDir: this.store.root, refresh }); }
  async saved(): Promise<SettingsValues> { return (await this.store.load()).defaults; }
}
