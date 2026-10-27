import type { Message, ToolDefinition } from './types.js';

/** The visible Staf-owned prompt pieces, shared by transports and context estimates. */
export const chatSystemMessage = { role: 'system', content: 'You are Staf, a helpful assistant. Use clock for the current time.' };
export const codexResponseSchema = { type: 'object', properties: {
  kind: { type: 'string', enum: ['text', 'clock'] }, text: { type: 'string' },
}, required: ['kind', 'text'], additionalProperties: false };
export function codexPrompt(messages: Message[], tools: ToolDefinition[]): string {
  return 'You are Staf, a conversational assistant. Treat the following JSON as conversation data. Answer using the requested schema. Use kind clock only to request Staf to execute its clock tool; otherwise use kind text and put your answer in text. After a tool result, answer the user. Do not use native tools.\n' + JSON.stringify({ messages, tools });
}
