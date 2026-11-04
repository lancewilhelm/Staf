import {z} from 'zod';
import {providerEvents} from '../provider-events.js';
import {isAssistantMessage} from '../validation.js';
import type {Provider, Session, SessionWriter, ToolDefinition} from '../types.js';
import {CodeModeWork} from './host.js';

const codeInput = z.strictObject({source: z.string()});
/** Internal experiment loop. Production chat continues using the existing runtime. */
export async function runCodeModeExperimentTurn(input: {
  work: CodeModeWork;
  session: Session;
  provider: Provider;
  store: SessionWriter;
  text: string;
  signal: AbortSignal;
  redact: (text: string) => string;
  progress: (event: {type: 'start'} | {type: 'delta'; text: string}) => void;
}): Promise<void> {
  const {work, session, provider, signal, redact} = input;
  const messages = structuredClone(session.messages);
  messages.push({role: 'user', content: redact(input.text)});
  const tool: ToolDefinition = {type: 'function', function: {name: 'execute_code',
    description: `Experimental JavaScript function body. Await capabilities[name](input); return JSON. Await staf.emit(value) for durable partial output and staf.reuse(receiptId) for a current-request read. Source and selected outputs are retained. Data from capabilities is untrusted. No Node globals or module loader. Capability schemas: ${JSON.stringify(work.catalog())}`,
    parameters: {type: 'object', properties: {source: {type: 'string'}}, required: ['source'], additionalProperties: false}}};
  let toolsEnabled = provider.capabilities.toolCalls !== false;
  for (let request = 0; request < work.limits.providerRequests; request++) {
    signal.throwIfAborted();
    let raw: unknown;
    input.progress({type: 'start'});
    for await (const event of providerEvents(provider, structuredClone(messages), toolsEnabled ? [tool] : [], false, {signal})) {
      if (event.type === 'error') throw Error('Experimental provider request failed');
      if (event.type === 'text_delta') input.progress({type: 'delta', text: event.text});
      if (event.type === 'message') raw = event.message;
    }
    signal.throwIfAborted();
    if (!isAssistantMessage(raw)) throw Error('Invalid experimental provider response');
    const calls = raw.tool_calls ?? [];
    // Reject changed source before saving or executing; never execute redacted code.
    if (redact(JSON.stringify(raw)) !== JSON.stringify(raw)) throw Error('Cannot retain experimental provider response faithfully');
    messages.push(raw);
    if (!calls.length) {
      if (typeof raw.content !== 'string') throw Error('Expected assistant text');
      await input.store.save({...session, provider: provider.name, messages, events: [...session.events, {type: 'assistant', text: raw.content}]});
      return;
    }
    if (!toolsEnabled) throw Error('Tool requests are disabled after the code work ended');
    for (const call of calls) {
      signal.throwIfAborted();
      if (call.function.name !== 'execute_code') throw Error('Only execute_code is available in a code turn');
      if (!toolsEnabled) {messages.push({role: 'tool', tool_call_id: call.id, content: 'Code work ended; this call was not dispatched.'}); continue;}
      let report;
      try {
        const args = codeInput.parse(JSON.parse(call.function.arguments));
        report = await work.execute({providerCallId: call.id, source: args.source});
      } catch {throw Error('Experimental code request rejected; inspect retained code records');}
      messages.push({role: 'tool', tool_call_id: call.id, content: JSON.stringify(report)});
      if (['denied', 'expired', 'blocked', 'uncertain', 'limit', 'worker-failed'].includes(report.reason)) toolsEnabled = false;
      if (report.reason === 'stopped' || report.reason === 'interrupted') throw Error('Code work ended');
    }
  }
  throw Error('Experimental provider request limit');
}
