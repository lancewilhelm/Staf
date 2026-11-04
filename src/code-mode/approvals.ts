import {randomUUID} from 'node:crypto';
import type {Json} from './contract.js';

export type ApprovalAnswer = 'approve' | 'deny' | 'expired' | 'cancelled';
export interface ExactApproval {
  readonly id: string;
  readonly botId: string;
  readonly sessionId: string;
  readonly commandId: string;
  readonly childId: string;
  readonly name: string;
  readonly input: Json;
  readonly resource: Json;
  readonly effect: 'read' | 'change';
  readonly expiresAt: number;
}
interface Waiting {
  detail: Omit<ExactApproval, 'id' | 'expiresAt'>;
  id: string;
  presented: ExactApproval | null;
  resolve(answer: ApprovalAnswer): void;
  signal: AbortSignal;
  abort(): void;
  timer?: ReturnType<typeof setTimeout>;
}
/** Per-agent FIFO, with expiry starting only when the owner sees the request. */
export class CodeApprovals {
  private readonly waiting: Waiting[] = [];
  constructor(private readonly lifetimeMs: number, private readonly now = Date.now) {}
  list(): ExactApproval[] {this.expire(); return this.waiting.flatMap(item => item.presented ? [structuredClone(item.presented)] : []);}
  private present(): void {
    const bots = new Set<string>();
    for (const item of this.waiting) {
      if (bots.has(item.detail.botId)) continue;
      bots.add(item.detail.botId);
      if (!item.presented) {
        item.presented = Object.freeze({...item.detail, id: item.id, expiresAt: this.now() + this.lifetimeMs});
        item.timer = setTimeout(() => this.finish(item, 'expired'), this.lifetimeMs);
      }
    }
  }
  private finish(item: Waiting, answer: ApprovalAnswer): void {
    const index = this.waiting.indexOf(item); if (index < 0) return;
    this.waiting.splice(index, 1); clearTimeout(item.timer); item.signal.removeEventListener('abort', item.abort);
    item.resolve(answer); this.present();
  }
  expire(): void {
    for (const item of [...this.waiting]) if (item.presented && this.now() >= item.presented.expiresAt) this.finish(item, 'expired');
  }
  decide(id: string, answer: 'approve' | 'deny'): boolean {
    this.expire();
    const item = this.waiting.find(item => item.presented?.id === id);
    if (!item) return false;
    if (item.signal.aborted) {this.finish(item, 'cancelled'); return false;}
    this.finish(item, answer); return true;
  }
  request(detail: Omit<ExactApproval, 'id' | 'expiresAt'>, signal: AbortSignal): Promise<ApprovalAnswer> {
    if (signal.aborted) return Promise.resolve('cancelled');
    return new Promise(resolve => {
      const item: Waiting = {detail: structuredClone(detail), id: randomUUID(), presented: null, resolve, signal, abort: () => this.finish(item, 'cancelled')};
      this.waiting.push(item); signal.addEventListener('abort', item.abort, {once: true}); this.present();
    });
  }
}
