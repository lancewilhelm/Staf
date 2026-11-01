import type { Memory, MemoryScope } from './memory.js';

export type MemoryCandidate = Readonly<{
  id: string;
  version: number;
  scope: MemoryScope;
  text: string;
}>;

export type MemoryCandidatePreview = Readonly<{
  candidates: readonly MemoryCandidate[];
  truncated: boolean;
}>;

/**
 * Search already-authorized entries using literal, case-insensitive text.
 * This is a preview, not a target selection or authorization to change memory.
 * The caller must resolve scope and reject unresolved exclusions before calling.
 */
export function previewMemoryCandidates(input: Readonly<{
  botId: string;
  query: string;
  entries: readonly Memory[];
  limit: number;
}>): MemoryCandidatePreview {
  if (!input || typeof input !== 'object' ||
      Object.keys(input).sort().join(',') !== 'botId,entries,limit,query' ||
      typeof input.botId !== 'string' || !/^[\w-]{1,256}$/.test(input.botId) ||
      typeof input.query !== 'string' || !input.query.trim() || input.query.length > 256 ||
      !Array.isArray(input.entries) || input.entries.length > 10_000 ||
      !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 20) {
    throw new Error('Invalid memory candidate request');
  }
  const candidates: MemoryCandidate[] = [];
  const seen = new Set<string>();
  let truncated = false;
  const query = input.query.toLowerCase();
  for (const entry of input.entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' ||
        !/^[\w-]{1,256}$/.test(entry.id) || seen.has(entry.id) ||
        !Number.isSafeInteger(entry.version) || entry.version < 1 ||
        typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 4000 ||
        !entry.scope || typeof entry.scope !== 'object') {
      throw new Error('Invalid memory candidate entry');
    }
    seen.add(entry.id);
    let scope: MemoryScope;
    if (entry.scope.kind === 'user' && Object.keys(entry.scope).length === 1) scope = { kind: 'user' };
    else if (entry.scope.kind === 'bot' && Object.keys(entry.scope).length === 2 && entry.scope.botId === input.botId) {
      scope = { kind: 'bot', botId: input.botId };
    } else throw new Error('Memory candidate is outside the addressed bot or shared scope');
    if (entry.text.toLowerCase().includes(query)) {
      if (candidates.length < input.limit) candidates.push({ id: entry.id, version: entry.version, scope, text: entry.text });
      else truncated = true;
    }
  }
  return { candidates, truncated };
}
