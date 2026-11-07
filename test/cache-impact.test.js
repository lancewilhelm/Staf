import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profileAffectsCache} from '../dist/cache-impact.js';
import {responsesRequest} from '../dist/codex-direct.js';

const base={provider:'codex',model:'model-a',reasoning:null,instructions:'soul',toolMode:'direct'};
test('cache feedback tracks request inputs, not cosmetic or creation defaults',()=>{
 const changed=edit=>profileAffectsCache(base,{...base,...edit});
 assert.equal(changed({}),false);
 assert.equal(changed({name:'new name'}),false);
 for(const edit of [{instructions:'new soul'},{toolMode:'hybrid'},{provider:'openrouter'},{model:'model-b'},{reasoning:'high'}])assert.equal(changed(edit),true);
 for(const provider of ['demo','live','lmstudio']) {
  const profile={...base,provider};
  assert.equal(profileAffectsCache(profile,{...profile,reasoning:'high'}),false);
 }
 assert.equal(profileAffectsCache({...base,provider:'live'},{...base,provider:'live',model:'other'}),false);
 assert.equal(profileAffectsCache({...base,provider:'demo'},{...base,provider:'demo',instructions:'other',toolMode:'code',model:'other'}),false);
});
test('direct local cache key tracks model, instructions and tools, but not reasoning',()=>{
 const messages=[{role:'user',content:'hello'}], tool={type:'function',function:{name:'clock',description:'Read time',parameters:{type:'object',properties:{}}}};
 const request=(model,instructions,tools,reasoning='default')=>responsesRequest(messages,tools,model,'session',reasoning,instructions);
 const first=request('a','core and soul',[tool]);
 assert.notEqual(first.prompt_cache_key,request('b','core and soul',[tool]).prompt_cache_key);
 assert.notEqual(first.prompt_cache_key,request('a','changed core and soul',[tool]).prompt_cache_key);
 assert.notEqual(first.prompt_cache_key,request('a','core and soul',[]).prompt_cache_key);
 const effort=request('a','core and soul',[tool],'high');assert.equal(first.prompt_cache_key,effort.prompt_cache_key);assert.notDeepEqual(first,effort);
});
