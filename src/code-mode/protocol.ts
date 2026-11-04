import { z } from 'zod';
import {jsonValue} from './contract.js';

export const limits = Object.freeze({
  invocations: 4, providerRequests: 6, children: 32, corrections: 2,
  activeMs: 300_000, guestMs: 5_000, sourceBytes: 32 * 1024,
  heapBytes: 32 * 1024 * 1024, stackBytes: 512 * 1024,
  reads: 3, pending: 8, resident: 8, childBytes: 256 * 1024,
  cacheBytes: 2 * 1024 * 1024, outputBytes: 256 * 1024,
  approvalMs: 24 * 60 * 60 * 1000, settleMs: 5_000,
});
export type Limits = typeof limits;
const seq = z.number().int().positive();
export const workerMessage = z.union([
  z.strictObject({type: z.literal('call'), seq, name: z.string().max(128), input: jsonValue}),
  z.strictObject({type: z.literal('reuse'), seq, receipt: z.string().max(256)}),
  z.strictObject({type: z.literal('emit'), seq, value: jsonValue}),
  z.strictObject({type: z.literal('phase'), busy: z.boolean(), guestMs: z.number().nonnegative().finite()}),
  z.strictObject({type: z.literal('end'), outcome: z.literal('return'), value: jsonValue, guestMs: z.number().nonnegative().finite()}),
  z.strictObject({type: z.literal('end'), outcome: z.enum(['error', 'syntax']), guestMs: z.number().nonnegative().finite()}),
]);
export type WorkerMessage = z.infer<typeof workerMessage>;
export const hostMessage = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('start'), source: z.string(), names: z.array(z.string()), guestMs: z.number().positive().finite()}),
  z.strictObject({type: z.literal('response'), seq, result: z.discriminatedUnion('ok', [z.strictObject({ok: z.literal(true), value: jsonValue}), z.strictObject({ok: z.literal(false), error: z.string()})])}),
]);
export type HostMessage = z.infer<typeof hostMessage>;
