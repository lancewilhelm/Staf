import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { hasCode } from './validation.js';

const allowed = new Set(['OPENROUTER_API_KEY', 'STAF_API_KEY', 'STAF_MODEL', 'STAF_BASE_URL', 'STAF_CODEX_MODEL', 'LMSTUDIO_BASE_URL', 'LMSTUDIO_MODEL', 'LMSTUDIO_API_KEY', 'OPENROUTER_REASONING_EFFORT', 'STAF_CODEX_REASONING', 'LMSTUDIO_REASONING_EFFORT', 'STAF_REASONING_EFFORT']);
export type Environment = Record<string, string | undefined>;

/** Load literal project settings; never execute, expand, or replace shell values. */
export async function loadEnvironment(path: string, shell: Environment = process.env): Promise<Environment> {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if (hasCode(error, 'ENOENT')) return { ...shell };
    throw new Error('Cannot open project .env (symlinks are not allowed)');
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 65536) throw new Error('Project .env must be a regular file under 64 KiB');
    const values: Environment = {};
    for (const [index, raw] of (await file.readFile('utf8')).split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const match = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      const key = match?.[1];
      let value = match?.[2];
      if (!key || value === undefined) throw new Error(`Invalid .env assignment on line ${index + 1}`);
      if (!allowed.has(key)) continue;
      if (value.startsWith('"') || value.startsWith("'")) {
        if (value.at(-1) !== value[0] || value.length < 2) throw new Error(`Unclosed .env quote on line ${index + 1}`);
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
    return { ...values, ...shell };
  } finally { await file.close(); }
}

/** Redact known credential values before output or conversation persistence. */
export function redactor(env: Environment): (text: string) => string {
  const secrets = [env.OPENROUTER_API_KEY, env.STAF_API_KEY, env.OPENAI_API_KEY, env.CODEX_API_KEY, env.LMSTUDIO_API_KEY]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  return text => secrets.reduce((result, value) => result.split(value).join('[REDACTED]')
    .split(JSON.stringify(value).slice(1, -1)).join('[REDACTED]'), text)
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, '[REDACTED]');
}

/** Redact string values recursively without changing JSON structure or field names. */
export function redactValue(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((item: unknown) => redactValue(item, redact));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]: [string, unknown]) => [key, redactValue(item, redact)]));
  }
  return value;
}
