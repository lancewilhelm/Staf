import { isRecord } from './validation.js';
import { emitKeypressEvents } from 'node:readline';
import type { EffectiveSettings } from './settings.js';
import type { ModelCatalog } from './models.js';
import { TerminalView, cleanText } from './terminal-view.js';
import { errorMessage } from './validation.js';

type Scope = 'session' | 'default';
interface Choice { label: string; select(): void }
interface Screen { parent?: Screen; title: string; lines: string[]; choices: Choice[]; selected: number; edit?: { value: string; cursor: number; submit(value: string): void } }
export interface SettingsMenuOperations {
  codexSignedIn(): Promise<boolean>;
  preview(key: string, value: string): string[];
  command(args: string[]): Promise<string>;
  effective(): EffectiveSettings | undefined;
  context(provider: string, scope: Scope): Promise<EffectiveSettings>;
  models(provider: string, scope: Scope): Promise<ModelCatalog>;
  providers: string[];
  redact(text: string): string;
}
export function canUseSettingsMenu(): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY && process.env.TERM !== 'dumb';
}

/** Terminal-only navigation. All settings validation and writes use supplied domain operations. */
export async function openSettingsMenu(ops: SettingsMenuOperations, view: TerminalView, initial?: 'codex-setup' | 'codex-model'): Promise<{ exit: boolean; signIn?: boolean }> {
  const input = process.stdin, output = process.stdout;
  const wasRaw = !!input.isRaw;
  let closed = false, rows = 0, request = 0;
  let current: Screen;
  let home: Screen;
  let finish: (result: { exit: boolean; signIn?: boolean }) => void = () => {};
  const result = new Promise<{ exit: boolean; signIn?: boolean }>(resolve => { finish = resolve; });
  const width = () => Math.max(8, (output.columns || 80) - 1);
  function clip(text: string): string { const clean = cleanText(ops.redact(text)).replace(/[^\x20-\x7e]/g, '?'); return clean.length > width() ? clean.slice(0, Math.max(0, width() - 2)) + '..' : clean; }
  function paint(): void {
    if (closed) return;
    if (rows) output.write(`\x1b[${rows}A\x1b[0J`);
    const limit = Math.max(1, (output.rows || 24) - 7);
    const first = Math.max(0, current.selected - Math.floor(limit / 2));
    const items = current.choices.slice(first, first + limit);
    const lines = [clip(current.title), ...current.lines.slice(0, 2).map(clip)];
    if (current.edit) lines.push(clip(`Value: ${current.edit.value.slice(0, current.edit.cursor)}_${current.edit.value.slice(current.edit.cursor)}`));
    else lines.push(...items.map((choice, index) => clip(`${first + index === current.selected ? '> ' : '  '}${choice.label}`)));
    lines.push(clip(current.edit ? 'Type freely. Enter: review; Esc: back; Ctrl-C/D: exit' : 'Arrows/hjkl: move/select/back. Enter: select. Esc: back/close'), clip(current.edit ? 'Left/right: cursor. Ctrl-U: clear. No save until confirmed.' : 'No change until confirmation. Ctrl-C/D: exit chat.'));
    output.write(lines.map((line, i) => i === 0 ? view.style(line, current.title === 'Settings error' ? 'error' : current.title === 'Setting applied' ? 'success' : 'heading') : line.startsWith('> ') ? view.style(line, 'context') : line).join('\n') + '\n'); rows = lines.length;
  }
  function push(screen: Screen): void { screen.parent = current; current = screen; request++; paint(); }
  function replace(screen: Screen): void { screen.parent = current.parent; current = screen; request++; paint(); }
  function back(): void { request++; const previous = current.parent; if (previous) { current = previous; paint(); } else close(false); }
  function close(exit: boolean, signIn = false): void { if (closed) return; closed = true; finish({ exit, signIn }); }
  function message(title: string, text: string): void { push({ title, lines: text.split('\n'), choices: [{ label: 'Back', select: back }], selected: 0 }); }
  function codexSetup(): void {
    push({ title: 'Codex setup', lines: ['Sign in to ChatGPT to authorize Staf in your browser.', 'After sign-in, choose an account-available model.'], selected: 0, choices: [
      { label: 'Sign in with ChatGPT', select: () => close(false, true) },
      { label: 'Choose model without signing in', select: () => choose('model', 'session', 'codex') },
      { label: 'Back', select: back },
    ] });
  }
  function pending(title: string, work: () => Promise<void>): void {
    push({ title, lines: ['Reading metadata/settings; no generation.', 'Esc returns now; an outstanding read may finish later.'], choices: [{ label: 'Back', select: back }], selected: 0 });
    const token = request;
    work().catch(error => { if (!closed && token === request) replace({ title: 'Settings error', lines: [errorMessage(error)], choices: [{ label: 'Back', select: back }], selected: 0 }); });
  }
  function confirm(args: string[]): void {
    const scope = args[1] === 'default' ? 'now + my default' : 'next request, this session only';
    let notes: string[];
    try { notes = ops.preview(args[2] || '', args.slice(3).join(' ')); }
    catch (error) { message('Settings error', errorMessage(error)); return; }
    push({ title: 'Confirm setting', lines: [args.slice(2).join(' = '), `Scope: ${scope}`], selected: 1, choices: [
      { label: 'Apply setting', select: () => {
        const token = ++request;
        current.lines = ['Applying the confirmed change...']; current.choices = [{ label: 'Applying...', select: () => {} }]; current.selected = 0; paint();
        ops.command(args).then(async text => {
          const needsLogin = ops.effective()?.provider.value === 'codex' && !await ops.codexSignedIn();
          if (!closed && token === request) { home.selected = 0; current = home; if (needsLogin) codexSetup(); else message('Setting applied', text); }
        }).catch(error => { if (!closed && token === request) { current = { parent: current.parent, title: 'Settings error', lines: [errorMessage(error)], selected: 0, choices: [{ label: 'Back to value', select: back }] }; paint(); } });
      } }, { label: 'Cancel; return without saving', select: back },
      ...notes.map(note => ({ label: `Warning: ${note}`, select: () => {} })),
    ] });
  }
  function editor(title: string, value: string, key: string, scope: Scope): void {
    push({ title, lines: ['Edit a nonsecret value. hjkl are ordinary letters here.'], choices: [], selected: 0,
      edit: { value, cursor: value.length, submit: value => confirm(['set', scope, key, value]) } });
  }
  function scopeFor(kind: 'provider' | 'model' | 'reasoning' | 'endpoint'): void {
    push({ title: `Choose scope: ${kind}`, lines: [], selected: 0, choices: [
      { label: 'This session (next request)', select: () => target(kind, 'session') },
      { label: 'Remember as my default (also apply now)', select: () => target(kind, 'default') },
      { label: 'Back', select: back },
    ] });
  }
  function target(kind: 'provider' | 'model' | 'reasoning' | 'endpoint', scope: Scope): void {
    if (kind === 'provider') { push({ title: `Provider: ${scope}`, lines: [], selected: 0, choices: ops.providers.map(provider => ({ label: provider, select: () => confirm(['set', scope, 'provider', provider]) })) }); return; }
    const providers = scope === 'session' ? [ops.effective()?.provider.value || 'demo'] : ops.providers.filter(provider => provider !== 'demo');
    push({ title: `Target provider: ${kind}`, lines: [`Scope: ${scope}`], selected: 0, choices: providers.map(provider => ({ label: provider, select: () => choose(kind, scope, provider) })) });
  }
  function choose(kind: 'model' | 'reasoning' | 'endpoint', scope: Scope, provider: string): void {
    const token = ++request;
    ops.context(provider, scope).then(context => {
      if (closed || token !== request) return;
      if (provider === 'demo') { message('No model settings', 'Demo has no model or reasoning control. Choose a provider first.'); return; }
      const key = `${kind}.${provider}`;
      if (kind === 'endpoint') { if (!['lmstudio', 'live'].includes(provider)) { message('Fixed endpoint', 'This adapter has no configurable API root.'); return; } editor('API root (no credentials)', context.endpoint.value, key, scope); return; }
      if (kind === 'model') {
        push({ title: `Model: ${provider}`, lines: [`Current: ${context.model.value || '(not set)'} [${context.model.source}]`], selected: 0, choices: [
          { label: 'Discover model IDs (metadata only)', select: () => {
            const version = request + 1;
            pending('Model catalog', async () => { const catalog = await ops.models(provider, scope); if (closed || request !== version) return;
              replace({ title: `Models: ${provider}`, lines: [catalog.source, catalog.cached ? 'Cached metadata' : 'Fresh metadata'], selected: 0, choices: [...catalog.models.map(model => ({ label: model.id, select: () => confirm(['set', scope, key, model.id]) })), { label: 'Back / manual entry', select: back }] });
            });
          } },
          { label: 'Enter model ID manually', select: () => editor('Model ID', context.model.value, key, scope) }, { label: 'Back', select: back },
        ] }); return;
      }
      push({ title: `Reasoning: ${provider}`, lines: [`Model: ${context.model.value || '(not set)'}`, 'Provider default does not mean reasoning off.'], selected: 0, choices: [
        { label: 'Provider default (omit override)', select: () => confirm(['set', scope, key, 'default']) },
        { label: 'Discover supported efforts', select: () => {
          const version = request + 1;
          pending('Reasoning metadata', async () => { const catalog = await ops.models(provider, scope); if (closed || request !== version) return;
            const model = catalog.models.find(model => model.id === context.model.value);
            const efforts = model?.reasoning || [];
            replace({ title: `Efforts: ${provider}`, lines: [model?.reasoningStatus || 'unknown', efforts.length ? catalog.source : 'No advertised efforts. Use provider default.'], selected: 0, choices: [...efforts.map(effort => ({ label: effort, select: () => confirm(['set', scope, key, effort]) })), { label: 'Back', select: back }] });
          });
        } }, { label: 'Back', select: back },
      ] });
    }).catch(error => { if (!closed && token === request) message('Settings error', errorMessage(error)); });
  }
  current = { title: 'Staf settings', lines: ['Changes apply to next request. Remembered defaults also apply on future launches.'], selected: 0, choices: [
    { label: 'Effective values and sources', select: () => { const token = ++request; ops.command(['show']).then(text => { if (!closed && token === request) {
      const parsed: unknown = JSON.parse(text);
      const effective = ops.effective();
      const detail = effective ? ['Active settings',
        ...(['provider', 'model', 'reasoning', 'endpoint'] as const).map(key => `${key}: ${effective[key].value || '(provider default)'} [${effective[key].source}]`),
        ...effective.warnings] : ['Settings unavailable'];
      if (isRecord(parsed) && isRecord(parsed.savedDefaults)) detail.push('My saved defaults (future launches)', ...Object.entries(parsed.savedDefaults).map(([key, value]) => `${key}: ${String(value)}`));
      push({ title: 'Effective values and sources', lines: [], selected: 0, choices: [...detail.map(line => ({ label: line, select: () => {} })), { label: 'Back', select: back }] });
    } }).catch(error => { if (!closed && token === request) message('Settings error', errorMessage(error)); }); } },
    { label: 'Provider', select: () => scopeFor('provider') }, { label: 'Model', select: () => scopeFor('model') },
    { label: 'Reasoning', select: () => scopeFor('reasoning') }, { label: 'API endpoint', select: () => scopeFor('endpoint') },
    { label: 'Reload configuration (before completed turn)', select: () => { const token = ++request; ops.command(['reload']).then(text => { if (!closed && token === request) message('Reloaded', text); }).catch(error => { if (!closed && token === request) message('Settings error', errorMessage(error)); }); } },
    { label: 'Configuration path / recovery', select: () => { const token = ++request; ops.command(['path']).then(text => { if (!closed && token === request) message('Configuration path', text); }); } },
    { label: 'Codex sign-in / reconnect', select: codexSetup },
    { label: 'Close settings', select: () => close(false) },
  ] };
  home = current;
  if (initial === 'codex-setup') codexSetup();
  else if (initial === 'codex-model') choose('model', 'session', 'codex');
  function keypress(text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }): void {
    if (closed) return;
    if (key.ctrl && ['c', 'd'].includes(key.name || '')) { close(true); return; }
    if (key.name === 'escape') { back(); return; }
    const edit = current.edit;
    if (edit) {
      if (key.name === 'return' || key.name === 'enter') { edit.submit(edit.value); return; }
      if (key.name === 'left') edit.cursor = Math.max(0, edit.cursor - 1);
      else if (key.name === 'right') edit.cursor = Math.min(edit.value.length, edit.cursor + 1);
      else if (key.ctrl && key.name === 'u') { edit.value = ''; edit.cursor = 0; }
      else if (key.name === 'backspace') { if (edit.cursor) { edit.value = edit.value.slice(0, edit.cursor - 1) + edit.value.slice(edit.cursor); edit.cursor--; } }
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) { edit.value = edit.value.slice(0, edit.cursor) + text + edit.value.slice(edit.cursor); edit.cursor += text.length; }
      paint(); return;
    }
    if (['up', 'k'].includes(key.name || '')) current.selected = (current.selected - 1 + current.choices.length) % current.choices.length;
    else if (['down', 'j'].includes(key.name || '')) current.selected = (current.selected + 1) % current.choices.length;
    else if (['left', 'h'].includes(key.name || '')) { back(); return; }
    else if (['right', 'l', 'return', 'enter'].includes(key.name || '')) { current.choices[current.selected]?.select(); return; }
    paint();
  }
  function end(): void { close(true); }
  const resize = () => paint();
  try {
    emitKeypressEvents(input); input.setRawMode(true); input.resume();
    input.on('keypress', keypress); input.on('end', end); output.on('resize', resize);
    output.write('\x1b[?25l'); paint();
    return await result;
  } finally {
    closed = true; input.off('keypress', keypress); input.off('end', end); output.off('resize', resize);
    input.setRawMode(wasRaw); input.pause(); output.write('\x1b[?25h\n');
  }
}
