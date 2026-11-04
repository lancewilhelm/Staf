import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Memory, MemoryScope } from './memory-types.js';
export type { Memory, MemoryScope } from './memory-types.js';

export class MemoryConflict extends Error {}

export const memorySchema = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('user', 'bot')),
    bot_id TEXT REFERENCES bots(id),
    text TEXT NOT NULL CHECK (length(trim(text)) > 0 AND length(text) <= 4000),
    version INTEGER NOT NULL CHECK (version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((scope = 'user' AND bot_id IS NULL) OR (scope = 'bot' AND bot_id IS NOT NULL AND length(trim(bot_id)) > 0))
  );
  CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope, bot_id, created_at, id);
`;

function required(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}
function scopeParts(scope: MemoryScope): [string, string | null] {
  if (!scope || typeof scope !== 'object') throw new Error('Invalid memory scope');
  if (scope.kind === 'user' && Object.keys(scope).length === 1) return ['user', null];
  if (scope.kind === 'bot' && Object.keys(scope).length === 2) return ['bot', required(scope.botId, 'bot ID', 256)];
  throw new Error('Invalid memory scope');
}
function versionNumber(version: number): number {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid memory version');
  return version;
}
function fromRow(row: Record<string, unknown>): Memory {
  const { id, scope, bot_id: botId, text, version, created_at: createdAt, updated_at: updatedAt } = row;
  if (typeof id !== 'string' || typeof text !== 'string' || typeof version !== 'number' || typeof createdAt !== 'string' || typeof updatedAt !== 'string') throw new Error('Invalid stored memory');
  const memoryScope: MemoryScope = scope === 'user' && botId === null ? { kind: 'user' } : scope === 'bot' && typeof botId === 'string' && botId.trim() ? { kind: 'bot', botId } : (() => { throw new Error('Invalid stored memory scope'); })();
  return { id, scope: memoryScope, text, version, createdAt, updatedAt };
}

export class MemoryStore {
  constructor(private readonly db: DatabaseSync) {}

  create(input: { scope: MemoryScope; text: string }): Memory {
    const [scope, botId] = scopeParts(input.scope);
    const text = required(input.text, 'memory text', 4000);
    const id = randomUUID(), now = new Date().toISOString();
    this.db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?, 1, ?, ?)').run(id, scope, botId, text, now, now);
    return { id, scope: botId === null ? { kind: 'user' } : { kind: 'bot', botId }, text, version: 1, createdAt: now, updatedAt: now };
  }

  list(scope: MemoryScope): Memory[] {
    const [kind, botId] = scopeParts(scope);
    return this.db.prepare('SELECT * FROM memories WHERE scope = ? AND bot_id IS ? ORDER BY created_at, id').all(kind, botId).map(fromRow);
  }

  update(input: { id: string; scope: MemoryScope; version: number; text: string }): Memory {
    const [scope, botId] = scopeParts(input.scope);
    const id = required(input.id, 'memory ID', 256), text = required(input.text, 'memory text', 4000);
    const row = this.db.prepare('UPDATE memories SET text = ?, version = version + 1, updated_at = ? WHERE id = ? AND scope = ? AND bot_id IS ? AND version = ? RETURNING *').get(text, new Date().toISOString(), id, scope, botId, versionNumber(input.version));
    if (!row) throw new MemoryConflict('Memory changed or was not found');
    return fromRow(row);
  }

  delete(input: { id: string; scope: MemoryScope; version: number }): void {
    const [scope, botId] = scopeParts(input.scope);
    const result = this.db.prepare('DELETE FROM memories WHERE id = ? AND scope = ? AND bot_id IS ? AND version = ?').run(required(input.id, 'memory ID', 256), scope, botId, versionNumber(input.version));
    if (!result.changes) throw new MemoryConflict('Memory changed or was not found');
  }

  retrieve(input: { botId: string; query: string; limit: number }): Memory[] {
    const botId = required(input.botId, 'bot ID', 256);
    const query = required(input.query, 'query', 500);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) throw new Error('Invalid retrieval limit');
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, 12);
    if (!terms.length) return [];
    const ranked: Array<{ memory: Memory; score: number }> = [];
    const rows = this.db.prepare("SELECT * FROM memories WHERE scope = 'user' OR (scope = 'bot' AND bot_id = ?)").iterate(botId);
    for (const row of rows) {
      const memory = fromRow(row);
      const text = memory.text.toLowerCase();
      const score = terms.reduce((total, term) => total + Number(text.includes(term)), 0);
      if (!score) continue;
      ranked.push({ memory, score });
      ranked.sort((a, b) => b.score - a.score || (a.memory.createdAt < b.memory.createdAt ? -1 : a.memory.createdAt > b.memory.createdAt ? 1 : 0) || (a.memory.id < b.memory.id ? -1 : a.memory.id > b.memory.id ? 1 : 0));
      if (ranked.length > input.limit) ranked.pop();
    }
    return ranked.map(item => item.memory);
  }
}
