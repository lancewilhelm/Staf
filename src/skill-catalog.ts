import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const skillCatalogSchema = `
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, current_revision INTEGER NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS skill_revisions (
  skill_id TEXT NOT NULL REFERENCES skills(id), revision INTEGER NOT NULL,
  name TEXT NOT NULL, description TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL,
  provenance TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(skill_id, revision)
);
CREATE TABLE IF NOT EXISTS skill_bot_availability (
  skill_id TEXT NOT NULL REFERENCES skills(id), bot_id TEXT NOT NULL REFERENCES bots(id),
  PRIMARY KEY(skill_id, bot_id)
);
`;

export class SkillConflict extends Error {}
export type SkillRevision = { id: string; revision: number; name: string; description: string; body: string; digest: string; provenance: string; createdAt: string; enabled: boolean };
type ImportInput = { name: string; description: string; bytes: Uint8Array; provenance: string };
const MAX_BYTES = 256 * 1024;
function field(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid ${label}`);
  return value.trim();
}
function parse(input: ImportInput, redact: (text: string) => string) {
  if (!input || typeof input !== 'object' || !(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_BYTES) throw new Error('Invalid skill bytes');
  const name = field(input.name, 'skill name', 100);
  const description = field(input.description, 'skill description', 500);
  const provenance = field(input.provenance, 'provenance label', 200);
  let body: string;
  try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input.bytes); } catch { throw new Error('Invalid UTF-8'); }
  if (!body.trim() || body.includes('\0')) throw new Error('Invalid skill body');
  const digest = createHash('sha256').update(input.bytes).digest('hex');
  return { name: redact(name), description: redact(description), provenance: redact(provenance), body: redact(body), digest };
}
function idField(id: unknown, label: string): string { return field(id, label, 256); }
function rev(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid revision');
  return value;
}
function fromRow(row: Record<string, unknown>): SkillRevision {
  const { id, revision, name, description, body, digest, provenance, created_at: createdAt, enabled } = row;
  if (typeof id !== 'string' || typeof revision !== 'number' || typeof name !== 'string' || typeof description !== 'string' || typeof body !== 'string' || typeof digest !== 'string' || typeof provenance !== 'string' || typeof createdAt !== 'string' || (enabled !== 0 && enabled !== 1)) throw new Error('Invalid stored skill');
  return { id, revision, name, description, body, digest, provenance, createdAt, enabled: enabled === 1 };
}

export class SkillCatalog {
  constructor(private readonly db: DatabaseSync, private readonly redact: (text: string) => string = text => text) {}
  private safe(row: Record<string, unknown>): SkillRevision {
    const item = fromRow(row);
    return { ...item, name: this.redact(item.name), description: this.redact(item.description), body: this.redact(item.body), provenance: this.redact(item.provenance) };
  }
  private atomic<T>(run: () => T): T {
    this.db.exec('SAVEPOINT skill_catalog');
    try { const result = run(); this.db.exec('RELEASE skill_catalog'); return result; }
    catch (error) { this.db.exec('ROLLBACK TO skill_catalog; RELEASE skill_catalog'); throw error; }
  }
  import(input: ImportInput): SkillRevision {
    const data = parse(input, this.redact), id = randomUUID(), createdAt = new Date().toISOString();
    return this.atomic(() => {
      this.db.prepare('INSERT INTO skills VALUES (?, ?, 1, 1)').run(id, data.name.toLowerCase());
      this.db.prepare('INSERT INTO skill_revisions VALUES (?, 1, ?, ?, ?, ?, ?, ?)').run(id, data.name, data.description, data.body, data.digest, data.provenance, createdAt);
      return { id, revision: 1, ...data, createdAt, enabled: true };
    });
  }
  update(input: ImportInput & { id: string; expectedRevision: number }): SkillRevision {
    const data = parse(input, this.redact), id = idField(input.id, 'skill ID'), expected = rev(input.expectedRevision), createdAt = new Date().toISOString();
    return this.atomic(() => {
      const changed = this.db.prepare('UPDATE skills SET current_revision = current_revision + 1, name_key = ? WHERE id = ? AND current_revision = ? RETURNING enabled').get(data.name.toLowerCase(), id, expected);
      if (!changed) throw new SkillConflict('Skill changed or was not found');
      this.db.prepare('INSERT INTO skill_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, expected + 1, data.name, data.description, data.body, data.digest, data.provenance, createdAt);
      return { id, revision: expected + 1, ...data, createdAt, enabled: changed.enabled === 1 };
    });
  }
  inspect(input: { id: string; revision?: number }): SkillRevision | undefined {
    const id = idField(input.id, 'skill ID');
    const revision = input.revision === undefined ? null : rev(input.revision);
    const row = this.db.prepare('SELECT s.id, s.enabled, r.* FROM skills s JOIN skill_revisions r ON r.skill_id = s.id AND r.revision = COALESCE(?, s.current_revision) WHERE s.id = ?').get(revision, id);
    return row ? this.safe(row) : undefined;
  }
  list(): SkillRevision[] {
    return this.db.prepare('SELECT s.id, s.enabled, r.* FROM skills s JOIN skill_revisions r ON r.skill_id = s.id AND r.revision = s.current_revision ORDER BY r.name, s.id').all().map(row => this.safe(row));
  }
  setEnabled(input: { id: string; enabled: boolean }): void {
    if (typeof input.enabled !== 'boolean') throw new Error('Invalid enabled state');
    if (!this.db.prepare('UPDATE skills SET enabled = ? WHERE id = ?').run(Number(input.enabled), idField(input.id, 'skill ID')).changes) throw new SkillConflict('Skill not found');
  }
  setBotAvailability(input: { id: string; botId: string; available: boolean }): void {
    if (typeof input.available !== 'boolean') throw new Error('Invalid availability');
    const id = idField(input.id, 'skill ID'), botId = idField(input.botId, 'bot ID');
    if (input.available) this.db.prepare('INSERT OR IGNORE INTO skill_bot_availability VALUES (?, ?)').run(id, botId);
    else this.db.prepare('DELETE FROM skill_bot_availability WHERE skill_id = ? AND bot_id = ?').run(id, botId);
  }
  availableToBot(botId: string): SkillRevision[] {
    return this.db.prepare('SELECT s.id, s.enabled, r.* FROM skills s JOIN skill_revisions r ON r.skill_id = s.id AND r.revision = s.current_revision JOIN skill_bot_availability a ON a.skill_id = s.id WHERE s.enabled = 1 AND a.bot_id = ? ORDER BY r.name, s.id').all(idField(botId, 'bot ID')).map(row => this.safe(row));
  }
}
