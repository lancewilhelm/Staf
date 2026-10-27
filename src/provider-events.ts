import type { Message, Provider, ProviderEvent, ToolDefinition, ProviderCallOptions } from './types.js';
import { errorMessage, isAssistantMessage } from './validation.js';

/** Normalize buffered adapters as an event stream, without inventing token streaming. */
export async function* providerEvents(provider: Provider, messages: Message[], tools: ToolDefinition[], incrementalText = false, options: ProviderCallOptions = {}): AsyncGenerator<ProviderEvent> {
  if (incrementalText && !provider.capabilities?.incrementalText) throw new Error('This adapter does not support incremental text streaming');
  try {
    if(provider.stream){for await(const event of provider.stream(messages,tools,options)){options.signal?.throwIfAborted();if(event.type==='message'&&!isAssistantMessage(event.message))throw Error('Invalid assistant message');yield event;}return;}
    const message: unknown = await provider.complete(messages, tools, options);
    options.signal?.throwIfAborted();
    if (!isAssistantMessage(message)) throw new Error('Invalid assistant message');
    yield { type: 'message', message };
  } catch (error) {
    yield { type: 'error', message: errorMessage(error) };
  }
}
