import { z } from 'zod';
import type { Instance } from './instance.js';
import { ActionDenied, type Capability, type WorkContext } from './work-actions.js';

/** The callback is the existing trusted clock authorization flow, including prompts. */
export function clockCapability(instance:Instance, authorize:(work:WorkContext)=>Promise<void>):Capability<Record<string,never>,string> {
  const input=z.strictObject({});
  const result=z.string().datetime({offset:true});
  const allowed=(work:WorkContext)=>instance.clockDecision(work.botId,work.work.kind,work.work.id).outcome!=='block' && (work.work.kind!=='task' || instance.scheduleClockAllowed(work.work.id));
  return {
    name:'clock', definition:{type:'function',function:{name:'clock',description:'Read the current UTC time.',parameters:{type:'object',properties:{},additionalProperties:false}}},
    parseInput:value=>input.parse(value),parseResult:value=>result.parse(value),
    describe:()=>({summary:'Read UTC clock',resource:'utc',effect:'read'}),
    eligible:allowed,check:(_input,work)=>{if(!allowed(work))throw Error('Clock is no longer authorized');},
    authorize:async (_input,work)=>{try {await authorize(work);} catch(error) {if(error instanceof Error && error.message==='Clock approval denied')throw new ActionDenied('Clock approval denied');throw error;}},execute:async()=>new Date().toISOString(),visibleResult:value=>value,
  };
}
