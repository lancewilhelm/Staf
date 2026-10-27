import {directAuth, loadDirectCredential} from './codex-direct-auth.js';
import { contextStatus, contextFooter, contextDetails } from './context-status.js';
import { usageText, usageHelp } from './usage.js';
import { SettingsSession, SettingsStore, adapterSettings } from './settings.js';
import { settingsCommand, settingsHelp } from './settings-commands.js';
import { codexAuth } from './codex.js';
import { errorMessage } from './validation.js';
import { loadEnvironment, redactor } from './config.js';
import { selectProvider } from './registry.js';
import { resolve } from 'node:path';
import { ChatInput } from './chat-input.js';
import { TerminalView, cleanText } from './terminal-view.js';
import { canUseSettingsMenu, openSettingsMenu } from './settings-menu.js';
import { providers } from './settings.js';
import { Store } from './store.js';
import { runTurn } from './runtime.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: pnpm start [--model MODEL] [--reasoning LEVEL] [--live] [--session ID] [--data-dir PATH]\n       pnpm start sessions [--data-dir PATH]\nAuth: pnpm start auth codex login|status|logout [--data-dir PATH]\nSettings: pnpm start settings show|keys|providers|path|set default KEY VALUE|unset default KEY\nUsage: /usage [details|help] shows local reported usage, no model call.\nContext: /context [refresh|help] explains the visible payload proxy and metadata window; no compaction.\nChat auth: /auth codex login|status|logout (no separate process needed).\nChat: /settings selects provider/model (TTY: arrows/hjkl; otherwise text commands). No model needed.\nCompatibility: --provider NAME remains an optional scripting override.\nDefault: offline demo unless saved defaults select another provider. /quit exits. Live mode can incur provider charges.');
    return;
  }

  let settingsArgs: string[] | undefined;
  if (args[0] === 'settings') {
    args.shift();
    const dataIndex = args.findIndex(arg => arg.startsWith('--'));
    settingsArgs = dataIndex < 0 ? args.splice(0) : args.splice(0, dataIndex);
  }
  let legacyAuth = false;
  let authAction: string | undefined;
  if (args[0] === 'auth') {
    if (!['codex','codex-legacy'].includes(args[1] || '') || !args[2]) throw new Error('Use auth codex login, status or logout');
    legacyAuth = args[1] === 'codex-legacy';
    authAction = args[2];
    args.splice(0, 3);
  }
  let selected: string | undefined;
  let model: string | undefined;
  let reasoning: string | undefined;
  let id: string | undefined;
  let root = resolve('.staf'), live = false, listing = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--live') live = true;
    else if (arg === 'sessions') listing = true;
    else if (arg !== undefined && ['--session', '--data-dir', '--provider', '--model', '--reasoning'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--session') id = value;
      else if (arg === '--provider') selected = value;
      else if (arg === '--model') model = value;
      else if (arg === '--reasoning') reasoning = value;
      else root = resolve(value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (authAction) {
    if (selected || model || reasoning || live || listing || id) throw new Error('Auth commands only accept --data-dir');
    console.log(await (legacyAuth ? codexAuth(authAction, root) : directAuth(authAction, root)));
    return;
  }
  const settingsStore = new SettingsStore(root, process.env);
  if (settingsArgs && ['path', 'keys', 'providers', 'help'].includes(settingsArgs[0] || 'help')) {
    console.log(settingsArgs[0] === 'help' || !settingsArgs.length ? settingsHelp : await settingsCommand(settingsStore, undefined, settingsArgs)); return;
  }
  let file: Record<string, string | undefined> = {};
  let envError: string | undefined;
  try { file = await loadEnvironment(resolve('.env'), {}); } catch (error) { envError = errorMessage(error); }
  const env = { ...file, ...process.env };
  let redact = redactor(env);
  let configuredStore = new SettingsStore(root, env);
  if (live && selected && selected !== 'live') throw new Error('--live conflicts with --provider');
  const cli = { provider: selected || (live ? 'live' : undefined), model, reasoning };
  let settings: SettingsSession | undefined;
  let settingsError: string | undefined;
  try { settings = await SettingsSession.begin(configuredStore, { file, shell: { ...process.env }, cli }); }
  catch (error) { settingsError = errorMessage(error); }
  // Invalid explicit CLI choices remain immediate errors; missing provider setup does not.
  if (settings && !settingsError) settings.effective();
  if (settingsArgs) {
    if (envError) console.error(redact(`Environment file unavailable: ${envError}. Effective view excludes it; repair .env before chatting.`));
    console.log(redact(await settingsCommand(configuredStore, settings, settingsArgs, false, true))); return; }
  const store = new Store(root);
  if (listing) { for (const item of await store.list()) console.log(item); return; }
  const description = settings && !envError ? 'SETTINGS AVAILABLE — /settings shows effective values' : 'SETUP REQUIRED — /settings path for recovery';
  const sessionId = id || (await store.create()).id;
  const release = await store.lock(sessionId);
  const view = new TerminalView(!!process.stdout.isTTY);
  const errorView = new TerminalView(!!process.stderr.isTTY);
  let terminal: ChatInput | undefined;
  let activeAbort: AbortController | undefined;
  let lastAnnouncedProviderName: string | undefined;
  try {
    const session = await store.load(sessionId);
    if (session.messages.length) console.log(view.style(`Resumed history is preserved. Last provider: ${session.provider}. Next request uses current settings and sends this history to that destination.`, 'status'));
    terminal = new ChatInput(view.style('you> ', 'heading'), () => activeAbort?.abort());
    console.log(view.style(`\nStaf | session ${session.id}`, 'heading'));
    console.log(view.style(description, 'dim'));
    if (settings) console.log(view.context(settings.effective()));
    console.log(view.style('Commands: /settings  /auth  /usage  /context  /quit', 'dim') + '\n');
    if (envError || settingsError) console.log(view.style(redact(`Settings: ${envError || settingsError}`), 'error'));
    for (const message of session.messages) {
      if (['user', 'assistant'].includes(message.role) && message.content) console.log(`${view.style(`${message.role}>`, message.role === 'user' ? 'dim' : 'heading')} ${view.style(redact(message.content), 'dim')}`);
    }
    const command = async (words: string[]) => {
      if (words[0] === 'reload') {
        if (session.messages.length) throw new Error('Reload requires a new conversation after a completed turn');
        const nextFile = await loadEnvironment(resolve('.env'), {});
        const nextEnv = { ...nextFile, ...process.env };
        const nextStore = new SettingsStore(root, nextEnv);
        const nextSettings = await SettingsSession.begin(nextStore, { file: nextFile, shell: { ...process.env }, cli });
        file = nextFile; configuredStore = nextStore; settings = nextSettings; redact = redactor(nextEnv);
        envError = undefined; settingsError = undefined;
        return 'Settings reloaded. No model call.';
      }
      const text = await settingsCommand(configuredStore, settings, words, !!session.messages.length);
      return redact(text);
    };
    const signedIn = async () => { try { await loadDirectCredential(root); return true; } catch { return false; } };
    const authenticate = async (action: string) => {
      if (!['login', 'status', 'logout'].includes(action)) throw new Error('Use /auth codex login|status|logout');
      // Release readline/raw mode while the browser callback is pending. SIGINT
      // is handled by directAuth and ChatInput, cancelling login and exiting chat.
      if (action === 'login') terminal!.suspend();
      try {
        console.log(view.style(await directAuth(action, root, text => console.log(view.style(text, 'status'))), 'status'));
      } finally { if (action === 'login') terminal!.resume(); }
    };
    const menu = async (initial?: 'codex-setup' | 'codex-model'): Promise<boolean> => {
      while (true) {
        terminal!.suspend();
        let result;
        try {
          result = await openSettingsMenu({
            codexSignedIn: signedIn,
            preview: (key, value) => { if (!settings) throw new Error('Settings unavailable'); return settings.preview(key, value); },
            command, providers, effective: () => settings?.effective(),
            context: async (provider, scope) => { if (!settings) throw new Error('Settings unavailable. Use configuration path / recovery.'); return settings.modelContext(provider, scope); },
            models: async (provider, scope) => { if (!settings) throw new Error('Settings unavailable. Use configuration path / recovery.'); return settings.scopedModels(provider, scope); },
            redact: text => redact(text),
          }, view, initial);
        } finally { terminal!.resume(); }
        if (result.exit) return true;
        if (!result.signIn) return false;
        try { await authenticate('login'); }
        catch (error) { console.error(errorView.style(redact(`Staf: ${errorMessage(error)}. Retry with /auth codex login.`), 'error')); return false; }
        initial = 'codex-model';
      }
    };
    if (settings?.effective().provider.value === 'codex' && !envError && !await signedIn()) {
      if (canUseSettingsMenu()) { if (await menu('codex-setup')) return; }
      else console.log('Codex setup required: use /auth codex login, then /settings to choose a model.');
    }
    if (settings) console.log(view.style(contextFooter(contextStatus(session, settings.effective())), 'dim'));
    terminal.prompt();
    for await (const line of terminal) {
      if (line.trim() === '/quit') break;
      try {
        if (line.trim() === '/auth' || line.trim().startsWith('/auth ')) {
          const words = line.trim().split(/\s+/).slice(1);
          if (words.length !== 2 || words[0] !== 'codex') throw new Error('Use /auth codex login|status|logout');
          await authenticate(words[1]!);
        } else if (line.trim() === '/context' || line.trim().startsWith('/context ')) {
          const words = line.trim().split(/\s+/).slice(1);
          if (words.length > 1 || words[0] && !['refresh','help'].includes(words[0])) throw new Error('Use /context [refresh|help]');
          if (!settings) throw new Error('Settings unavailable; repair configuration first');
          if (words[0] === 'refresh') await settings.models(true);
          console.log(view.style(contextDetails(session, settings.effective()), 'status'));
        } else if (line.trim() === '/usage' || line.trim().startsWith('/usage ')) {
          const option = line.trim().split(/\s+/)[1];
          if (line.trim().split(/\s+/).length > 2 || option && !['help','details'].includes(option)) throw new Error('Use /usage [details|help]');
          console.log(view.style(option === 'help' ? usageHelp : usageText(session, option === 'details'), 'status'));
        } else if (line.trim() === '/settings' || line.trim().startsWith('/settings ')) {
          const words = line.trim().split(/\s+/).slice(1);
          if (!words.length && canUseSettingsMenu()) {
            if (await menu()) break;
            if (settings) console.log(view.context(settings.effective()));
          } else console.log(view.style(await command(words), 'status'));
        } else if (line.trim().startsWith('/')) {
          throw new Error('Unknown slash command. Use /settings, /auth or /quit.');
        } else if (line.trim()) {
          if (!settings || envError) throw new Error(envError || settingsError || 'Settings unavailable. Use /settings path.');
          const effective = settings.effective();
          const controller = new AbortController();
          activeAbort = controller;
          const options = adapterSettings(effective, { ...file, ...process.env });
          const selection = await selectProvider(effective.provider.value, { ...options, dataDir: root, sessionId: session.id });
          if (controller.signal.aborted) break;
          if (selection.provider.name !== lastAnnouncedProviderName) {
            console.log(view.style(`Provider: ${redact(selection.description)}`, 'context'));
            lastAnnouncedProviderName = selection.provider.name;
          }
          await runTurn({ session, store, provider: selection.provider, text: line, redact, signal: controller.signal, emit(event) {
            console.log(view.event(event));
          } });
        }
      } catch (error) {
        if (activeAbort?.signal.aborted) break;
        console.error(errorView.style(redact(`Staf: ${errorMessage(error)}. /settings is available without a model.`), 'error'));
      } finally { activeAbort = undefined; }
      if (settings) console.log(view.style(contextFooter(contextStatus(session, settings.effective())), 'dim'));
      terminal.prompt();
    }
  } finally { terminal?.close(); await release(); }
}
main().catch((error: unknown) => { console.error(cleanText(`Staf: ${errorMessage(error)}`)); process.exitCode = 1; });
