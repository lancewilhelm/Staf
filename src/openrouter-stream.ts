import { httpUsage } from './usage.js';
import { isRecord } from './validation.js';
import type { AssistantMessage, Message, ProviderCallOptions, ProviderEvent, ToolCall, ToolDefinition } from './types.js';

/** OpenRouter Chat Completions streams are provisional until a finish reason and [DONE]. */
export async function* openRouterStream({key, model, effort, instructions, request, messages, tools, options}: {
  key: string; model: string; effort?: string; instructions: string; request: typeof fetch;
  messages: Message[]; tools: ToolDefinition[]; options?: ProviderCallOptions;
}): AsyncGenerator<ProviderEvent> {
  const signal = options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await request('https://openrouter.ai/api/v1/chat/completions', {
      method:'POST', redirect:'error', signal, headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({model, messages:[{role:'system',content:instructions},...messages.map(message=>{
        if (message.role !== 'assistant') return message;
        const {usage, responseReplay, ...visible} = message; return visible;
      })], tools, stream:true, stream_options:{include_usage:true}, ...(effort && effort !== 'default' ? {reasoning:{effort}} : {})}),
    });
  } catch { options?.signal?.throwIfAborted(); throw Error('OpenRouter connection failed or timed out; check your connection and retry'); }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? 'check your API key and model access' : response.status === 402 ? 'add provider credits' : response.status === 429 ? 'rate limit reached; retry later' : response.status === 404 ? 'check that the selected model is available' : response.status === 400 ? 'check the selected model and its supported capabilities' : 'check model access and retry';
    throw Error(`OpenRouter HTTP ${response.status}: ${hint}`);
  }
  if (!response.body) throw Error('OpenRouter returned an empty response; retry');
  let buffer='', text='', finished: string | undefined, done=false, usageBody: Record<string, unknown> = {};
  const calls = new Map<number, {id:string; name:string; args:string}>();
  const reader=response.body.getReader(), decoder=new TextDecoder();
  try {
    while (!done) {
      const chunk=await reader.read();
      buffer += decoder.decode(chunk.value, {stream:!chunk.done});
      if (buffer.length > 2_000_000) throw Error('OpenRouter response exceeded the supported size');
      let boundary: RegExpExecArray | null;
      while ((boundary=/\r?\n\r?\n/.exec(buffer))) {
        const block=buffer.slice(0,boundary.index); buffer=buffer.slice(boundary.index+boundary[0].length);
        const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
        if (!data) continue;
        if (data==='[DONE]') {done=true;break;}
        let value:unknown; try {value=JSON.parse(data);} catch {throw Error('Invalid OpenRouter stream; retry');}
        if (!isRecord(value)) throw Error('Invalid OpenRouter stream; retry');
        if (value.error) throw Error('OpenRouter interrupted the response; check model access, credits or rate limits and retry');
        if (isRecord(value.usage)) usageBody={...usageBody,usage:value.usage};
        if (typeof value.model==='string') usageBody={...usageBody,model:value.model};
        if (!Array.isArray(value.choices)) throw Error('Invalid OpenRouter stream; retry');
        for (const choice of value.choices) {
          if (!isRecord(choice) || (choice.index !== undefined && choice.index !== 0)) throw Error('Invalid OpenRouter stream choice');
          if (choice.error) throw Error('OpenRouter interrupted the response; check model access, credits or rate limits and retry');
          if (typeof choice.finish_reason==='string') finished=choice.finish_reason;
          if (!isRecord(choice.delta)) continue;
          const delta=choice.delta;
          if (typeof delta.refusal === 'string' && delta.refusal) throw Error('OpenRouter response was refused by the selected model');
          if (delta.content !== undefined && delta.content !== null && typeof delta.content !== 'string') throw Error('Unsupported OpenRouter response content');
          if (typeof delta.content==='string' && delta.content) {text+=delta.content;yield {type:'text_delta',text:delta.content};}
          if (delta.tool_calls !== undefined) {
            if (!Array.isArray(delta.tool_calls)) throw Error('Invalid OpenRouter tool call');
            for (const part of delta.tool_calls) {
              if (!isRecord(part) || typeof part.index!=='number' || !Number.isSafeInteger(part.index) || part.index<0 || part.index>127) throw Error('Invalid OpenRouter tool call');
              const call=calls.get(part.index) ?? {id:'',name:'',args:''};
              if (typeof part.id==='string') call.id+=part.id;
              if (part.type !== undefined && part.type !== 'function') throw Error('Unsupported OpenRouter tool call');
              if (isRecord(part.function)) {
                if (typeof part.function.name==='string') call.name+=part.function.name;
                if (typeof part.function.arguments==='string') call.args+=part.function.arguments;
              }
              calls.set(part.index,call);
            }
          }
        }
      }
      if (chunk.done) break;
    }
    if (!done || !finished) throw Error('OpenRouter response was interrupted; retry the message');
    if (finished !== 'stop' && finished !== 'tool_calls') throw Error(`OpenRouter response did not complete (${finished === 'length' ? 'output limit reached' : 'provider stopped generation'}); retry or choose another model`);
    const toolCalls: ToolCall[]=[...calls.entries()].sort(([a],[b])=>a-b).map(([,call])=>({id:call.id,type:'function',function:{name:call.name,arguments:call.args}}));
    if ((finished==='tool_calls') !== (toolCalls.length>0) || toolCalls.some(call=>!call.id || !call.function.name || !call.function.arguments)) throw Error('Incomplete OpenRouter tool call; retry or choose a model that supports tools');
    if (!toolCalls.length && !text) throw Error('OpenRouter response contained no supported text; retry or choose another model');
    const usage=httpUsage(usageBody,'openrouter');
    const message:AssistantMessage=toolCalls.length ? {role:'assistant',content:text || null,tool_calls:toolCalls,usage} : {role:'assistant',content:text,usage};
    yield {type:'message',message};
  } catch (error) {
    options?.signal?.throwIfAborted();
    if (signal.aborted) throw Error('OpenRouter connection timed out; retry');
    if (error instanceof Error && (error.message.startsWith('OpenRouter') || error.message.startsWith('Invalid OpenRouter') || error.message.startsWith('Incomplete OpenRouter') || error.message.startsWith('Unsupported OpenRouter'))) throw error;
    throw Error('OpenRouter connection interrupted; retry the message');
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}
