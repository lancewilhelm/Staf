import { randomUUID } from 'node:crypto';
import { sanitizeMetrics, type UsageObservation, type UsageReport } from './usage.js';
import { redactValue } from './config.js';
import { providerEvents } from './provider-events.js';
import type { Provider, RuntimeEvent, Session, SessionWriter, ToolDefinition } from './types.js';
import { errorMessage, isAssistantMessage, isRecord, validSession } from './validation.js';

interface TurnOptions {
  session: Session;
  store: SessionWriter;
  provider: Provider;
  text: string;
  emit?: (event: RuntimeEvent) => void;
  maxSteps?: number;
  clock?: () => string;
  signal?: AbortSignal;
  redact?: (text: string) => string;
}

export const tools: ToolDefinition[] = [{ type: 'function', function: {
  name: 'clock', description: 'Read the current UTC time.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
} }];

// Transport-independent loop: providers see messages; clients receive persisted events.
export async function runTurn({ session, store, provider, text, emit = () => {}, maxSteps = 4, clock = () => new Date().toISOString(), redact = text => text, signal }: TurnOptions): Promise<void> {
  text = redact(text);
  if (!text.trim()) throw new Error('Message cannot be empty');
  const history = redactValue(session, redact);
  if (!validSession(history, session.id)) throw new Error('Cannot safely redact the saved conversation');
  const messages = structuredClone(history.messages);
  const events: RuntimeEvent[] = [];
  const usage: UsageObservation[] = [];
  const attempt = randomUUID();
  let started: number | undefined;
  const observe = (report: UsageReport | undefined, outcome: UsageObservation['outcome']) => {
    usage.push({ observedAt: new Date().toISOString(), ...(report?.scope === 'request' || report?.scope === 'execution' ? {scope: report.scope} : {}), id: randomUUID(), attempt, turnStart: history.messages.length, provider: redact(provider.name),
      latencyMs: Math.max(0, performance.now() - (started ?? performance.now())), outcome,
      status: report?.status === 'reported' || report?.status === 'not-applicable' ? report.status : provider.name === 'demo' ? 'not-applicable' : 'unavailable',
      source: redact(report?.source || (provider.name === 'demo' ? 'Offline demo, no model' : 'No usage returned for this call')),
      ...(report?.model && redact(report.model) === report.model ? {model: report.model} : {}), metrics: sanitizeMetrics(report?.metrics) });
    started = undefined;
  };
  const report = (event: RuntimeEvent) => { events.push(event); emit(event); };
  messages.push({ role: 'user', content: text });
  try {
    for (let step = 0; step < maxSteps; step++) {
      signal?.throwIfAborted();
      report({ type: 'provider_start', provider: redact(provider.name) });
      let raw: unknown;
      started = performance.now();
      const availableTools = provider.capabilities?.toolCalls === false ? [] : tools;
      for await (const event of providerEvents(provider, structuredClone(messages), availableTools, false, {signal})) {
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'message') raw = event.message;
      }
      signal?.throwIfAborted();
      if (raw === undefined) throw new Error('Provider returned no final message');
      const message = redactValue(raw, redact);
      if (!isAssistantMessage(message)) throw new Error('Invalid assistant message');
      const calls = message.tool_calls ?? [];
      observe(message.usage, 'response');
      delete message.usage;
      if (calls.length && provider.capabilities?.toolCalls === false) throw new Error('This adapter does not support tool requests');
      messages.push(message);
      if (!calls.length) {
        if (typeof message.content !== 'string') throw new Error('Expected assistant text');
        const finalEvent: RuntimeEvent = { type: 'assistant', text: message.content };
        const updated: Session = { ...session, usage: [...(history.usage || []), ...usage], turns: [...(history.turns || []), { start: history.messages.length, end: messages.length, provider: redact(provider.name) }], provider: redact(provider.name), messages, events: [...history.events, ...events, finalEvent] };
        signal?.throwIfAborted();
        await store.save(updated);
        Object.assign(session, updated);
        emit(finalEvent);
        return;
      }
      for (const call of calls) {
        signal?.throwIfAborted();
        const name = call.function.name;
        report({ type: 'tool_start', id: call.id, name });
        let content;
        let success = true;
        try {
          const args: unknown = JSON.parse(call.function.arguments);
          if (name !== 'clock') throw new Error('Unknown tool');
          if (!isRecord(args) || Object.keys(args).length) throw new Error('clock takes no arguments');
          content = redact(clock());
        } catch (error) { success = false; content = `Tool error: ${redact(errorMessage(error))}`; }
        messages.push({ role: 'tool', tool_call_id: call.id, content });
        report({ type: 'tool_result', id: call.id, name, success, content });
      }
    }
    throw new Error('Tool iteration limit reached');
  } catch (error) {
    if (started !== undefined) observe(undefined, 'failed');
    if (usage.length) {
      const accounting: Session = { ...history, usage: [...(history.usage || []), ...usage] };
      try { await store.save(accounting); Object.assign(session, accounting); } catch { /* Original failure wins; usage cannot be durable if storage is unavailable. */ }
    }
    report({ type: 'error', message: redact(errorMessage(error)) });
    // Failed turns roll back all messages so resuming never sends incomplete tool history.
    throw new Error(redact(errorMessage(error)));
  }
}
