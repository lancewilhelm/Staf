import {test} from 'node:test';
import assert from 'node:assert/strict';
import {slackTransport} from '../dist/slack.js';

test('Socket Mode accepts only plain DMs and acknowledges envelopes; posting uses the configured conversation',async()=>{
 const originalFetch=globalThis.fetch,OriginalWebSocket=globalThis.WebSocket,requests=[],events=[];let socket;
 class FakeSocket extends EventTarget {
  static OPEN=1;readyState=1;sent=[];
  constructor(url){super();this.url=String(url);socket=this;}
  send(text){this.sent.push(JSON.parse(text));}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
  incoming(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
 }
 globalThis.WebSocket=FakeSocket;
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),authorization:options.headers.Authorization,body:JSON.parse(options.body)});return new Response(JSON.stringify(String(url).endsWith('apps.connections.open')?{ok:true,url:'wss://wss.slack.com/link/?ticket=fixture'}:String(url).endsWith('auth.test')?{ok:true,team_id:'T123',user_id:'B123'}:{ok:true}),{status:200});};
 try{
  const tokens={appToken:'xapp-synthetic',botToken:'xoxb-synthetic'};
  assert.deepEqual(await slackTransport.identify(tokens),{teamId:'T123',botUserId:'B123'});
  const stop=await slackTransport.start(tokens,async event=>{events.push(event)});
  const payload={event_id:'Ev1',team_id:'T123',event:{type:'message',channel_type:'im',channel:'D123',user:'U123',text:'hello',thread_ts:'123.4'}};
  socket.incoming({type:'events_api',envelope_id:'one',payload});
  socket.incoming({type:'events_api',envelope_id:'two',payload:{...payload,event:{...payload.event,channel_type:'channel'}}});
  socket.incoming({type:'events_api',envelope_id:'three',payload:{...payload,event:{...payload.event,subtype:'message_changed'}}});
  socket.incoming({type:'events_api',envelope_id:'four',payload:{...payload,event:{...payload.event,bot_id:'B123'}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,[{eventId:'Ev1',teamId:'T123',userId:'U123',channelId:'D123',text:'hello',threadTs:'123.4'}]);
  assert.deepEqual(socket.sent.map(x=>x.envelope_id).sort(),['four','one','three','two']);
  await slackTransport.post(tokens,{channel:'D123',threadTs:'123.4',text:'reply'});
  assert.deepEqual(requests.at(-1),{url:'https://slack.com/api/chat.postMessage',authorization:'Bearer xoxb-synthetic',body:{channel:'D123',text:'reply',unfurl_links:false,unfurl_media:false,thread_ts:'123.4'}});
  stop();
 }finally{globalThis.fetch=originalFetch;globalThis.WebSocket=OriginalWebSocket;}
});

test('HTTP 429 exposes a safe retry delay while other transport failures remain ambiguous',async()=>{
 const {SlackRateLimited}=await import('../dist/slack.js');const original=globalThis.fetch;const tokens={appToken:'xapp-synthetic',botToken:'xoxb-synthetic'};
 try{
  globalThis.fetch=async()=>new Response('',{status:429,headers:{'Retry-After':'2'}});
  await assert.rejects(slackTransport.post(tokens,{channel:'D123',text:'test'}),error=>error instanceof SlackRateLimited && error.retryAfterMs===2000);
  globalThis.fetch=async()=>{throw Error('connection lost')};
  await assert.rejects(slackTransport.post(tokens,{channel:'D123',text:'test'}),error=>!(error instanceof SlackRateLimited));
 }finally{globalThis.fetch=original;}
});

