import {directCodexProvider} from './codex-direct.js';
import {loadDirectCredential} from './codex-direct-auth.js';
import {randomUUID} from 'node:crypto';
import { verifyProviderSelection } from './models.js';
import type { Environment } from './config.js';
import type { Provider } from './types.js';
import { demoProvider, liveProvider, openRouterProvider, lmStudioProvider } from './providers.js';
import { resolve } from 'node:path';

interface ProviderOptions { env: Environment; model?: string; reasoning?: string; dataDir?: string; sessionId?: string }
interface Registration {
  description: string;
  create(options: ProviderOptions): Provider | Promise<Provider>;
}

/** CLI selection ends here; adding an adapter does not change the conversation loop. */
export const providerRegistry: Readonly<Record<string, Registration>> = {
  demo: { description: 'DEMO — offline, no model', create: ({ model }) => {
    if (model) throw new Error('--model requires a live provider');
    return demoProvider;
  } },
  openrouter: { description: 'OPENROUTER — API credits/charges', create: ({ env, model, reasoning }) => openRouterProvider(env, model, fetch, reasoning) },
  codex: { description: 'CODEX DIRECT — Staf ChatGPT-plan registration; no CLI fallback', create: async ({ model, reasoning, dataDir, sessionId }) => {
    if(!model)throw Error('Choose an account-available model for direct Codex');
    await loadDirectCredential(dataDir || resolve('.staf'));
    return directCodexProvider({model,reasoning,dataDir:dataDir||resolve('.staf'),sessionId:sessionId||randomUUID()});
  } },
  lmstudio: { description: 'LM STUDIO — configured server', create: ({ env, model }) => lmStudioProvider(env, model) },
  live: { description: 'LIVE — API charges may apply', create: ({ env, model }) => liveProvider({ ...env, STAF_MODEL: model || env.STAF_MODEL }) },
};

export async function selectProvider(name: string, options: ProviderOptions): Promise<{ provider: Provider; description: string }> {
  // Own-property check prevents names such as constructor from selecting inherited objects.
  const registration = Object.hasOwn(providerRegistry, name) ? providerRegistry[name] : undefined;
  if (!registration) throw new Error(`Provider must be ${Object.keys(providerRegistry).join(', ')}`);
  await verifyProviderSelection(name, options);
  return { provider: await registration.create(options), description: registration.description };
}
