import test from 'node:test';
import assert from 'node:assert/strict';
import {gmailSetupQuestions,parseGmailSetupDraft} from '../dist/gmail-setup.js';

test('guided Gmail drafts keep secret steps separate and request only chosen Google scopes',()=>{
 assert.deepEqual(gmailSetupQuestions.questions.map(question=>question.kind),['text','text','secret','multiple']);
 const account={choices:[],writeIn:'Owner@Example.test'},client={choices:[],writeIn:'synthetic-client'},scopes={choices:['Send replies after explicit approval'],writeIn:''};
 assert.deepEqual(parseGmailSetupDraft([account,client,null,scopes]),{email:'owner@example.test',clientId:'synthetic-client',sendEnabled:true,modifyEnabled:false});
 assert.deepEqual(parseGmailSetupDraft([account,client,null,null]),{email:'owner@example.test',clientId:'synthetic-client',sendEnabled:false,modifyEnabled:false});
 assert.throws(()=>parseGmailSetupDraft([account,client,{choices:[],writeIn:'synthetic-secret'},null]));
 assert.throws(()=>parseGmailSetupDraft([account,client,null,{choices:['unsupported'],writeIn:''}]));
 assert.throws(()=>parseGmailSetupDraft([null,client,null,null]));
});
