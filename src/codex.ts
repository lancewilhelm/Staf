import { codexPrompt, codexResponseSchema } from './prompts.js';
import { codexUsage } from './usage.js';
import { validateEffort } from './models.js';
import type { CodexContext } from './codex-context.js';
import { createCodexContext } from './codex-context.js';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Provider } from './types.js';
import { isRecord, isArray } from './validation.js';

export type CodexRunner = (args: string[], input?: string, interactive?: boolean) => Promise<string>;

/** Execute the official CLI without a shell; suppress raw stderr and credential env. */
export function createCodexRunner(context: CodexContext): CodexRunner {
return (args, input = '', interactive = false) => new Promise((resolve, reject) => {
  const env: NodeJS.ProcessEnv = {};
  // Preserve executable lookup and official login location, not application secrets.
  for (const key of ['PATH', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'SystemRoot', 'WINDIR']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.HOME = context.userHome;
  env.CODEX_HOME = context.codexHome;
  const common = ['-c', 'cli_auth_credentials_store="file"', '-c', 'forced_login_method="chatgpt"',
    '--disable', 'apps', '--disable', 'hooks', '--disable', 'plugins', '--disable', 'remote_plugin'];
  const directoryIndex = args.indexOf('--cd');
  const cwd = directoryIndex >= 0 ? args[directoryIndex + 1] : tmpdir();
  const child = spawn('codex', [...args, ...common], { env, cwd, stdio: interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let failure: Error | undefined;
  const timer = setTimeout(() => { failure = new Error('Codex timed out'); child.kill('SIGKILL'); }, interactive ? 600000 : 120000);
  child.stdout?.on('data', (data: Buffer) => {
    output += data.toString();
    if (output.length > 4 * 1024 * 1024) { failure = new Error('Codex output exceeded limit'); child.kill('SIGKILL'); }
  });
  // Login status may be written to stderr; capture only that bounded supported status.
  child.stderr?.on('data', (data: Buffer) => {
    if (args[0] === 'login' && output.length < 65536) output += data.toString();
  });
  child.stdin?.on('error', () => {});
  child.on('error', () => { clearTimeout(timer); reject(new Error('Cannot start Codex; install the official CLI and ensure codex is on PATH')); });
  child.on('close', code => {
    clearTimeout(timer);
    if (failure) reject(failure);
    else if (code !== 0) reject(new Error(args[0] === 'login' ? 'Staf Codex is not signed in; run pnpm start auth codex login' : 'Staf Codex command failed; check pnpm start auth codex status, CLI version, model access and subscription limits'));
    else resolve(output);
  });
  child.stdin?.end(input);
});
}

/** Use structured CLI output as a chat planner; Staf owns its tool execution/history. */
export async function codexProvider(model: string | undefined, run: CodexRunner, effort?: string): Promise<Provider> {
  validateEffort('codex', effort || 'default');
  const status = await run(['login', 'status']);
  if (!/Logged in using ChatGPT/i.test(status)) throw new Error('Staf Codex requires ChatGPT sign-in; run pnpm start auth codex login. Existing machine login is not borrowed');
  const checkMcp = async () => {
    let mcp: unknown;
    try { mcp = JSON.parse(await run(['mcp', 'list', '--json'])); }
    catch { throw new Error('Staf Codex MCP preflight failed; no generation started'); }
    if (!isArray(mcp) || mcp.length) throw new Error('Staf Codex refuses configured MCP servers; isolated context or system policy requires review');
  };
  await checkMcp();
  return {
    capabilities: { toolCalls: true, incrementalText: false, transport: 'codex-cli-planner' },
    name: `codex:${model || 'default'}${effort && effort !== 'default' ? `:reasoning=${effort}` : ''}`,
    async complete(messages, tools) {
      await checkMcp();
      const dir = await mkdtemp(join(tmpdir(), 'staf-codex-'));
      try {
        const schema = join(dir, 'response-schema.json');
        const output = join(dir, 'response.json');
        await writeFile(schema, JSON.stringify(codexResponseSchema), { mode: 0o600 });
        const args = ['exec', '--json', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
          '--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'unified_exec',
          '-c', 'web_search="disabled"', '-c', 'approval_policy="never"', '--cd', dir,
          '--output-schema', schema, '--output-last-message', output];
        if (model) args.push('--model', model);
        if (effort && effort !== 'default') args.push('-c', `model_reasoning_effort=${JSON.stringify(effort)}`);
        args.push('-');
        const jsonl = await run(args, codexPrompt(messages, tools));
        const usage = codexUsage(jsonl);
        const result: unknown = JSON.parse(await readFile(output, 'utf8'));
        if (!isRecord(result) || typeof result.text !== 'string') throw new Error('Invalid Codex structured response');
        if (result.kind === 'text') return { role: 'assistant', content: result.text, usage };
        if (result.kind === 'clock') return { role: 'assistant', content: null, usage, tool_calls: [{ id: randomUUID(), type: 'function', function: { name: 'clock', arguments: '{}' } }] };
        throw new Error('Invalid Codex response kind');
      } finally { await rm(dir, { recursive: true, force: true }); }
    },
  };
}

/** User-invoked authentication only. No automatic login, migration, or token copy. */
export async function codexAuth(action: string, dataDir: string, suppliedRun?: CodexRunner): Promise<string> {
  if (!['login', 'status', 'logout'].includes(action)) throw new Error('Use auth codex login, status or logout');
  const context = await createCodexContext(dataDir);
  const run = suppliedRun || createCodexRunner(context);
  if (action === 'login') {
    await run(['login'], undefined, true);
    // Revalidate metadata and permissions after the official CLI creates auth.json.
    await createCodexContext(dataDir);
    return 'Staf-scoped login completed. Run pnpm start auth codex status to check it.';
  }
  if (action === 'logout') {
    await run(['logout']);
    return 'Staf-scoped Codex credentials removed. Normal Codex login was not selected.';
  }
  try {
    const status = await run(['login', 'status']);
    return /Logged in using ChatGPT/i.test(status) ? 'Staf Codex is signed in with ChatGPT.' : 'Staf Codex is not signed in with ChatGPT. Run pnpm start auth codex login.';
  } catch { return 'Staf Codex status unavailable or not signed in. Run pnpm start auth codex login; check codex --version if the command fails.'; }
}
