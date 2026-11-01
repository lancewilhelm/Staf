import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMemoryLanguage as parse} from '../dist/memory-language.js';

test('parses explicit descriptive previews and preserves literal target and scope',()=>{
 assert.deepEqual(parse('What do you remember about Green Tea?'),{kind:'preview',operation:'find',scope:'bot',query:'Green Tea'});
 assert.deepEqual(parse('Please find memories about Green Tea in shared memory'),{kind:'preview',operation:'find',scope:'shared',query:'Green Tea'});
 assert.deepEqual(parse('Forget the memory about tea in this bot memory'),{kind:'preview',operation:'delete',scope:'bot',query:'tea'});
 assert.deepEqual(parse('Correct my memory about coffee to I prefer tea in user memory'),{kind:'preview',operation:'edit',scope:'shared',query:'coffee',replacement:'I prefer tea'});
});

test('does not intercept ordinary chat, exact mutations or shared confirmations',()=>{
 for(const value of ['I remember tea','Forget the meeting','Change my tea preference','Confirm shared memory proposal-id','Cancel shared memory proposal-id','Forget memory 123 version 1 in this bot memory','Correct memory 123 version 1 in shared memory to tea'])assert.deepEqual(parse(value),{kind:'none'},value);
});

test('clarifies ambiguous qualifiers and never expands an excluded or foreign scope',()=>{
 for(const value of ['Forget the memory about tea except sugar','Find memories about tea for all bots','Find memories about tea in shared memory except Ada','Find memories about tea in Ada’s memory','Forget my memories about tea but not coffee','Find memories about tea in other bots memory','Find memories about tea for ada','Find memories about tea without Ada'])assert.equal(parse(value).kind,'clarify',value);
});

test('rejects ambiguous edits and oversized targets',()=>{
 for(const value of ['Change the memory about tea','Change the memory about tea to coffee to water','Change the memory about tea to'])assert.equal(parse(value).kind,'clarify',value);
 assert.deepEqual(parse('Find memories about '),{kind:'clarify',reason:'target'});
 assert.deepEqual(parse('Find memories about '+ 'x'.repeat(257)),{kind:'clarify',reason:'target'});
});
