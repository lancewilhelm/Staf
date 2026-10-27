import type { EffectiveSettings } from './settings.js';
import type { RuntimeEvent } from './types.js';

/** Remove provider/user control sequences; only the renderer owns terminal formatting. */
export function cleanText(text: string): string {
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}
export class TerminalView {
  readonly color: boolean;
  constructor(readonly tty: boolean, env: Record<string, string | undefined> = process.env) {
    this.color = tty && env.TERM !== 'dumb' && !Object.hasOwn(env, 'NO_COLOR');
  }
  style(text: string, role: 'heading' | 'context' | 'status' | 'success' | 'error' | 'dim'): string {
    const codes = { heading: 36, context: 35, status: 33, success: 32, error: 31, dim: 2 };
    const clean = cleanText(text);
    return this.color ? `\x1b[${codes[role]}m${clean}\x1b[0m` : clean;
  }
  context(settings: EffectiveSettings): string {
    return this.style(`Provider: ${settings.provider.value} | Model: ${settings.model.value || '(provider default)'} | Reasoning: ${settings.reasoning.value}`, 'context');
  }
  event(event: RuntimeEvent): string {
    switch (event.type) {
      case 'assistant': return `\n${this.style('staf>', 'heading')} ${cleanText(event.text)}\n`;
      case 'provider_start': return this.style(`[provider_start] ${event.provider}`, 'dim');
      case 'tool_start': return this.style(`[tool_start] ${event.name}`, 'status');
      case 'tool_result': return this.style(`[tool_result] ${event.name} [${event.success ? 'ok' : 'failed'}]: ${event.content}`, event.success ? 'success' : 'error');
      case 'error': return this.style(`[error] ${event.message}`, 'error');
    }
  }
}
