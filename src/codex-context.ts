import { mkdir, lstat, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { hasCode } from './validation.js';

export interface CodexContext { codexHome: string; userHome: string }

async function privateDirectory(path: string, restrictExisting = true): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Staf Codex context must use real directories, not symlinks');
  if (restrictExisting) await chmod(path, 0o700);
}

/** Prepare a new context without importing or inspecting any existing machine credentials. */
export async function createCodexContext(dataDir: string): Promise<CodexContext> {
  const root = resolve(dataDir);
  await privateDirectory(root, false);
  const context = join(root, 'codex-context');
  await privateDirectory(context);
  const codexHome = join(context, 'codex');
  const userHome = join(context, 'user');
  await privateDirectory(codexHome);
  await privateDirectory(userHome);
  // Staf does not accept custom config or symlinked auth in its isolated context.
  for (const name of ['config.toml', 'hooks.json', 'mcp.json', 'plugins']) {
    try { await lstat(join(codexHome, name)); }
    catch (error) { if (hasCode(error, 'ENOENT')) continue; throw error; }
    throw new Error('Staf Codex context contains unsupported custom configuration; use a clean --data-dir without copying auth');
  }
  for (const name of ['.agents', '.codex', '.config']) {
    try { await lstat(join(userHome, name)); }
    catch (error) { if (hasCode(error, 'ENOENT')) continue; throw error; }
    throw new Error('Staf Codex child HOME contains unsupported custom configuration');
  }
  try {
    const auth = await lstat(join(codexHome, 'auth.json'));
    if (auth.isSymbolicLink() || !auth.isFile()) throw new Error('Staf Codex auth.json must be a regular file, not a symlink');
    await chmod(join(codexHome, 'auth.json'), 0o600);
  } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
  return { codexHome, userHome };
}
