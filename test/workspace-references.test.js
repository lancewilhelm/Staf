import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CommandReferences, workspaceReferenceSchema, parseWorkspaceReferences, resolvedReference, formatReferenceContext} from '../dist/workspace-references.js';
import {runTurn} from '../dist/runtime.js';

test('explicit source references preserve identities and captured excerpts', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE commands (id TEXT PRIMARY KEY); INSERT INTO commands VALUES (\'one\');');
    db.exec(workspaceReferenceSchema);
    const references = parseWorkspaceReferences([{kind:'session-message',sessionId:'old',messageId:'message-one'}]);
    const store = new CommandReferences(db);
    const original = 'Original source\n' + 'x'.repeat(7000);
    const captured = store.capture('one', references, reference => resolvedReference(reference, {title:'Older conversation',location:'message one',content:original}));
    assert.equal(captured[0].content.length, 6000);
    assert.match(captured[0].location, /first 6000 of/);
    assert.deepEqual(store.read('one'), captured);
    assert.equal(original.length, 7016);
    assert.match(formatReferenceContext(captured), /untrusted data/);
    assert.match(formatReferenceContext(captured), /message-one/);
    assert.equal(formatReferenceContext([]), '');
  } finally { db.close(); }
});

test('source reference input rejects ambiguous identities and excessive selection', () => {
  assert.deepEqual(parseWorkspaceReferences(undefined), []);
  assert.deepEqual(parseWorkspaceReferences([{kind:'artifact-revision',artifactId:'report',revision:2,content:'ignored'}]), [{kind:'artifact-revision',artifactId:'report',revision:2}]);
  assert.throws(() => parseWorkspaceReferences([{kind:'artifact-revision',artifactId:'report',revision:0}]));
  assert.throws(() => parseWorkspaceReferences([{kind:'document-excerpt',documentId:'../outside',excerptId:'one'}]));
  assert.throws(() => parseWorkspaceReferences(Array.from({length:9}, (_,i) => ({kind:'session-message',sessionId:'old',messageId:String(i)}))));
  assert.throws(() => parseWorkspaceReferences([{kind:'session-message',sessionId:'old',messageId:'one'}, {kind:'session-message',sessionId:'old',messageId:'one'}]));
});

test('selected source context reaches the model without rewriting saved messages or replaying on a later turn', async () => {
  const source = resolvedReference({kind:'session-message',sessionId:'older-session',messageId:'source-message'}, {title:'An older session',location:'message 3',content:'source-only-fact synthetic-secret'});
  const requests = [];
  let saved;
  const provider = {name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'chat-completions'},async complete(messages) {
    requests.push(structuredClone(messages));
    return requests.length === 1
      ? {role:'assistant',content:null,tool_calls:[{id:'clock-one',function:{name:'clock',arguments:'{}'}}]}
      : {role:'assistant',content:'A fixture answer'};
  }};
  await runTurn({session:{version:1,id:'fresh',provider:null,messages:[],events:[]},store:{async save(value){saved=structuredClone(value)}},provider,text:'Use my selected source',references:[source],redact:text=>text.replaceAll('synthetic-secret','[redacted]')});
  assert.equal(requests.length,2);
  for (const request of requests) {
    const user = request.find(message=>message.role==='user');
    assert.match(user.content,/source-only-fact \[redacted\]/);
    assert.match(user.content,/older-session/);
    assert.equal(user.content.split('source-only-fact').length,2);
    assert.doesNotMatch(user.content,/synthetic-secret/);
  }
  assert.doesNotMatch(JSON.stringify(saved),/source-only-fact/);
  assert.equal(saved.messages[0].content,'Use my selected source');
  await runTurn({session:saved,store:{async save(value){saved=value}},provider,text:'A separate turn'});
  assert.doesNotMatch(JSON.stringify(requests.at(-1)),/source-only-fact/);
});
