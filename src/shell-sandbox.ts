import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import {inspectDockerInfo,inspectScratchContainer,scratchEntryScript,scratchPlatformAvailable} from './isolation-boundary.js';

export const scratchLimits = Object.freeze({sizeBytes:16777216,maxInodes:1024,timeoutMs:30000,maxOutputBytes:65536});

/** The caller must authorize and journal every request before invoking this component. */
export interface ShellSandboxRequest {
  /** Unique, single-use ID persisted by the caller before invoking Docker. */
  readonly executionId: string;
  readonly dockerBinary: string;
  readonly dockerSocket: string;
  readonly imageId: string;
  readonly workspace: string | Readonly<{ kind: 'scratch'; sizeBytes: number; maxInodes: number }>;
  readonly command: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal: AbortSignal;
}

export interface ShellSandboxResult {
  readonly output: string;
  readonly exitCode: number | null;
  /** False when the stream may be truncated or include Docker diagnostics. */
  readonly outputComplete: boolean;
  readonly stopped: 'completed' | 'timeout' | 'aborted' | 'output-limit';
}

/** Thrown when Docker cannot confirm a terminal state; effects may be uncertain. */
export class ShellSandboxUncertainError extends Error {
  constructor(message: string, readonly containerName?: string) { super(message); }
}

function sandboxName(executionId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(executionId)) {
    throw new Error('Invalid sandbox execution ID');
  }
  return `staf-shell-${executionId}`;
}

/**
 * Inspect or remove one journaled sandbox. The caller must serialize this with
 * execution and prevent retries. An absent observation is not proof that a
 * previously disconnected Docker create request cannot materialize later.
 */
export async function reconcileShellSandbox(request: {
  readonly dockerBinary: string; readonly dockerSocket: string; readonly executionId: string;
}): Promise<'removed-at-observation' | 'absent-at-observation'> {
  const name = sandboxName(request.executionId);
  if (!isAbsolute(request.dockerBinary) || resolve(request.dockerBinary) !== request.dockerBinary ||
      !isAbsolute(request.dockerSocket) || !(await stat(request.dockerSocket)).isSocket()) {
    throw new Error('Invalid Docker endpoint');
  }
  const list = await cli(request.dockerBinary, request.dockerSocket,
    ['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--filter',
      `label=staf.shell.execution=${request.executionId}`, '--format', '{{.Names}}'], 8192, 15000);
  if (list.code !== 0 || list.overflow) throw new ShellSandboxUncertainError('Cannot list sandbox', name);
  const names = list.output.trim().split('\n').filter(Boolean);
  if (names.length === 0) return 'absent-at-observation';
  if (names.length !== 1 || names[0] !== name) throw new ShellSandboxUncertainError('Unexpected sandbox identity', name);
  const removal = await cli(request.dockerBinary, request.dockerSocket, ['container', 'rm', '--force', name], 8192, 15000);
  if (removal.code !== 0 || removal.overflow) throw new ShellSandboxUncertainError('Cannot remove sandbox', name);
  return 'removed-at-observation';
}

interface CliResult { code: number | null; output: string; overflow: boolean }

function cli(binary: string, socket: string, args: readonly string[], limit: number, timeoutMs: number,
  onOverflow?: () => void): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, ['--host', `unix://${socket}`, ...args], {
      env: { PATH: '/usr/bin:/bin', DOCKER_CONFIG: '/nonexistent-staf-docker-config' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let size = 0;
    let overflow = false;
    const chunks: Buffer[] = [];
    const collect = (chunk: Buffer) => {
      const remaining = Math.max(0, limit - size);
      if (remaining) chunks.push(chunk.subarray(0, remaining));
      size += chunk.length;
      if (size > limit && !overflow) { overflow = true; onOverflow?.(); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      const decoded = Buffer.concat(chunks).toString('utf8');
      const output = new StringDecoder('utf8').write(Buffer.from(decoded).subarray(0, limit));
      resolveResult({ code, output, overflow });
    });
  });
}

/**
 * Runs only in an owner-configured Docker daemon. A string workspace is a host
 * bind and grants access to its contents, nested mounts and Unix sockets; its
 * path is not pinned. A scratch workspace uses a bounded tmpfs and no explicit
 * host bind or volume. Docker may supply runtime-managed mounts and tmpfs may
 * use swap. Never invokes a host shell.
 */