test('Socket Mode carries button identity and refuses malformed interactive messages',async()=>{
 const originalFetch=globalThis.fetch,OriginalWebSocket=globalThis.WebSocket,requests=[],interactions=[];let socket;
 class FakeSocket extends EventTarget {
  static OPEN=1;readyState=1;sent=[];
  constructor(){super();socket=this;}
  send(text){this.sent.push(JSON.parse(text));}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
  incoming(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
 }
 globalThis.WebSocket=FakeSocket;
 globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return Response.json(String(url).endsWith('apps.connections.open')?{ok:true,url:'wss://wss.slack.com/link'}:{ok:true});};
 try {
  const tokens={appToken:'xapp-synthetic',botToken:'xoxb-synthetic'};
  const stop=await slackTransport.start(tokens,async()=>{},undefined,async interaction=>{if(interaction.eventId==='failed')throw Error('Persistence unavailable');interactions.push(interaction)});
  const payload={type:'block_actions',team:{id:'T123'},user:{id:'U123'},channel:{id:'D123'},container:{channel_id:'D123',message_ts:'1.2'},actions:[{type:'button',action_id:'approve',value:'exact-control'}]};
  socket.incoming({type:'interactive',envelope_id:'one',payload});
  socket.incoming({type:'interactive',envelope_id:'two',payload:{...payload,container:{...payload.container,channel_id:'D999'}}});
  socket.incoming({type:'interactive',envelope_id:'three',payload:{...payload,actions:[...payload.actions,...payload.actions]}});
  socket.incoming({type:'interactive',envelope_id:'failed',payload});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(interactions,[{eventId:'one',teamId:'T123',userId:'U123',channelId:'D123',messageTs:'1.2',actionId:'approve',value:'exact-control'}]);
  assert.deepEqual(socket.sent.map(x=>x.envelope_id).sort(),['one','three','two']);
  await slackTransport.post(tokens,{channel:'D123',threadTs:'1.1',text:'Exact text',buttons:[{text:'Approve',actionId:'approve',value:'exact-control'}]});
  assert.deepEqual(requests.at(-1).blocks,[{type:'section',text:{type:'plain_text',text:'Exact text'}},{type:'actions',elements:[{type:'button',text:{type:'plain_text',text:'Approve'},action_id:'approve',value:'exact-control'}]}]);
  stop();
 } finally {globalThis.fetch=originalFetch;globalThis.WebSocket=OriginalWebSocket;}
});
test('Slack honors a two-hour Retry-After without truncation',async()=>{
 const {SlackRateLimited}=await import('../dist/slack.js');const original=globalThis.fetch;
 try {globalThis.fetch=async()=>new Response('',{status:429,headers:{'retry-after':'7200'}});await assert.rejects(slackTransport.post({appToken:'xapp-synthetic',botToken:'xoxb-synthetic'},{channel:'D123',text:'test'}),error=>error instanceof SlackRateLimited && error.retryAfterMs===7200000);}finally{globalThis.fetch=original;}
});
test('invalid or unrepresentable Retry-After fails closed',async()=>{
 const {SlackRateLimited}=await import('../dist/slack.js');const original=globalThis.fetch;
 try {for(const header of [null,'-1','1e100','999999999999999999999']){globalThis.fetch=async()=>new Response('',{status:429,...(header===null?{}:{headers:{'retry-after':header}})});await assert.rejects(slackTransport.post({appToken:'xapp-synthetic',botToken:'xoxb-synthetic'},{channel:'D123',text:'test'}),error=>error instanceof SlackRateLimited && error.retryAt(Date.now())===null);}}finally{globalThis.fetch=original;}
});
test('zero Retry-After is a valid immediate deadline',async()=>{
 const {SlackRateLimited}=await import('../dist/slack.js');const original=globalThis.fetch;
 try {globalThis.fetch=async()=>new Response('',{status:429,headers:{'retry-after':'0'}});await assert.rejects(slackTransport.post({appToken:'xapp-synthetic',botToken:'xoxb-synthetic'},{channel:'D123',text:'test'}),error=>error instanceof SlackRateLimited && error.retryAt(1000)===1000);}finally{globalThis.fetch=original;}
});
