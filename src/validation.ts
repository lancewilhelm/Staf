import { isUsageObservation } from './usage.js';
import type { AssistantMessage, Message, RuntimeEvent, Session, ToolCall } from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isArray(value: unknown): value is unknown[] { return Array.isArray(value); }
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function hasCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}
function isToolCall(value: unknown): value is ToolCall {
  return isRecord(value) && typeof value.id === 'string' &&
    (value.type === undefined || value.type === 'function') && isRecord(value.function) &&
    typeof value.function.name === 'string' && typeof value.function.arguments === 'string';
}
function validReplay(raw: unknown): boolean {
 if(!isRecord(raw)||raw.provider!=='codex-direct'||typeof raw.model!=='string'||!Array.isArray(raw.items)||raw.items.length>32)return false;
 return raw.items.every((item:unknown)=>isRecord(item)&&(
  item.type==='reasoning'&&typeof item.encrypted_content==='string'&&item.encrypted_content.length<=262144&&(item.id===undefined||typeof item.id==='string')
  ||item.type==='function_call'&&typeof item.call_id==='string'&&typeof item.name==='string'&&typeof item.arguments==='string'
  ||item.type==='message'&&item.role==='assistant'&&(item.phase===undefined||item.phase==='commentary'||item.phase==='final_answer')&&Array.isArray(item.content)&&item.content.every((part:unknown)=>isRecord(part)&&(part.type==='output_text'&&typeof part.text==='string'||part.type==='refusal'&&typeof part.refusal==='string'))
 ));
}
export function isAssistantMessage(value: unknown): value is AssistantMessage {
  if (!isRecord(value) || value.role !== 'assistant') return false;
  if(value.responseReplay!==undefined&&!validReplay(value.responseReplay))return false;
  if (value.tool_calls !== undefined && (!isArray(value.tool_calls) ||
      value.tool_calls.length > 8 || !value.tool_calls.every(isToolCall))) return false;
  const calls = value.tool_calls;
  if (isArray(calls) && calls.length) {
    return new Set(calls.map(c => isRecord(c) ? c.id : undefined)).size === calls.length &&
      (value.content === undefined || value.content === null || typeof value.content === 'string');
  }
  return typeof value.content === 'string';
}
function isMessage(value: unknown): value is Message {
  if (!isRecord(value)) return false;
  if (value.role === 'assistant') return isAssistantMessage(value);
  if (value.role === 'user') return typeof value.content === 'string';
  return value.role === 'tool' && typeof value.content === 'string' && typeof value.tool_call_id === 'string';
}
function isEvent(value: unknown): value is RuntimeEvent {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'provider_start': return typeof value.provider === 'string';
    case 'tool_start': return typeof value.id === 'string' && typeof value.name === 'string';
    case 'tool_result': return typeof value.id === 'string' && typeof value.name === 'string' &&
      typeof value.success === 'boolean' && typeof value.content === 'string';
    case 'assistant': return typeof value.text === 'string';
    case 'error': return typeof value.message === 'string';
    default: return false;
  }
}
// Validate structure AND complete turn/tool ordering before accepting untrusted JSON.
export function validSession(value: unknown, id: string): value is Session {
  if (!isRecord(value) || value.version !== 1 || value.id !== id ||
      !(value.provider === null || typeof value.provider === 'string') ||
      !isArray(value.messages) || !value.messages.every(isMessage) ||
      !isArray(value.events) || !value.events.every(isEvent)) return false;
  if (value.usage !== undefined && (!isArray(value.usage) || !value.usage.every(isUsageObservation) || new Set(value.usage.map(item => item.id)).size !== value.usage.length)) return false;
  if (value.turns !== undefined) {
    if (!isArray(value.turns)) return false;
    let previousEnd = 0;
    for (const turn of value.turns) {
      if (!isRecord(turn) || !Number.isInteger(turn.start) || !Number.isInteger(turn.end) ||
          typeof turn.start !== 'number' || typeof turn.end !== 'number' || turn.start < previousEnd ||
          turn.end <= turn.start || turn.end > value.messages.length || typeof turn.provider !== 'string' ||
          value.messages[turn.start]?.role !== 'user' || value.messages[turn.end - 1]?.role !== 'assistant') return false;
      previousEnd = turn.end;
    }
  }
  let expected: Message['role'] = 'user';
  let pending: string[] = [];
  for (const message of value.messages) {
    if (message.role !== expected) return false;
    if (message.role === 'user') expected = 'assistant';
    else if (message.role === 'assistant') {
      const calls = message.tool_calls ?? [];
      pending = calls.map(c => c.id);
      expected = pending.length ? 'tool' : 'user';
    } else {
      if (message.tool_call_id !== pending.shift()) return false;
      expected = pending.length ? 'tool' : 'assistant';
    }
  }
  return expected === 'user' && (!value.messages.length || typeof value.provider === 'string');
}