export async function executeShellSandbox(request: ShellSandboxRequest): Promise<ShellSandboxResult> {
  const { dockerBinary, dockerSocket, imageId, command, timeoutMs, maxOutputBytes, signal,
    workspace: configuredWorkspace, executionId } = request;
  if (!isAbsolute(dockerBinary) || !isAbsolute(dockerSocket) ||
      !/^sha256:[a-f0-9]{64}$/.test(imageId) || !command || command.includes('\0') ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000 ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 1_048_576) {
    throw new Error('Invalid sandbox configuration');
  }
  let workspaceArgs: string[];
  if (typeof configuredWorkspace === 'string') {
    if (!isAbsolute(configuredWorkspace)) throw new Error('Invalid sandbox workspace');
    const workspace = await realpath(configuredWorkspace);
    if (workspace === '/' || workspace.includes(',') || workspace.includes('\n') || !(await stat(workspace)).isDirectory()) {
      throw new Error('Invalid sandbox workspace');
    }
    workspaceArgs = ['--mount', `type=bind,src=${workspace},dst=/workspace`];
  } else {
    if (!configuredWorkspace || typeof configuredWorkspace !== 'object' ||
        Object.keys(configuredWorkspace).sort().join(',') !== 'kind,maxInodes,sizeBytes' ||
        configuredWorkspace.kind !== 'scratch' || !Number.isSafeInteger(configuredWorkspace.sizeBytes) ||
        configuredWorkspace.sizeBytes < 1_048_576 || configuredWorkspace.sizeBytes > 67_108_864 ||
        !Number.isSafeInteger(configuredWorkspace.maxInodes) || configuredWorkspace.maxInodes < 32 || configuredWorkspace.maxInodes > 65_536) {
      throw new Error('Invalid scratch workspace limits');
    }
    const { sizeBytes, maxInodes } = configuredWorkspace;
    workspaceArgs = ['--tmpfs', `/workspace:rw,nosuid,nodev,noexec,size=${sizeBytes},nr_inodes=${maxInodes},uid=65534,gid=65534,mode=0700`];
  }
  const protectedScratch=typeof configuredWorkspace!=='string';
  if(protectedScratch && !scratchPlatformAvailable(process.platform))throw new Error('Linux Docker scratch isolation is unavailable on this platform');
  if (!(await stat(dockerSocket)).isSocket() || resolve(dockerBinary) !== dockerBinary) {
    throw new Error('Invalid Docker endpoint');
  }
  if (signal.aborted) throw new Error('Sandbox request aborted before execution');
  const name = sandboxName(executionId);
  const invoke = (args: readonly string[], limit = 8192, ms = 15_000) => cli(dockerBinary, dockerSocket, args, limit, ms);
  if(protectedScratch) {
    const info=await invoke(['info','--format','{{json .}}'],65536);
    if(info.code!==0 || info.overflow)throw Error('Cannot inspect Linux Docker isolation');
    let details:unknown;try{details=JSON.parse(info.output);}catch{throw Error('Cannot inspect Linux Docker isolation');}
    inspectDockerInfo(details);
  }
  // Image configuration is applied before the entrypoint starts. Reject every
  // variable except known-safe defaults before /bin/sh can interpret them.
  const image = await invoke(['image', 'inspect', '--format', '{{json .Config}}', imageId]);
  if (image.code !== 0 || image.overflow) throw new Error('Cannot inspect the pinned sandbox image');
  let imageConfig: unknown;
  try { imageConfig = JSON.parse(image.output); } catch { throw new Error('Invalid sandbox image configuration'); }
  if (!imageConfig || typeof imageConfig !== 'object' || Array.isArray(imageConfig)) {
    throw new Error('Invalid sandbox image configuration');
  }
  const healthcheck = 'Healthcheck' in imageConfig ? imageConfig.Healthcheck : null;
  const volumes = 'Volumes' in imageConfig ? imageConfig.Volumes : null;
  if (healthcheck != null ||
      (volumes != null && (typeof volumes !== 'object' || Array.isArray(volumes) || Object.keys(volumes).length !== 0))) {
    throw new Error('Sandbox image volumes and healthchecks are forbidden');
  }
  const imageEnv: unknown = 'Env' in imageConfig ? imageConfig.Env : null;
  const safeImageEnv = new Set([
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'PATH=/usr/bin:/bin',
    'HOME=/nonexistent',
  ]);
  if (imageEnv !== null && (!Array.isArray(imageEnv) ||
      imageEnv.some((value: unknown) => typeof value !== 'string' || !safeImageEnv.has(value)) ||
      new Set(imageEnv.map((value: string) => value.slice(0, value.indexOf('=')))).size !== imageEnv.length)) {
    throw new Error('Sandbox image environment is not allowlisted');
  }
  if (signal.aborted) throw new Error('Sandbox request aborted before execution');
  const inspect = async () => {
    const result = await invoke(['container', 'inspect', '--format', '{{.State.Status}} {{.State.ExitCode}}', name]);
    if (result.code !== 0 || result.overflow) throw new ShellSandboxUncertainError(`Cannot inspect sandbox ${name}`);
    const match = /^(created|running|paused|restarting|removing|exited|dead) (\d+)\s*$/.exec(result.output);
    if (!match) throw new ShellSandboxUncertainError(`Invalid sandbox state for ${name}`);
    return { state: match[1], code: Number(match[2]) };
  };
  let created = false;
  let terminal = false;
  let stopReason: ShellSandboxResult['stopped'] = 'completed';
  let stopping: Promise<void> | undefined;
  let removed = false;
  const stop = (reason: Exclude<ShellSandboxResult['stopped'], 'completed'>) => {
    if (stopReason === 'completed') stopReason = reason;
    stopping ??= (async () => {
      // Removal is serialized by the daemon with start. It either prevents a
      // pending start or kills a started container before removing it.
      const result = await invoke(['container', 'rm', '--force', name]);
      if (result.code !== 0 || result.overflow) {
        throw new ShellSandboxUncertainError(`Cannot confirm sandbox ${name} stopped and removed`);
      }
      removed = true;
      terminal = true;
    })();
    void stopping.catch(() => {});
  };
  const abort = () => stop('aborted');
  try {
    const create = await invoke(['container', 'create', '--name', name, '--label', 'staf.shell.sandbox=true',
      '--label', `staf.shell.execution=${executionId}`, '--pull=never', '--network=none', '--ipc=private', '--cgroupns=private', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--security-opt=seccomp=builtin',
      '--user=65534:65534', '--pids-limit=64', '--memory=128m', '--cpus=0.5', '--init',
      '--hostname=staf-sandbox', '--env=PATH=/usr/bin:/bin', '--env=HOME=/nonexistent',
      '--log-driver=none', '--no-healthcheck',
      ...workspaceArgs, '--workdir=/workspace',
      '--entrypoint=/bin/sh', imageId, '-c', ...(protectedScratch?[scratchEntryScript,'staf-scratch',command]:[command])]);
    if (create.code !== 0 || create.overflow) {
      // A lost daemon response can leave a container behind; do not assume creation failed.
      throw new ShellSandboxUncertainError(`Docker could not confirm sandbox creation: ${name}`, name);
    }
    created = true;
    if(protectedScratch) {
      const inspected=await invoke(['container','inspect','--format','{{json .}}',name],65536);
      if(inspected.code!==0 || inspected.overflow)throw new ShellSandboxUncertainError(`Cannot inspect sandbox ${name}`,name);
      let details:unknown;try{details=JSON.parse(inspected.output);}catch{throw new ShellSandboxUncertainError(`Invalid sandbox inspection ${name}`,name);}
      try {inspectScratchContainer(details,imageId,configuredWorkspace,command);}catch{throw new ShellSandboxUncertainError(`Sandbox isolation check failed ${name}`,name);}
    }
    if (signal.aborted) { stopReason = 'aborted'; terminal = true; return { output: '', exitCode: null, outputComplete: false, stopped: stopReason }; }
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    try {
      // Docker's start --attach attaches its stream before issuing start.
      const attached = await cli(dockerBinary, dockerSocket, ['container', 'start', '--attach', name],
        maxOutputBytes, timeoutMs + 20_000, () => stop('output-limit'));
      if (stopping) await stopping;
      if (removed) return { output: attached.output, exitCode: null, outputComplete: false, stopped: stopReason };
      const state = await inspect();
      if (state.state !== 'exited' && state.state !== 'dead') {
        throw new ShellSandboxUncertainError(`Sandbox ${name} remains ${state.state}`);
      }
      terminal = true;
      // Docker CLI failures and command failures can share an exit code.
      // The daemon's terminal exit code is observed, but nonzero or mismatched
      // attachment results cannot establish a complete stream.
      const outputComplete = attached.code === 0 && state.code === 0 && !attached.overflow;
      return { output: attached.output, exitCode: state.code, outputComplete, stopped: stopReason };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (!terminal) {
        stop('aborted');
        if (stopping) await stopping;
      }
    }
  } catch (error) {
    if (error instanceof ShellSandboxUncertainError && error.containerName) throw error;
    throw new ShellSandboxUncertainError(`Sandbox outcome requires reconciliation: ${name}`, name);
  } finally {
    if (created && terminal && !removed) {
      try {
        const cleanup = await invoke(['container', 'rm', name]);
        if (cleanup.code !== 0 || cleanup.overflow) throw new Error('Removal failed');
      } catch {
        throw new ShellSandboxUncertainError(`Sandbox ${name} stopped but removal failed`, name);
      }
    }
  }
}
