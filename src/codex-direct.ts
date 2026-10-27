import {redactValue} from './config.js';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {AssistantMessage,Message,ToolDefinition,Provider,ProviderEvent,ProviderCallOptions,ResponseReplayItem,ResponseReplayContent} from './types.js';
import {directAccessToken} from './codex-direct-auth.js';
import {chatSystemMessage} from './prompts.js';
import {isRecord,isAssistantMessage} from './validation.js';
import {sanitizeMetrics,type UsageReport} from './usage.js';

export const DIRECT_RESPONSES_URL='https://api.openai.com/v1/responses';
const INSTRUCTIONS=chatSystemMessage.content;
/** Hermes-inspired boundaries: real message/function-call/output items, not one serialized transcript. */
export function responsesInput(messages:Message[],model:string):Record<string,unknown>[] {
 const input:Record<string,unknown>[]=[];
 for(const message of messages){
  if(message.role==='user'){input.push({role:'user',content:[{type:'input_text',text:message.content}]});continue;}
  if(message.role==='tool'){input.push({type:'function_call_output',call_id:message.tool_call_id,output:message.content});continue;}
  if(message.responseReplay?.provider==='codex-direct'&&message.responseReplay.model===model){// Reasoning input requires summary even when only encrypted replay was saved.
   input.push(...message.responseReplay.items.map(item=>item.type==='reasoning'?{...item,summary:[]}:item));continue;}
  if(message.content)input.push({role:'assistant',content:[{type:'output_text',text:message.content}]});
  for(const call of message.tool_calls||[])input.push({type:'function_call',call_id:call.id,name:call.function.name,arguments:call.function.arguments});
 }
 return input;
}
export function responsesRequest(messages:Message[],tools:ToolDefinition[],model:string,sessionId:string,effort='default') {
 const functions=tools.map(tool=>({type:'function',...tool.function})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
 const key='pck_'+createHash('sha256').update(JSON.stringify([sessionId,model,INSTRUCTIONS,functions])).digest('hex').slice(0,24);
 return {model,instructions:INSTRUCTIONS,input:responsesInput(messages,model),tools:functions,store:false,stream:true,include:['reasoning.encrypted_content'],prompt_cache_key:key,...(effort!=='default'?{reasoning:{effort}}:{})};
}
export function directUsage(response:Record<string,unknown>):UsageReport {
 const raw=isRecord(response.usage)?response.usage:{};
 const input=isRecord(raw.input_tokens_details)?raw.input_tokens_details:{};
 const output=isRecord(raw.output_tokens_details)?raw.output_tokens_details:{};
 const metrics=sanitizeMetrics({input:raw.input_tokens,output:raw.output_tokens,total:raw.total_tokens,cachedInput:input.cached_tokens,reasoningOutput:output.reasoning_tokens});
 return {scope:'request',status:Object.keys(metrics).length?'reported':'unavailable',source:'ChatGPT-plan direct Responses usage (inclusive input)',...(typeof response.model==='string'&&/^[A-Za-z0-9._:/@+-]{1,200}$/.test(response.model)?{model:response.model}:{}),metrics};
}
function finalMessage(response:Record<string,unknown>,model:string):AssistantMessage {
 if(response.status!=='completed'||!Array.isArray(response.output))throw Error('Direct response did not complete');
 const calls:NonNullable<AssistantMessage['tool_calls']>=[],items:ResponseReplayItem[]=[];let text='';const ids=new Set<string>();
 if(response.output.length>32)throw Error('Direct response output exceeds limit');
 for(const raw of response.output){if(!isRecord(raw))throw Error('Invalid direct output item');
  if(raw.status!==undefined&&raw.status!=='completed')throw Error('Direct output item did not complete');
  if(raw.type==='reasoning'){
   if(typeof raw.encrypted_content==='string'){if(raw.encrypted_content.length>262144)throw Error('Reasoning replay exceeds limit');items.push({type:'reasoning',...(typeof raw.id==='string'?{id:raw.id}:{}),encrypted_content:raw.encrypted_content});}
  }else if(raw.type==='message'){
   if(raw.role!=='assistant'||!Array.isArray(raw.content))throw Error('Invalid direct assistant item');
   const content:ResponseReplayContent[]=[];
   for(const part of raw.content){
    if(!isRecord(part))throw Error('Unsupported direct response content');
    if(part.type==='output_text'&&typeof part.text==='string'){text+=part.text;content.push({type:'output_text',text:part.text});}
    else if(part.type==='refusal'&&typeof part.refusal==='string'){text+=part.refusal;content.push({type:'refusal',refusal:part.refusal});}
    else throw Error('Unsupported direct response content');
   }
   if(raw.phase!==undefined&&raw.phase!==null&&!['commentary','final_answer'].includes(String(raw.phase)))throw Error('Invalid direct assistant phase');
   items.push({type:'message',role:'assistant',content,...(raw.phase==='commentary'||raw.phase==='final_answer'?{phase:raw.phase}:{})});
  }else if(raw.type==='function_call'){
   if(typeof raw.call_id!=='string'||!raw.call_id||typeof raw.name!=='string'||typeof raw.arguments!=='string'||ids.has(raw.call_id))throw Error('Invalid or duplicate direct tool call');ids.add(raw.call_id);
   calls.push({id:raw.call_id,type:'function',function:{name:raw.name,arguments:raw.arguments}});items.push({type:'function_call',call_id:raw.call_id,name:raw.name,arguments:raw.arguments});
  }else throw Error('Unsupported native output type; only Staf function tools are permitted');
 }
 const message:AssistantMessage={role:'assistant',content:text,...(calls.length?{tool_calls:calls}:{}),usage:directUsage(response),responseReplay:{provider:'codex-direct',model,items}};
 if(!isAssistantMessage(message)||!calls.length&&!text)throw Error('Direct response returned no usable assistant message');return message;
}
/** Bounded UTF-8/SSE parser; only response.completed commits tools/history. No HTTP retry. */
export async function* responseEvents(response:Response,model:string,signal?:AbortSignal):AsyncGenerator<ProviderEvent> {
 if(!response.body)throw Error('Direct response has no event stream');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',data:string[]=[],bytes=0,terminal=false;
 type OutputSlot={state:'announced'}|{state:'done';item:Record<string,unknown>};
 const outputItems=new Map<number,OutputSlot>();
 const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 const parse=(line:string):Record<string,unknown>|undefined=>{if(line===''){if(!data.length)return;const joined=data.join('\n');data=[];if(joined==='[DONE]')return;let raw:unknown;try{raw=JSON.parse(joined);}catch{throw Error('Invalid direct event JSON');}if(!isRecord(raw)||typeof raw.type!=='string')throw Error('Invalid direct event');return raw;}if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));return;};
 const check=(event:Record<string,unknown>):ProviderEvent|undefined=>{
  if(event.type==='response.output_text.delta'){if(typeof event.delta!=='string')throw Error('Invalid direct text delta');return {type:'text_delta',text:event.delta};}
  if(event.type==='response.output_item.added'||event.type==='response.output_item.done'){
   const index=event.output_index,item=event.item;
   if(typeof index!=='number'||!Number.isInteger(index)||index<0||index>=32||!isRecord(item))throw Error('Invalid direct output item event');
   const previous=outputItems.get(index);
   if(event.type==='response.output_item.added'){
    if(!previous)outputItems.set(index,{state:'announced'});
    return;
   }
   if(item.status!==undefined&&item.status!=='completed')throw Error('Direct output item did not complete');
   if(previous?.state==='done'&&!isDeepStrictEqual(previous.item,item))throw Error('Conflicting completed direct output item');
   outputItems.set(index,{state:'done',item});return;
  }
  if(['response.failed','response.incomplete','error'].includes(String(event.type)))throw Error('Direct stream failed or incomplete; no tools/history committed. Check plan permission, limits or model access.');
  if(event.type==='response.completed'){
   if(!isRecord(event.response))throw Error('Invalid terminal response');
   let final=event.response;
   if(final.status==='completed'&&Array.isArray(final.output)){
    if(final.output.length){
     for(const index of outputItems.keys())if(index>=final.output.length)throw Error('Terminal direct output omits observed item');
    }else if(outputItems.size){
     const output:Record<string,unknown>[]=[];
     for(const [index,slot] of [...outputItems].sort(([a],[b])=>a-b)){
      if(index!==output.length||slot.state!=='done')throw Error('Missing completed direct output item');
      output.push(slot.item);
     }
     final={...final,output};
    }
   }
   const message=finalMessage(final,model);terminal=true;return {type:'message',message};
  }
  return;
 };
 try{while(!terminal){signal?.throwIfAborted();const chunk=await reader.read();signal?.throwIfAborted();if(chunk.done){signal?.throwIfAborted();buffer+=decoder.decode();if(buffer){const event=parse(buffer.replace(/\r$/,''));if(event){const value=check(event);if(value)yield value;}}const event=parse('');if(event){const value=check(event);if(value)yield value;}break;}bytes+=chunk.value.byteLength;if(bytes>5*1024*1024)throw Error('Direct event stream exceeds limit');buffer+=decoder.decode(chunk.value,{stream:true});let end;while(!terminal&&(end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);const event=parse(line);if(event){signal?.throwIfAborted();const value=check(event);if(value)yield value;}}}if(!terminal)throw Error('Direct stream ended without response.completed; no tools/history committed');}
 finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function directCodexProvider(options:{model:string;sessionId:string;dataDir:string;reasoning?:string;request?:typeof fetch;token?:(signal?:AbortSignal)=>Promise<string>}):Provider {
 const request=options.request||fetch;
 const stream=async function*(messages:Message[],tools:ToolDefinition[],call:ProviderCallOptions={}):AsyncGenerator<ProviderEvent>{
  const signal=AbortSignal.any([AbortSignal.timeout(60000),...(call.signal?[call.signal]:[])]);signal.throwIfAborted();
  const token=await(options.token?options.token(signal):directAccessToken(options.dataDir,request,signal));signal.throwIfAborted();
  let response:Response;try{response=await request(DIRECT_RESPONSES_URL,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','User-Agent':'Staf/0.1'},body:JSON.stringify(responsesRequest(messages,tools,options.model,options.sessionId,options.reasoning)),signal});}catch{if(signal.aborted)throw Error('Direct request cancelled or timed out');throw Error('Direct Responses connection failed');}
  if(!response.ok)throw Error(`Direct Responses HTTP ${response.status}; check Staf direct sign-in, plan permission and model. No paid API fallback.`);
  let withheld='';
  const redact=(text:string)=>text.split(token).join('[REDACTED]');
  try{for await(const event of responseEvents(response,options.model,signal)){
    signal.throwIfAborted();
    if(event.type==='text_delta'){
      // Keep a token-length tail so a bearer echoed across SSE chunks cannot leak.
      withheld=redact(withheld+event.text);const ready=Math.max(0,withheld.length-token.length+1);
      if(ready){yield {type:'text_delta',text:withheld.slice(0,ready)};withheld=withheld.slice(ready);}
    }else if(event.type==='message'){
      if(withheld)yield {type:'text_delta',text:redact(withheld)};
      const message=redactValue(event.message,redact);if(!isAssistantMessage(message))throw Error('Cannot safely redact direct response');
      yield {type:'message',message};
    }else yield event;
  }}catch(error){if(signal.aborted)throw Error('Direct request cancelled or timed out');throw error;}
 };
 return {name:`codex-direct:${options.model}${options.reasoning&&options.reasoning!=='default'?':reasoning='+options.reasoning:''}`,capabilities:{toolCalls:true,incrementalText:true,transport:'responses'},stream,
  async complete(messages,tools,call){let final:AssistantMessage|undefined;for await(const event of stream(messages,tools,call))if(event.type==='message')final=event.message;if(!final)throw Error('Direct response missing final message');return final;}};
}
