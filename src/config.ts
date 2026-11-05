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
function credentialValues(env: Environment): string[] {
  return [env.OPENROUTER_API_KEY, env.STAF_API_KEY, env.OPENAI_API_KEY, env.CODEX_API_KEY, env.LMSTUDIO_API_KEY]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}
/** Keep only an unfinished suffix that could still become a complete secret. */
export function possibleSecretSuffixLength(text: string, secrets: readonly string[]): number {
  let longest=0;
  for (const secret of secrets) {
    for (let length=Math.min(secret.length-1,text.length);length>longest;length--) {
      if (text[text.length-length]===secret[0] && text[text.length-1]===secret[length-1] && secret.startsWith(text.slice(-length))) {longest=length;break;}
    }
  }
  return longest;
}
export function streamingRedactor(env: Environment, additionalSecrets: () => readonly string[] = () => []): (text: string) => string {
  const redact=redactor(env);
  return text=>{
    const extra=additionalSecrets();
    const secrets=[...credentialValues(env),...extra].flatMap(value=>[value,JSON.stringify(value).slice(1,-1)]);
    const safe=extra.reduce((result,key)=>redactor({OPENROUTER_API_KEY:key})(result),redact(text));
    return safe.slice(0,safe.length-possibleSecretSuffixLength(safe,secrets));
  };
}
export type ByteRedactor = {write(data:Buffer):Buffer;finish():Buffer};
/** Preserve noncredential bytes, retaining unfinished secret prefixes between observations. */
export function byteStreamRedactor(env:Environment, additionalSecrets:()=>readonly string[]=()=>[]):ByteRedactor {
  let pending='',token=false;
  const consume=(data:Buffer,final:boolean):Buffer=>{
    let text=pending+data.toString('latin1');pending='';
    if(token){const end=text.search(/[^A-Za-z0-9_-]/);if(end<0){if(final)token=false;return Buffer.alloc(0);}text=text.slice(end);token=false;}
    const secrets=[...credentialValues(env),...additionalSecrets()].filter(value=>value.length>0)
      .flatMap(value=>[value,JSON.stringify(value).slice(1,-1)]).map(value=>Buffer.from(value,'utf8').toString('latin1'));
    for(const secret of secrets)text=text.split(secret).join('[REDACTED]');
    text=text.replace(/sk-or-v1-[A-Za-z0-9_-]+/g,(match:string,offset:number)=>{if(!final && offset+match.length===text.length)token=true;return '[REDACTED]';});
    const held=final?0:possibleSecretSuffixLength(text,[...secrets,'sk-or-v1-A']);
    pending=text.slice(text.length-held);
    return Buffer.from(text.slice(0,text.length-held),'latin1');
  };
  return {write:data=>consume(data,false),finish:()=>consume(Buffer.alloc(0),true)};
}
export function redactor(env: Environment): (text: string) => string {
  const secrets = credentialValues(env);
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
