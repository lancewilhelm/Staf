import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gmailHistoryTransport} from '../dist/gmail-transport.js';
import {GmailHistoryExpired} from '../dist/gmail-history.js';
import {GmailApi} from '../dist/gmail-api.js';

test('Gmail history requests retain message additions without filtering on current inbox state',async()=>{
  const requests=[];
  const request=async (url,options)=>{requests.push({url:new URL(url),options});return Response.json(requests.length===1?{emailAddress:'owner@example.test',historyId:'10'}:{historyId:'13',nextPageToken:'next',history:[{messages:[{id:'duplicate'}],messagesAdded:[{message:{id:'new'}}]}]});};
  const transport=gmailHistoryTransport({accessToken:async()=> 'synthetic-token',request});
  assert.equal((await transport.profile()).historyId,'10');
  assert.deepEqual(await transport.history({startHistoryId:'10'}),{historyId:'13',nextPageToken:'next',messageIds:['new']});
  const history=requests[1];assert.equal(history.url.origin,'https://gmail.googleapis.com');
  assert.equal(history.url.searchParams.get('labelId'),null);assert.equal(history.url.searchParams.get('historyTypes'),'messageAdded');
  assert.equal(history.url.searchParams.get('startHistoryId'),'10');assert.equal(history.options.headers.Authorization,'Bearer synthetic-token');
});

test('message reading excludes attachments and retains the inline plain text',async()=>{
  const encoded=value=>Buffer.from(value).toString('base64url');
  const request=async()=>Response.json({id:'m1',payload:{mimeType:'multipart/mixed',parts:[{mimeType:'text/plain',body:{data:encoded('visible text')}},{mimeType:'text/plain',filename:'private.txt',body:{data:encoded('attachment content')}},{mimeType:'text/plain',headers:[{name:'Content-Disposition',value:'attachment'}],body:{data:encoded('other attachment')}}]}});
  const api=new GmailApi(request,async()=> 'token',()=>{},new AbortController().signal),result=await api.read('m1');
  assert.equal(result.text,'visible text');assert.doesNotMatch(JSON.stringify(result),/attachment content|other attachment/);
});

test('an expired history response is distinct from other provider errors',async()=>{
  let status=404;const transport=gmailHistoryTransport({accessToken:async()=> 'synthetic-token',request:async()=>new Response('',{status})});
  await assert.rejects(transport.history({startHistoryId:'10'}),GmailHistoryExpired);
  status=401;await assert.rejects(transport.history({startHistoryId:'10'}),/Gmail request failed/);
});
