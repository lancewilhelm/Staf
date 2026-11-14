import type {Message, RuntimeEvent} from './types.js';

const encodedActions=new Set(['file_read','terminal_read','code_mode','run_scratch_shell']);
export const omittedEncodedOutput='Earlier tool output omitted because it cannot be safely checked against current credentials.';
const fixedToolResults=new Set([omittedEncodedOutput,'Previously loaded skill content is not reloaded in this turn. Select an available skill again if needed.','Tool error: arguments cannot be retained faithfully under the instance redaction rules.','Tool not executed: action admission is closed.','Tool not executed because owner input is pending.','Tool not executed after private Gmail data was read in this turn.','Tool error: capability is not offered for this work','Tool not executed: task stopped or failed.']);
const isFixedToolResult=(content:string,redact:(text:string)=>string):boolean=>fixedToolResults.has(content) || content===redact(omittedEncodedOutput);
function guestPayload(value:unknown):unknown {if(!value || typeof value!=='object' || Array.isArray(value))return value;const record=value as Record<string,unknown>;return {emitted:record.emitted,value:record.value};}

export function assertCurrentBytes(bytes:Buffer,redact:(text:string)=>string,secrets:readonly string[],partial:boolean):void {
  const text=bytes.toString('utf8');if(redact(text)!==text)throw Error('Encoded action result contains a known secret');
  if(partial && bytes.length)for(const secret of secrets)for(const variant of [secret,JSON.stringify(secret).slice(1,-1)]){const raw=Buffer.from(variant,'utf8');if(raw.includes(bytes[0]!) || raw.includes(bytes[bytes.length-1]!))throw Error('Encoded action result boundary cannot be checked safely');}
}

