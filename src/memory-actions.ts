import { z } from 'zod';
import type { Instance } from './instance.js';
import { redactValue } from './config.js';
import { MemoryConflict, type MemoryScope } from './memory.js';
import { ActionFailed, type Capability, type WorkActionService, type WorkContext } from './work-actions.js';
import { jsonValue, type Json } from './code-mode/json.js';
import type { ToolDefinition, ToolParameter } from './types.js';

const scope=z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('agent')}),z.strictObject({kind:z.literal('user')})]);
const id=z.string().trim().min(1).max(256);
const text=z.string().trim().min(1).max(4000);
const version=z.number().int().positive().safe();
type Scope=z.infer<typeof scope>;
const storeScope=(value:Scope,work:WorkContext):MemoryScope=>value.kind==='user'?{kind:'user'}:{kind:'bot',botId:work.botId};
const scopeParameter:ToolParameter={type:'object',description:'Use {"kind":"agent"} for the executing agent, or {"kind":"user"} for shared memory.',properties:{kind:{type:'string',enum:['agent','user']}},required:['kind'],additionalProperties:false};
const str=(description:string):ToolParameter=>({type:'string',description});
const num=(description:string):ToolParameter=>({type:'integer',description});

/** Register once on the instance action service; both routes and future task callers share these operations. */
export function registerMemoryCapabilities(instance:Instance, registry:WorkActionService, redact:(value:string)=>string):void {
  const retainedText=text.transform(value=>{
    if(redact(value)!==value)throw new ActionFailed('Memory text cannot be shown faithfully under the instance redaction rules. Revise it before saving.');
    return value;
  });
  function capability<I>(name:string, description:string, schema:z.ZodType<I>, properties:Record<string,ToolParameter>, required:string[], effect:'read'|'change', execute:(input:I,work:WorkContext)=>Json):Capability<I,Json> {
    const definition:ToolDefinition={type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}};
    const allowed=(work:WorkContext)=>work.work.kind!=='task' || !instance.isHelperAttempt(work.work.id);
    return {name,definition,parseInput:value=>schema.parse(value),parseResult:value=>jsonValue.parse(value),
      describe:()=>({summary:description,resource:'memory',effect}),eligible:allowed,
      check:(_input,work)=>{if(!allowed(work))throw Error('Memory is no longer authorized');},authorize:async()=>{},
      execute:async(input,work)=>{try{return execute(input,work);}catch(error){if(error instanceof MemoryConflict)throw new ActionFailed('Memory changed or was not found in this scope. Refresh and use the current version.');throw error;}},
      visibleResult:output=>name==='memory_remember' && output && !Array.isArray(output) && typeof output==='object' && 'proposal' in output ? JSON.stringify(redactValue(output,redact)) : redact(effect==='read'?'Memory read completed':'Memory operation completed')};
  }
  function register<I>(value:Capability<I,Json>):void {registry.register(value);}
  const common={scope:scopeParameter};
  const find=(s:Scope,work:WorkContext,memoryId:string)=>instance.memories.list(storeScope(s,work)).find(item=>item.id===memoryId);
  register(capability('memory_search','Search retained memory within one scope.',z.strictObject({scope,query:z.string().trim().max(500),cursor:id.optional()}),{...common,query:str('Case-insensitive text to find; empty lists all.'),cursor:str('The next cursor from a previous page.')},['scope','query'],'read',(input,work)=>{
      const matches=instance.memories.list(storeScope(input.scope,work)).filter(item=>item.text.toLowerCase().includes(input.query.toLowerCase()));
      const index=input.cursor===undefined?0:matches.findIndex(item=>item.id===input.cursor)+1;
      if(input.cursor!==undefined && index===0)throw new ActionFailed('Memory search cursor is no longer available. Restart the search.');
      const items=matches.slice(index,index+20),nextCursor=index+20<matches.length?items.at(-1)?.id ?? null:null;
      return {items,nextCursor};
  }));
  register(capability('memory_read','Read a retained memory by ID and scope.',z.strictObject({scope,id}),{...common,id:str('Memory ID.')},['scope','id'],'read',(input,work)=>{
      const item=find(input.scope,work,input.id);if(!item)throw new ActionFailed('Memory was not found in this scope.');return item;
  }));
  register(capability('memory_remember','Save agent memory or propose shared user memory for owner confirmation.',z.strictObject({scope,text:retainedText}),{...common,text:str('Text to retain, up to 4000 characters.')},['scope','text'],'change',(input,work)=>{
    const value=input.text;
    return input.scope.kind==='agent'?instance.memories.create({scope:storeScope(input.scope,work),text:value}):{proposal:{...instance.proposeSharedMemory(work.botId,value),text:value},notice:'No shared memory was saved. The owner may send Confirm shared memory PROPOSAL_ID or Cancel shared memory PROPOSAL_ID in this agent chat.'};
  }));
  register(capability('memory_update','Update a retained memory using its current version.',z.strictObject({scope,id,version,text:retainedText}),{...common,id:str('Memory ID.'),version:num('Current version.'),text:str('Replacement text.')},['scope','id','version','text'],'change',(input,work)=>instance.memories.update({...input,scope:storeScope(input.scope,work)})));
  register(capability('memory_forget','Delete a retained memory using its current version.',z.strictObject({scope,id,version}),{...common,id:str('Memory ID.'),version:num('Current version.')},['scope','id','version'],'change',(input,work)=>{instance.memories.delete({...input,scope:storeScope(input.scope,work)});return {deleted:true,id:input.id};}));
  register(capability('memory_proposal_status','Inspect a shared memory proposal for this agent; only the owner can confirm or cancel it.',z.strictObject({id}),{id:str('Proposal ID.')},['id'],'read',(input,work)=>{const proposal=instance.sharedMemoryProposal(work.botId,input.id);if(!proposal)throw new ActionFailed('Proposal was not found for this agent.');return proposal;}));
}
