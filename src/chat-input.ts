import { createInterface, type Interface } from 'node:readline';

/** Queue lines independently of readline instances so a raw-mode menu can borrow input. */
export class ChatInput implements AsyncIterable<string> {
  private interface: Interface | undefined;
  private lines: string[] = [];
  private ended = false;
  private suspended = false;
  private wake: (() => void) | undefined;
  private draft = '';
  private readonly interrupt = () => { this.onInterrupt(); process.stdout.write('\n'); this.close(); };
  constructor(private readonly promptText: string, private readonly onInterrupt: () => void = () => {}) { process.once('SIGINT', this.interrupt); this.attach(); }
  private attach(): void {
    this.suspended = false;
    const terminal = !!process.stdin.isTTY && !!process.stdout.isTTY && process.env.TERM !== 'dumb';
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal });
    this.interface = rl;
    rl.setPrompt(this.promptText);
    rl.on('line', line => { this.lines.push(line); this.wake?.(); });
    rl.on('close', () => { if (!this.suspended) { this.ended = true; this.wake?.(); } });
    rl.on('SIGINT', () => { this.onInterrupt(); process.stdout.write('\n'); this.close(); });
    if (this.draft) { rl.write(this.draft); this.draft = ''; }
  }
  prompt(): void { if (process.stdin.isTTY && process.stdout.isTTY && !this.ended) this.interface?.prompt(); }
  suspend(): void {
    this.suspended = true;
    this.draft = this.interface?.line || '';
    this.interface?.close(); this.interface = undefined;
  }
  resume(): void { if (!this.ended) this.attach(); }
  close(): void {
    process.off('SIGINT', this.interrupt);
    this.ended = true; this.lines = []; this.interface?.close(); this.interface = undefined;
    if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
    process.stdin.pause(); this.wake?.();
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    while (true) {
      const line = this.lines.shift();
      if (line !== undefined) { yield line; continue; }
      if (this.ended) return;
      await new Promise<void>(resolve => { this.wake = resolve; });
      this.wake = undefined;
    }
  }
}
