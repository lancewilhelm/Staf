/** Saved presentation for tools. Missing legacy configuration means Direct. */
export type ToolMode = 'direct' | 'hybrid' | 'code';
export function parseToolMode(value: unknown): ToolMode {
  if (value === undefined) return 'direct';
  if (value === 'direct' || value === 'hybrid' || value === 'code') return value;
  throw Error('Invalid toolMode: expected direct, hybrid, or code');
}
