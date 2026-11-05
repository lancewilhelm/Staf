import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ActionFailed, type Capability, type WorkActionService, type WorkContext} from './work-actions.js';
import type {ToolParameter} from './types.js';

export type TaskActionHooks = {
  clarify(question:string):Promise<string>;
  discover?(query:string):string;
  delegate?(request:{callId:string;helperId:string;objective:string;context:string}):Promise<string>;
  answerBot?(request:{callId:string;assignmentId:string;questionId:string;answer:string}):Promise<string>;
};

/** Hooks are installed for the lifetime of the actual executing attempt. */
export function registerTaskCapabilities(registry:WorkActionService,hooks:Map<string,TaskActionHooks>,redact:(text:string)=>string):void {
  const text=(max:number)=>z.string().refine(value=>Buffer.byteLength(value,'utf8')<=max).refine(value=>redact(value)===value,{message:'Input cannot be retained safely'});
  const required=(max:number)=>text(max).refine(value=>!!value.trim());
  const prop:ToolParameter={type:'string'};
  function register<I>(name:string,description:string,schema:z.ZodType<I>,keys:string[],eligible:(hook:TaskActionHooks)=>boolean,effect:'read'|'change',execute:(hook:TaskActionHooks,input:I)=>Promise<string>) {
    const find=(work:WorkContext)=>work.work.kind==='task'?hooks.get(work.work.id):undefined;
    const allowed=(work:WorkContext)=>{const hook=find(work);return !!hook && eligible(hook);};
    const cap:Capability<I,string>={name,definition:{type:'function',function:{name,description,parameters:{type:'object',properties:Object.fromEntries(keys.map(key=>[key,prop])),required:keys,additionalProperties:false}}},
      parseInput:value=>schema.parse(value),parseResult:value=>z.string().parse(value),
      describe:()=>({summary:description,resource:'task',effect}),eligible:allowed,check:(_input,work)=>{if(!allowed(work))throw Error('Task control is no longer authorized');},authorize:async()=>{},
      execute:async(input,work)=>{const hook=find(work);if(!hook || !eligible(hook))throw new ActionFailed('Task control is no longer available');return execute(hook,input);},visibleResult:value=>redact(value)};
    registry.register(cap);
  }
  register('ask_owner','Ask a question needed to continue this task.',z.strictObject({question:required(10000)}),['question'],()=>true,'change',(hook,input)=>hook.clarify(input.question));
  register('discover_bots','Find potential helpers by name and description.',z.strictObject({query:text(1024)}),['query'],hook=>!!hook.discover,'read',async(hook,input)=>hook.discover!(input.query));
  register('request_bot_help','Request help from an agent by exact ID.',z.strictObject({helperId:required(1024),objective:required(8000),context:required(8000)}),['helperId','objective','context'],hook=>!!hook.delegate,'change',(hook,input)=>hook.delegate!({...input,callId:randomUUID()}));
  register('answer_bot','Answer an actual helper question.',z.strictObject({assignmentId:required(1024),questionId:required(1024),answer:required(8000)}),['assignmentId','questionId','answer'],hook=>!!hook.answerBot,'change',(hook,input)=>hook.answerBot!({...input,callId:randomUUID()}));
}
