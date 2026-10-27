import type { UsageReport, UsageObservation } from './usage.js';
/** Contracts shared by the runtime, providers, storage and future clients. */
export interface ToolCall {
  id: string;
  type?: 'function';
  function: { name: string; arguments: string };
}
export type ResponseReplayContent =
 | {type:'output_text';text:string}
 | {type:'refusal';refusal:string};
export type ResponseReplayItem =
 | {type:'reasoning';id?:string;encrypted_content:string}
 | {type:'message';role:'assistant';phase?:'commentary'|'final_answer';content:ResponseReplayContent[]}
 | {type:'function_call';call_id:string;name:string;arguments:string};
export type AssistantMessage = (
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'assistant'; content?: string | null; tool_calls: ToolCall[] }) & { usage?: UsageReport; responseReplay?: {provider:'codex-direct';model:string;items:ResponseReplayItem[]} };
export type Message =
  | { role: 'user'; content: string }
  | AssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type: 'object'; properties: Record<string, never>; additionalProperties: false };
  };
}
export interface ProviderCapabilities {
  toolCalls: boolean;
  incrementalText: boolean;
  transport: 'chat-completions' | 'codex-cli-planner' | 'responses' | 'demo';
}
export type ProviderEvent =
  | { type: 'message'; message: AssistantMessage }
  | { type: 'text_delta'; text: string }
  | { type: 'error'; message: string };
export interface ProviderCallOptions { signal?: AbortSignal }
export interface Provider {
  name: string;
  capabilities: ProviderCapabilities;
  stream?(messages: Message[], tools: ToolDefinition[], options?: ProviderCallOptions): AsyncIterable<ProviderEvent>;
  complete(messages: Message[], tools: ToolDefinition[], options?: ProviderCallOptions): Promise<AssistantMessage>;
}
export type RuntimeEvent =
  | { type: 'provider_start'; provider: string }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_result'; id: string; name: string; success: boolean; content: string }
  | { type: 'assistant'; text: string }
  | { type: 'error'; message: string };
export interface Session {
  version: 1;
  /** Missing on older files; earlier attribution is not invented. Message indexes are end-exclusive. */
  usage?: UsageObservation[];
  turns?: { start: number; end: number; provider: string }[];
  id: string;
  provider: string | null;
  messages: Message[];
  events: RuntimeEvent[];
}
export interface SessionWriter { save(session: Session): Promise<void> }
