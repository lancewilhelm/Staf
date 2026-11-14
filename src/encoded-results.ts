import type {Message, RuntimeEvent} from './types.js';

const encodedActions=new Set(['file_read','terminal_read','code_mode','run_scratch_shell']);
const fixedToolResults=new Set(['Previously loaded skill content is not reloaded in this turn. Select an available skill again if needed.','Tool error: arguments cannot be retained faithfully under the instance redaction rules.','Tool not executed: action admission is closed.','Tool not executed because owner input is pending.','Tool not executed after private Gmail data was read in this turn.','Tool error: capability is not offered for this work','Tool not executed: task stopped or failed.']);
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
    if(scanStrings && typeof item==='string')for(const match of item.matchAll(/[A-Za-z0-9+/]{2,}={0,2}/g)){
      const run=match[0].replace(/=+$/,'');
      for(let offset=0;offset<4 && offset<run.length;offset++){
        const length=run.length-offset;if(length<2)continue;
        const bytes=Buffer.from(run.slice(offset,offset+length),'base64'),decoded=bytes.toString('utf8');if(run.length>=16)checkPartial(bytes);
        if(redact(decoded)!==decoded)throw Error('Encoded action result contains a known secret');
      }
    }
    if(scanStrings && typeof item==='string' && /^[\[{]/.test(item)){try{const nested:unknown=JSON.parse(item);inspect(nested,depth+1);}catch(error){if(!(error instanceof SyntaxError))throw error;}}
    if(Array.isArray(item)){for(const child of item)inspect(child,depth+1);return;}
    if(!item || typeof item!=='object')return;
    const record=item as Record<string,unknown>;
    if(record.encoding==='base64'){
      const values=typeof record.data==='string'?[record.data]:Array.isArray(record.chunks)?record.chunks.map(chunk=>chunk && typeof chunk==='object' ? (chunk as Record<string,unknown>).data : undefined):[];
      if(!values.length && record.data!==undefined)throw Error('Encoded action result cannot be checked safely');
      const buffers:Buffer[]=[];
      for(const text of values){if(typeof text!=='string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))throw Error('Encoded action result cannot be checked safely');buffers.push(Buffer.from(text,'base64'));}
      const bytes=Buffer.concat(buffers),decoded=bytes.toString('utf8');if(Array.isArray(record.chunks) || typeof record.offset!=='number' || record.offset>0 || record.nextOffset!==null)checkPartial(bytes);if(redact(decoded)!==decoded)throw Error('Encoded action result contains a known secret');
    }
    for(const child of Object.values(record))inspect(child,depth+1);
  };
  inspect(value,0);
}

export function assertEncodedMessages(messages:Message[],redact:(text:string)=>string,historicalThrough=0,secrets:readonly string[]=[],guestCall?:(id:string)=>boolean|null):void {
  const calls=new Map<string,string>();
  for(const [index,message] of messages.entries()){
    if(message.role==='assistant')for(const call of message.tool_calls??[])calls.set(call.id,call.function.name);
    if(message.role==='tool' && encodedActions.has(calls.get(message.tool_call_id)??'')){
      if(fixedToolResults.has(message.content))continue;
      let value:unknown;try{value=JSON.parse(message.content);}catch{value=message.content;}
      const name=calls.get(message.tool_call_id);if(name==='code_mode' && guestCall?.(message.tool_call_id)===false)continue;assertEncodedResult(name==='code_mode'?guestPayload(value):value,redact,['code_mode','run_scratch_shell'].includes(name??''),index<historicalThrough?secrets:[]);
    }
  }
}
export function assertEncodedEvents(events:RuntimeEvent[],redact:(text:string)=>string,historicalThrough=0,secrets:readonly string[]=[],guestCall?:(id:string)=>boolean|null):void {
  for(const [index,event] of events.entries())if(event.type==='tool_result' && encodedActions.has(event.name)){
    let value:unknown;try{value=JSON.parse(event.content);}catch{continue;}
    if(event.name==='code_mode' && guestCall?.(event.id)===false)continue;assertEncodedResult(event.name==='code_mode'?guestPayload(value):value,redact,['code_mode','run_scratch_shell'].includes(event.name),index<historicalThrough?secrets:[]);
  }
}

/** Conservative in-flight fence when the set of known secrets has changed. */
export function assertEncodedGeneration(messages:Message[],changed:boolean):void {
  if(!changed)return;
  const calls=new Map<string,string>();
  const candidate=(value:unknown):boolean=>{
    if(typeof value==='string')return value.length>=8 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
    if(Array.isArray(value))return value.some(candidate);
    if(value && typeof value==='object'){const record=value as Record<string,unknown>;return record.encoding==='base64' || Object.values(record).some(candidate);}
    return false;
  };
  for(const message of messages){
    if(message.role==='assistant')for(const call of message.tool_calls??[])calls.set(call.id,call.function.name);
    if(message.role!=='tool')continue;
    const name=calls.get(message.tool_call_id);
    if(name==='file_read'||name==='terminal_read')throw Error('Known secrets changed after encoded output was produced');
    if(name==='code_mode'||name==='run_scratch_shell'){let value:unknown;try{value=JSON.parse(message.content);}catch{if(name!=='run_scratch_shell')throw Error('Encoded action result cannot be checked safely');value=message.content;}if(candidate(name==='code_mode'?guestPayload(value):value))throw Error('Known secrets changed after encoded output was produced');}
  }
}

/** A transformed guest result cannot be decoded reliably from its text. */
export function assertHistoricalGuestResults(messages:Message[],historicalThrough:number,hasSecrets:boolean,changed:boolean,encodedCall:(id:string)=>boolean|null):void {
  const calls=new Map<string,string>();
  for(const [index,message] of messages.entries()){
    if(message.role==='assistant')for(const call of message.tool_calls??[])calls.set(call.id,call.function.name);
    if(message.role!=='tool' || calls.get(message.tool_call_id)!=='code_mode' || fixedToolResults.has(message.content))continue;
    if(((index<historicalThrough && hasSecrets) || changed) && encodedCall(message.tool_call_id)!==false)throw Error('Encoded guest result cannot be safely replayed after secret changes');
  }
}
