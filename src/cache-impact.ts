import type {ToolMode} from './tool-mode.js';

type RequestSettings = {provider:string; model:string|null; reasoning:string|null; instructions:string; toolMode:ToolMode};

/** Whether the saved settings can alter a provider request for an existing chat. */
export function profileAffectsCache(before:RequestSettings, after:RequestSettings):boolean {
  if (before.provider !== after.provider) return true;
  if (after.provider === 'demo') return false;
  if (before.instructions !== after.instructions || before.toolMode !== after.toolMode) return true;
  if (after.provider !== 'live' && before.model !== after.model) return true;
  return (after.provider === 'codex' || after.provider === 'openrouter') && (before.reasoning || 'default') !== (after.reasoning || 'default');
}
