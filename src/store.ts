import type { Session } from './types.js';
import { hasCode, validSession } from './validation.js';
import { mkdir, readFile, writeFile, rename, readdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// One versioned JSON snapshot per conversation; no provider credentials stored here.
export class Store {
  constructor(public readonly root: string) {}
  path(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid session ID');
    return join(this.root, `${id}.json`);
  }
  async create() {
    const session: Session = { version: 1, id: randomUUID(), provider: null, messages: [], events: [] };
    await this.save(session);
    return session;
  }
  async load(id: string): Promise<Session> {
    let session: unknown;
    try { session = JSON.parse(await readFile(this.path(id), 'utf8')); }
    catch (error) {
      if (hasCode(error, 'ENOENT')) throw new Error(`Session not found: ${id}`);
      if (error instanceof SyntaxError) throw new Error('Unsupported or damaged conversation');
      throw error;
    }
    if (!validSession(session, id)) throw new Error('Unsupported or damaged conversation');
    return session;
  }
  async save(session: Session): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = this.path(session.id);
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
      await rename(temp, target);
    } finally { await unlink(temp).catch(() => {}); }
  }
  async list(): Promise<string[]> {
    const names = await readdir(this.root).catch((error: unknown) => {
      if (hasCode(error, 'ENOENT')) return [];
      throw error;
    });
    return names.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();
  }
  // Fail rather than allow two CLI processes to overwrite a conversation.
  async lock(id: string): Promise<() => Promise<void>> {
    const path = `${this.path(id)}.lock`;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const handle = await open(path, 'wx', 0o600).catch((error: unknown) => {
      if (hasCode(error, 'EEXIST')) throw new Error(`Session in use (or stale lock): ${path}`);
      throw error;
    });
    return async () => { await handle.close(); await unlink(path); };
  }
}