/** Inspect only structured capability results, never arbitrary chat text. */
export function assertEncodedResult(value:unknown,redact:(text:string)=>string,scanStrings=false,partialSecrets:readonly string[]=[]):void {
  const checkPartial=(bytes:Buffer)=>{
    if(!bytes.length)return;
    // Without the missing adjacent bytes, even a one-byte overlap can be part
    // of a credential. Reject rather than invent a boundary from encoded text.
    for(const secret of partialSecrets)for(const variant of [secret,JSON.stringify(secret).slice(1,-1)]){const raw=Buffer.from(variant,'utf8');if(raw.includes(bytes[0]!) || raw.includes(bytes[bytes.length-1]!))throw Error('Encoded action result boundary cannot be checked safely');}
  };
  const inspect=(item:unknown,depth:number):void=>{
    if(depth>32)throw Error('Encoded action result cannot be checked safely');
    if(scanStrings && typeof item==='string' && /^[\[{]/.test(item)){try{const nested:unknown=JSON.parse(item);inspect(nested,depth+1);}catch(error){if(!(error instanceof SyntaxError))throw error;}}
    if(Array.isArray(item)){for(const child of item)inspect(child,depth+1);return;}
    if(!item || typeof item!=='object')return;
    const record=item as Record<string,unknown>;
    if(record.encoding==='base64'){
      const hasData=record.data!==undefined,hasChunks=record.chunks!==undefined;if(hasData===hasChunks || (hasData && typeof record.data!=='string') || (hasChunks && !Array.isArray(record.chunks)))throw Error('Encoded action result cannot be checked safely');
      const parts=typeof record.data==='string'?[{stream:'',data:record.data}]:Array.isArray(record.chunks)?record.chunks.map(chunk=>chunk && typeof chunk==='object' ? chunk as Record<string,unknown> : {}):[];
      const streams=new Map<string,Buffer[]>();
      for(const part of parts){const text=part.data,stream=part.stream===undefined?'':part.stream;if(typeof text!=='string' || typeof stream!=='string' || (Array.isArray(record.chunks) && !['stdout','stderr','terminal'].includes(stream)) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))throw Error('Encoded action result cannot be checked safely');const values=streams.get(stream)??[];values.push(Buffer.from(text,'base64'));streams.set(stream,values);}
      for(const values of streams.values()){const bytes=Buffer.concat(values),decoded=bytes.toString('utf8');if(Array.isArray(record.chunks) || typeof record.offset!=='number' || record.offset>0 || record.nextOffset!==null)checkPartial(bytes);if(redact(decoded)!==decoded)throw Error('Encoded action result contains a known secret');}
    }
    for(const child of Object.values(record))inspect(child,depth+1);
  };
  inspect(value,0);
}

/** Omit only unsafe historical capability payloads; ordinary messages stay intact. */
export function omitUnsafeHistoricalMessages(messages:Message[],historicalThrough:number,redact:(text:string)=>string,secrets:readonly string[],guestCall?:(id:string)=>boolean|null):Message[] {
  const calls=new Map<string,string>();
  return messages.map((message,index)=>{
    if(message.role==='assistant')for(const call of message.tool_calls??[])calls.set(call.id,call.function.name);
    if(index>=historicalThrough || message.role!=='tool' || isFixedToolResult(message.content,redact))return message;
    const name=calls.get(message.tool_call_id);if(!name || !encodedActions.has(name))return message;
    let value:unknown;try{value=JSON.parse(message.content);}catch{if(secrets.length && (name==='file_read' || name==='terminal_read' || name==='code_mode'))return {...message,content:redact(omittedEncodedOutput)};value=message.content;}
    if((name==='file_read' || name==='terminal_read') && value && typeof value==='object' && !Array.isArray(value)){const record=value as Record<string,unknown>;if(record.encoding!=='base64' && !['status','blocked','repeat-required','revision-requested'].includes(String(record.kind)))return {...message,content:redact(omittedEncodedOutput)};}
    if(name==='code_mode' && guestCall?.(message.tool_call_id)!==false && (redact('encoding')!=='encoding' || redact('base64')!=='base64'))return {...message,content:redact(omittedEncodedOutput)};
    try{assertEncodedResult(name==='code_mode'?guestPayload(value):value,redact,['code_mode','run_scratch_shell'].includes(name),secrets);return message;}catch{return {...message,content:redact(omittedEncodedOutput)};}
  });
}
export function omitUnsafeHistoricalEvents(events:RuntimeEvent[],historicalThrough:number,redact:(text:string)=>string,secrets:readonly string[],guestCall?:(id:string)=>boolean|null):RuntimeEvent[] {
  return events.map((event,index)=>{
    if(index>=historicalThrough || event.type!=='tool_result' || !encodedActions.has(event.name) || isFixedToolResult(event.content,redact))return event;
    let value:unknown;try{value=JSON.parse(event.content);}catch{return !secrets.length || event.name==='run_scratch_shell'?event:{...event,content:redact(omittedEncodedOutput)};}
    if((event.name==='file_read' || event.name==='terminal_read') && event.success && value && typeof value==='object' && !Array.isArray(value) && (value as Record<string,unknown>).encoding!=='base64')return {...event,content:redact(omittedEncodedOutput)};
    if(event.name==='code_mode' && guestCall?.(event.id)!==false && (redact('encoding')!=='encoding' || redact('base64')!=='base64'))return {...event,content:redact(omittedEncodedOutput)};
    try{assertEncodedResult(event.name==='code_mode'?guestPayload(value):value,redact,['code_mode','run_scratch_shell'].includes(event.name),secrets);return event;}catch{return {...event,content:redact(omittedEncodedOutput)};}
  });
}

export function assertEncodedMessages(messages:Message[],redact:(text:string)=>string,historicalThrough=0,secrets:readonly string[]=[]):void {
  const calls=new Map<string,string>();
  for(const [index,message] of messages.entries()){
    if(message.role==='assistant')for(const call of message.tool_calls??[])calls.set(call.id,call.function.name);
    if(message.role==='tool' && encodedActions.has(calls.get(message.tool_call_id)??'')){
      if(isFixedToolResult(message.content,redact))continue;
      let value:unknown;try{value=JSON.parse(message.content);}catch{value=message.content;}
      const name=calls.get(message.tool_call_id);assertEncodedResult(name==='code_mode'?guestPayload(value):value,redact,['code_mode','run_scratch_shell'].includes(name??''),index<historicalThrough?secrets:[]);
    }
  }
}
export function assertEncodedEvents(events:RuntimeEvent[],redact:(text:string)=>string,historicalThrough=0,secrets:readonly string[]=[]):void {
  for(const [index,event] of events.entries())if(event.type==='tool_result' && encodedActions.has(event.name)){
    let value:unknown;try{value=JSON.parse(event.content);}catch{continue;}
    assertEncodedResult(event.name==='code_mode'?guestPayload(value):value,redact,['code_mode','run_scratch_shell'].includes(event.name),index<historicalThrough?secrets:[]);
  }
}

/** Conservative in-flight fence when the set of known secrets has changed. */
export function assertEncodedGeneration(messages:Message[],changed:boolean,historicalThrough=0):void {
  if(!changed)return;
  const calls=new Map<string,string>();
  for(const [index,message] of messages.entries()){
    if(message.role==='assistant')for(const call of message.tool_calls??[])calls.set(call.id,call.function.name);
    if(index<historicalThrough || message.role!=='tool' || fixedToolResults.has(message.content))continue;
    const name=calls.get(message.tool_call_id);
    if(name==='file_read'||name==='terminal_read')throw Error('Known secrets changed after encoded output was produced');
  }
}

/** Guest code can transform a fresh encoded receipt; fence it only while the turn is in flight. */
export function assertPendingGuestResults(messages:Message[],historicalThrough:number,changed:boolean,encodedCall:(id:string)=>boolean|null):void {
  const calls=new Map<string,string>();
  for(const [index,message] of messages.entries()){
    if(message.role==='assistant')for(const call of message.tool_calls??[])calls.set(call.id,call.function.name);
    if(message.role!=='tool' || calls.get(message.tool_call_id)!=='code_mode' || fixedToolResults.has(message.content))continue;
    if(index>=historicalThrough && changed && encodedCall(message.tool_call_id)!==false)throw Error('Encoded guest result cannot be safely replayed after secret changes');
  }
}
