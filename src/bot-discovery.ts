export type BotDirectoryEntry = {
  id: string;
  name: string;
  description: string;
  availability: 'active' | 'busy' | 'archived';
};

type VisibleBot = Omit<BotDirectoryEntry, 'availability'> & { availability: 'active' | 'busy' };
export type BotDiscoveryResult =
  | { kind: 'no-match'; candidates: []; total: 0 }
  | { kind: 'match'; candidates: [VisibleBot]; total: 1 }
  | { kind: 'ambiguous'; candidates: VisibleBot[]; total: number };

export class BotDiscoveryError extends Error {}

function bounded(value: string, label: string, maximum: number, allowEmpty = false): void {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || Buffer.byteLength(value, 'utf8') > maximum) {
    throw new BotDiscoveryError(`Invalid ${label}`);
  }
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function words(value: string): string[] {
  return normalized(value).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Search owner-provided directory metadata only. This does not select or assign a helper. */
export function discoverBots(input: {
  requesterId: string;
  query: string;
  entries: readonly BotDirectoryEntry[];
  limit?: number;
}): BotDiscoveryResult {
  bounded(input.requesterId, 'requester ID', 256);
  bounded(input.query, 'query', 1024, true);
  if (!Array.isArray(input.entries) || input.entries.length > 1000) throw new BotDiscoveryError('Invalid entries');
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BotDiscoveryError('Invalid limit');
  const ids = new Set<string>();
  const terms = [...new Set(words(input.query))];
  const matches: { bot: VisibleBot; score: number }[] = [];
  for (const entry of input.entries) {
    if (!entry || typeof entry !== 'object') throw new BotDiscoveryError('Invalid entry');
    bounded(entry.id, 'bot ID', 256);
    bounded(entry.name, 'bot name', 512);
    bounded(entry.description, 'bot description', 4096, true);
    if (!['active', 'busy', 'archived'].includes(entry.availability)) throw new BotDiscoveryError('Invalid availability');
    if (ids.has(entry.id)) throw new BotDiscoveryError('Duplicate bot ID');
    ids.add(entry.id);
    if (entry.id === input.requesterId || entry.availability === 'archived') continue;
    const name = new Set(words(entry.name));
    const description = new Set(words(entry.description));
    if (!terms.every(term => name.has(term) || description.has(term))) continue;
    const score = terms.reduce((sum, term) => sum + (name.has(term) ? 2 : 0) + (description.has(term) ? 1 : 0), 0);
    // Copy only directory fields; never return unrelated properties on the input object.
    matches.push({ bot: { id: entry.id, name: entry.name, description: entry.description, availability: entry.availability }, score });
  }
  matches.sort((a, b) => b.score - a.score || compare(normalized(a.bot.name), normalized(b.bot.name)) || compare(a.bot.id, b.bot.id));
  const total = matches.length;
  const candidates = matches.slice(0, limit).map(match => match.bot);
  if (total === 0) return { kind: 'no-match', candidates: [], total: 0 };
  // An empty or punctuation-only query is never enough to identify a helper.
  if (total === 1 && terms.length > 0) {
    const candidate = candidates[0];
    if (candidate) return { kind: 'match', candidates: [candidate], total: 1 };
  }
  return { kind: 'ambiguous', candidates, total };
}
