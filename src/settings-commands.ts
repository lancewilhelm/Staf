import { SettingsSession, SettingsStore, providers, settingKeys } from './settings.js';

export const settingsHelp = ['Settings (no model call):',
  'models [FILTER] [refresh] | reasoning [refresh] (metadata only; no generation)',
  'model session|default MODEL_ID | reasoning session|default LEVEL',
  'show | keys | providers | path | back | cancel',
  'set session KEY VALUE   (next request; not saved)',
  'set default KEY VALUE   (chat: now and future launches; terminal: future launches)',
  'unset default KEY       (future launches only)',
  'reload                  (chat only; re-read config before a completed turn)',
].join('\n');

/** Shared deterministic command entry point for slash and terminal settings clients. */
export async function settingsCommand(store: SettingsStore, session: SettingsSession | undefined, args: string[], locked = false, terminal = false): Promise<string> {
  const [command, scope, key, ...rest] = args;
  if (!command || command === 'help') return settingsHelp;
  if (['back', 'cancel'].includes(command)) return 'Settings closed. No changes.';
  if (command === 'path') return store.path;
  if (command === 'keys') return settingKeys.join('\n');
  if (command === 'providers') return providers.join('\n');
  if (!session) throw new Error('Settings could not load. Use settings path, repair the file, then reload; existing data was not overwritten');
  if (command === 'models' || command === 'reasoning' && (!scope || scope === 'refresh')) {
    const argumentsAfter = args.slice(1);
    const filters = argumentsAfter.filter(value => value !== 'refresh');
    if (command === 'models' && filters.length > 1) throw new Error('Use models [FILTER] [refresh]');
    const catalog = await session.models(argumentsAfter.includes('refresh'));
    if (command === 'models') {
      const filter = filters[0]?.toLowerCase();
      const models = catalog.models.filter(model => !filter || `${model.id} ${model.label}`.toLowerCase().includes(filter));
      return [`Model catalog: ${catalog.source}`, `Fetched: ${catalog.fetchedAt}; ${catalog.cached ? 'cached' : 'fresh'}`,
        ...models.map(model => `${model.id} | ${model.label} | reasoning: ${model.reasoning === null ? model.reasoningStatus : ['default', ...model.reasoning].join(', ')}`),
        `${models.length} of ${catalog.models.length} models shown. Choose with model session ID or model default ID.`, catalog.note].join('\n');
    }
    const model = catalog.models.find(model => model.id === session.effective().model.value);
    return JSON.stringify({ model: session.effective().model, reasoning: session.effective().reasoning,
      source: catalog.source, fetchedAt: catalog.fetchedAt, cached: catalog.cached,
      choices: ['default', ...(model?.reasoning || [])],
      defaultReasoning: model?.defaultReasoning, defaultEnabled: model?.reasoningDefaultEnabled, mandatory: model?.reasoningMandatory, budgetSupported: model?.reasoningBudgetSupported, advertisedReasoning: model?.advertisedReasoning, status: model?.reasoningStatus || 'unknown', note: model?.note || catalog.note }, null, 2);
  }
  if ((command === 'model' || command === 'reasoning') && (scope === 'session' || scope === 'default') && key && !rest.length) {
    const provider = session.effective().provider.value;
    if (provider === 'demo') throw new Error('Demo has no model or reasoning controls; select a provider first');
    return settingsCommand(store, session, ['set', scope, `${command === 'model' ? 'model' : 'reasoning'}.${provider}`, key], locked, terminal);
  }
  if (command === 'show') return JSON.stringify({ effective: session.effective(), savedDefaults: await session.saved(), timing: 'Confirmed chat edits apply to the next request; remembered edits also persist. Terminal defaults affect future launches.' }, null, 2);
  if (command === 'set' && key && rest.length && ['session', 'default'].includes(scope || '')) {
    const value = rest.join(' ');
    if (scope === 'session') {
      if (terminal) throw new Error('This-session settings require chat /settings; use explicit launch flags from the terminal');
      const notes = await session.apply(key, value, false);
      return ['Applied to next request in this session. Nothing saved.', ...notes].join('\n');
    }
    if (terminal) { await session.saveDefault(key, value); return 'Default saved for future launches. Running chats are unchanged.'; }
    const notes = await session.apply(key, value, true);
    return ['Applied to next request and remembered as my default.', ...notes].join('\n');
  }
  if (command === 'unset' && scope === 'default' && key && !rest.length) {
    await session.saveDefault(key); return 'Default removed for future launches.';
  }
  throw new Error('Unknown settings command. Use /settings or settings help; credentials are not settings');
}
