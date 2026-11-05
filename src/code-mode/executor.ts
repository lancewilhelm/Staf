// Ported from Staf PR #75 experiment at 2da3b8fb0dbda9d5b58526ba66bbc17b6a6ffc6f.
// The worker is not yet connected to accepted work or provider turns.
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {workerMessage, limits, type WorkerMessage, type HostMessage} from './protocol.js';

export type GuestRequest = Extract<WorkerMessage, {type: 'call' | 'reuse' | 'emit'}>;
export type GuestEnd = Extract<WorkerMessage, {type: 'end'}> | {type: 'end'; outcome: 'worker-failed' | 'stopped'; guestMs: number};
export interface GuestRun {
  readonly finished: Promise<GuestEnd>;
  stop(): void;
}
/** Deliberately named native-lab: this is not an OS isolation or total RSS claim. */
export function startNativeLabGuest(input: {
  source: string;
  names: string[];
  guestMs: number;
  heapBytes?: number;
  stackBytes?: number;
  request: (request: GuestRequest) => Promise<Extract<HostMessage, {type: 'response'}>['result']>;
  phase: (busy: boolean, guestMs: number) => void;
}): GuestRun {
  const cwd = mkdtempSync(join(tmpdir(), 'staf-code-'));
  const child = spawn(process.execPath, ['--max-old-space-size=64', fileURLToPath(new URL('./worker.js', import.meta.url))], {
    cwd, env: {}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let terminal = false, guestMs = 0, sequence = 0, busyTimer: ReturnType<typeof setTimeout> | undefined;
  let resolve: (end: GuestEnd) => void;
  const finished = new Promise<GuestEnd>(done => {resolve = done;});
  function finish(end: GuestEnd): void {
    if (terminal) return;
    terminal = true; clearTimeout(busyTimer);
    child.kill('SIGKILL'); child.stdin.destroy();
    resolve(end);
  }
  const fail = () => finish({type: 'end', outcome: 'worker-failed', guestMs});
  child.once('error', fail);
  child.once('close', () => {rmSync(cwd, {recursive: true, force: true}); fail();});
  // stderr is never forwarded or retained: a worker failure must not expose host paths.
  let errorBytes = 0;
  child.stderr.on('data', (chunk: Buffer) => {errorBytes += chunk.length; if (errorBytes > 32 * 1024) fail();});
  child.stdin.on('error', () => {if (!terminal) fail();});
  let buffer = Buffer.alloc(0);
  child.stdout.on('data', (chunk: Buffer) => {
    if (terminal) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > limits.childBytes * 3) {fail(); return;}
    for (;;) {
      const index = buffer.indexOf(10); if (index < 0) break;
      const line = buffer.subarray(0, index); buffer = buffer.subarray(index + 1);
      try {
        const raw: unknown = JSON.parse(line.toString('utf8'));
        const message = workerMessage.parse(raw);
        if (message.type === 'phase') {
          if (message.guestMs < guestMs || message.guestMs > input.guestMs + 100) {fail(); return;}
          guestMs = message.guestMs;
          clearTimeout(busyTimer);
          if (message.busy) busyTimer = setTimeout(fail, Math.max(1, input.guestMs - guestMs));
          input.phase(message.busy, guestMs);
        } else if (message.type === 'end') finish(message);
        else {
          if (message.seq !== ++sequence) {fail(); return;}
          void input.request(message).then(result => {
            if (!terminal) child.stdin.write(JSON.stringify({type: 'response', seq: message.seq, result} satisfies HostMessage) + '\n');
          }).catch(fail);
        }
      } catch {fail(); return;}
      if (terminal) return;
    }
  });
  child.stdin.write(JSON.stringify({type: 'start', source: input.source, names: input.names, guestMs: input.guestMs, heapBytes: input.heapBytes ?? limits.heapBytes, stackBytes: input.stackBytes ?? limits.stackBytes} satisfies HostMessage) + '\n');
  // Startup and a broken pump cannot retain a resident process forever.
  const startup = setTimeout(fail, 10_000);
  child.stdout.once('data', () => clearTimeout(startup));
  void finished.then(() => clearTimeout(startup));
  return {finished, stop: () => finish({type: 'end', outcome: 'stopped', guestMs})};
}
