import {providerLabel} from './provider-label.js';
import { emitKeypressEvents } from 'node:readline';
import { TerminalView, cleanText } from './terminal-view.js';
import { errorMessage } from './validation.js';

interface Choice { label: string; select(): void }
interface Screen { parent?: Screen; title: string; lines: string[]; choices: Choice[]; selected: number; edit?: { value: string; cursor: number; submit(value: string): void } }
export interface SharedSettingsOperations {
  show(): Promise<string[]>;
  set(key: 'provider' | 'model' | 'reasoning', value: string): Promise<string>;
  models(): Promise<string[]>;
  showDefaults(): Promise<string[]>;
  setDefault(key: 'provider' | 'model' | 'reasoning', value: string): Promise<string>;
}
export function canUseSettingsMenu(): boolean {
  return !!process.stdin.isTTY && !!process.stdout.isTTY && process.env.TERM !== 'dumb';
}

export async function openSettingsMenu(ops: SharedSettingsOperations, view: TerminalView): Promise<{ exit: boolean; signIn?: boolean }> {
  const input = process.stdin, output = process.stdout, wasRaw = !!input.isRaw;
  let closed = false, rows = 0, version = 0;
  let finish: (result: { exit: boolean; signIn?: boolean }) => void = () => {};
  const result = new Promise<{ exit: boolean; signIn?: boolean }>(resolve => { finish = resolve; });
  let current: Screen;
  const clip = (text: string) => { const width = Math.max(8, (output.columns || 80) - 1); const safe = cleanText(text).replace(/[^\x20-\x7e]/g, '?'); return safe.length > width ? safe.slice(0, width - 2) + '..' : safe; };
  function paint(): void {
    if (closed) return;
    if (rows) output.write(`\x1b[${rows}A\x1b[0J`);
    const limit = Math.max(1, (output.rows || 24) - 5 - current.lines.length), first = Math.max(0, current.selected - Math.floor(limit / 2));
    const lines = [clip(current.title), ...current.lines.map(clip)];
    if (current.edit) lines.push(clip(`Value: ${current.edit.value.slice(0, current.edit.cursor)}_${current.edit.value.slice(current.edit.cursor)}`));
    else lines.push(...current.choices.slice(first, first + limit).map((choice, i) => clip(`${first + i === current.selected ? '> ' : '  '}${choice.label}`)));
    lines.push(clip(current.edit ? 'Enter: review. Esc: back. Ctrl-U: clear.' : 'Arrows/hjkl: navigate. Enter: select. Esc: back.'), clip('Ctrl-C/D: exit chat. Changes require confirmation.'));
    output.write(lines.map((line, i) => i === 0 ? view.style(line, current.title === 'Settings error' ? 'error' : 'heading') : line.startsWith('> ') ? view.style(line, 'context') : line).join('\n') + '\n'); rows = lines.length;
  }
  function push(screen: Screen): void { screen.parent = current; current = screen; version++; paint(); }
  function back(): void { version++; if (current.parent) { current = current.parent; paint(); } else close(false); }
  function close(exit: boolean, signIn = false): void { if (!closed) { closed = true; finish({ exit, signIn }); } }
  function message(title: string, lines: string[]): void { push({ title, lines: [], choices: [...lines.map(label => ({ label, select: () => {} })), { label: 'Back', select: back }], selected: 0 }); }
  function run(work: (current: () => boolean) => Promise<void>): void { const token = ++version; const active = () => !closed && token === version; work(active).catch(error => { if (active()) message('Settings error', [errorMessage(error)]); }); }
  function confirm(key: 'provider' | 'model' | 'reasoning', value: string, defaults = false): void {
    const label = key === 'provider' ? providerLabel(value) : value || '(provider default)';
    push({ title: 'Confirm setting', lines: defaults ? [`${key}: ${label}`, 'Applies only to bots created later.'] : key === 'provider' ? [`${key}: ${label}`, 'Next request may send this chat', 'history to this provider.'] : [`${key}: ${label}`, 'Applies to this shared bot for new work.'], selected: 1, choices: [
      { label: 'Apply setting', select: () => run(async active => { const text = await (defaults ? ops.setDefault(key, value) : ops.set(key, value)); if (active()) message('Setting applied', [text]); }) },
      { label: 'Cancel', select: back },
    ] });
  }
  function editor(key: 'model' | 'reasoning', defaults = false): void { push({ title: `Enter ${key}`, lines: ['Empty value uses the provider default.'], choices: [], selected: 0, edit: { value: '', cursor: 0, submit: value => confirm(key, value, defaults) } }); }
  current = { title: 'Staf settings', lines: ['Settings belong to this shared bot.', 'New bot defaults are managed separately.'], selected: 0, choices: [
    { label: 'Show bot settings', select: () => run(async active => { const lines = await ops.show(); if (active()) message('Bot settings', lines); }) },
    { label: 'Provider', select: () => push({ title: 'Provider', lines: ['Endpoints and credentials are configured on the host.'], selected: 0, choices: ['codex', 'openrouter', 'lmstudio', 'live'].map(value => ({ label: providerLabel(value), select: () => confirm('provider', value) })) }) },
    { label: 'Model', select: () => push({ title: 'Model', lines: [], selected: 0, choices: [
      { label: 'Enter model ID', select: () => editor('model') },
      { label: 'Discover model IDs (metadata request)', select: () => run(async active => { const models = await ops.models(); if (active()) push({ title: 'Models', lines: [], selected: 0, choices: [...models.map(value => ({ label: value, select: () => confirm('model', value) })), { label: 'Back', select: back }] }); }) },
      { label: 'Back', select: back },
    ] }) },
    { label: 'Reasoning', select: () => editor('reasoning') },
    { label: 'New bot defaults', select: () => push({ title: 'New bot defaults', lines: ['Only bots created later use these values.'], selected: 0, choices: [
      { label: 'Show defaults', select: () => run(async active => { const lines = await ops.showDefaults(); if (active()) message('New bot defaults', lines); }) },
      { label: 'Provider', select: () => push({ title: 'Default provider', lines: ['Existing bots keep their settings.'], selected: 0, choices: ['codex', 'openrouter', 'lmstudio', 'live'].map(value => ({ label: providerLabel(value), select: () => confirm('provider', value, true) })) }) },
      { label: 'Model', select: () => editor('model', true) },
      { label: 'Reasoning', select: () => editor('reasoning', true) },
      { label: 'Back', select: back },
    ] }) },
    { label: 'Host endpoint configuration', select: () => message('Host endpoints', ['Set LMSTUDIO_BASE_URL for LM Studio.', 'Set STAF_BASE_URL for live.', 'Configure on the instance host and restart it.']) },
    { label: 'ChatGPT sign-in', select: () => close(false, true) },
    { label: 'Close settings', select: () => close(false) },
  ] };
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
  const end = () => close(true), resize = () => paint();
  try { emitKeypressEvents(input); input.setRawMode(true); input.resume(); input.on('keypress', keypress); input.on('end', end); output.on('resize', resize); output.write('\x1b[?25l'); paint(); return await result; }
  finally { closed = true; input.off('keypress', keypress); input.off('end', end); output.off('resize', resize); input.setRawMode(wasRaw); input.pause(); output.write('\x1b[?25h\n'); }
}
