// This process is the native lab profile. QuickJS is the guest, not Node's VM.
import {getQuickJS, type QuickJSContext, type QuickJSDeferredPromise, type QuickJSHandle} from 'quickjs-emscripten';
import {hostMessage, limits, type WorkerMessage} from './protocol.js';
import {jsonValue} from './json.js';

let context: QuickJSContext | undefined;
let result: QuickJSHandle | undefined;
let started = false, ended = false, sequence = 0, guestMs = 0, allowance = 0;
let segmentStart = 0;
const pending = new Map<number, QuickJSDeferredPromise>();
function send(message: WorkerMessage): void { process.stdout.write(JSON.stringify(message) + '\n'); }
function end(outcome: 'error' | 'syntax'): void {
  if (ended) return;
  ended = true;
  send({type: 'end', outcome, guestMs});
}
function phase(busy: boolean): void { send({type: 'phase', busy, guestMs}); }
function runGuest<T>(fn: () => T): T {
  phase(true); segmentStart = performance.now();
  try { return fn(); }
  finally { guestMs += performance.now() - segmentStart; phase(false); }
}
function pump(): void {
  const vm = context, promise = result;
  if (!vm || !promise || ended) return;
  try {
    runGuest(() => {
      for (let i = 0; i < 64 && vm.runtime.hasPendingJob(); i++) {
        const job = vm.runtime.executePendingJobs(1);
        if (job.error) { job.error.dispose(); throw Error('Guest job failed'); }
      }
    });
    if (guestMs >= allowance) { end('error'); return; }
    const state = vm.getPromiseState(promise);
    if (state.type === 'fulfilled') {
      const encoded = vm.getString(state.value); state.value.dispose();
      const value: unknown = JSON.parse(encoded);
      const parsed = jsonValue.parse(value);
      ended = true; send({type: 'end', outcome: 'return', value: parsed, guestMs});
    } else if (state.type === 'rejected') { state.error.dispose(); end('error'); }
    else if (vm.runtime.hasPendingJob()) setImmediate(pump);
    else if (pending.size === 0) end('error');
  } catch { end('error'); }
}
async function start(source: string, names: string[], budget: number, heapBytes: number, stackBytes: number): Promise<void> {
  if (started) { end('error'); return; }
  started = true; allowance = budget;
  const module = await getQuickJS();
  if (ended) return;
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(heapBytes);
  runtime.setMaxStackSize(stackBytes);
  runtime.setInterruptHandler(() => guestMs + performance.now() - segmentStart >= allowance);
  const vm = runtime.newContext(); context = vm;
  const bridge = vm.newFunction('__bridge', handle => {
    if (ended || pending.size >= limits.pending + 2) return {error: vm.newError('Bridge limit')};
    const payload: unknown = JSON.parse(vm.getString(handle));
    const parsed = jsonValue.parse(payload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {error: vm.newError('Invalid bridge request')};
    const seq = ++sequence;
    const request = vm.newPromise(); pending.set(seq, request);
    // Parse again at the parent boundary; guest code has no authority over IDs.
    if (parsed.type === 'call' && typeof parsed.name === 'string' && 'input' in parsed) send({type: 'call', seq, name: parsed.name, input: parsed.input ?? null});
    else if (parsed.type === 'reuse' && typeof parsed.receipt === 'string') send({type: 'reuse', seq, receipt: parsed.receipt});
    else if (parsed.type === 'emit' && 'value' in parsed) send({type: 'emit', seq, value: parsed.value ?? null});
    else { pending.delete(seq); request.dispose(); return {error: vm.newError('Invalid bridge request')}; }
    return request.handle;
  });
  vm.setProp(vm.global, '__bridge', bridge); bridge.dispose();
  const bootstrap = `(() => {
    const bridge = globalThis.__bridge; delete globalThis.__bridge;
    const pack = value => {
      const seen = new Set();
      const visit = (v, depth) => {
        if (depth > 64) throw Error('JSON nesting limit');
        if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return;
        if (typeof v !== 'object' || seen.has(v)) throw Error('Expected JSON data');
        const proto = Object.getPrototypeOf(v);
        if (proto !== Object.prototype && proto !== null && !Array.isArray(v)) throw Error('Expected plain JSON');
        if (Object.hasOwn(v, '__proto__')) throw Error('Unsupported JSON property');
        if (Object.getOwnPropertySymbols(v).length) throw Error('Expected JSON properties');
        if (Array.isArray(v) && (Object.keys(v).length !== v.length || Object.keys(v).some((key, index) => key !== String(index)))) throw Error('Expected dense JSON array');
        seen.add(v);
        for (const d of Object.values(Object.getOwnPropertyDescriptors(v))) {
          if (d.get || d.set) throw Error('Expected JSON values');
          if (d.enumerable) visit(d.value, depth + 1);
        }
        seen.delete(v);
      };
      visit(value, 0); const text = JSON.stringify(value);
      if (text.length > ${limits.childBytes}) throw Error('JSON limit');
      return text;
    };
    const request = async payload => {
      const answer = JSON.parse(await bridge(pack(payload)));
      if (!answer.ok) throw Error(answer.error);
      return answer.value;
    };
    const capabilities = Object.create(null);
    for (const name of ${JSON.stringify(names)}) capabilities[name] = input => request({type:'call',name,input});
    Object.defineProperty(globalThis, 'capabilities', {value:Object.freeze(capabilities)});
    Object.defineProperty(globalThis, 'staf', {value:Object.freeze({
      emit: value => request({type:'emit',value}),
      reuse: receipt => request({type:'reuse',receipt}),
    })});
    return async value => pack(await value ?? null);
  })()`;
  try {
    const setup = runGuest(() => vm.evalCode(bootstrap));
    if (setup.error) {setup.error.dispose(); end('error'); return;}
    const evaluation = runGuest(() => vm.evalCode(`(async () => {\n${source}\n})()`, 'staf-code.js', {type: 'global'}));
    if (evaluation.error) {evaluation.error.dispose(); setup.value.dispose(); end('syntax'); return;}
    const wrapped = runGuest(() => vm.callFunction(setup.value, vm.undefined, evaluation.value));
    setup.value.dispose(); evaluation.value.dispose();
    if (wrapped.error) {wrapped.error.dispose(); end('error'); return;}
    result = wrapped.value; pump();
  } catch { end('error'); }
}
let buffered = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
  if (ended) return;
  buffered = Buffer.concat([buffered, chunk]);
  if (buffered.length > limits.childBytes * 3) { end('error'); return; }
  for (;;) {
    const index = buffered.indexOf(10); if (index < 0) break;
    const line = buffered.subarray(0, index); buffered = buffered.subarray(index + 1);
    try {
      const raw: unknown = JSON.parse(line.toString('utf8'));
      const message = hostMessage.parse(raw);
      if (message.type === 'start') void start(message.source, message.names, message.guestMs, message.heapBytes, message.stackBytes).catch(() => end('error'));
      else {
        const promise = pending.get(message.seq);
        if (!promise || !context) {end('error'); return;}
        pending.delete(message.seq);
        const value = context.newString(JSON.stringify(message.result));
        promise.resolve(value); value.dispose(); promise.dispose();
        setImmediate(pump);
      }
    } catch { end('error'); return; }
  }
});
process.stdin.on('end', () => process.exit(0));
