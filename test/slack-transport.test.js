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
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,[{eventId:'Ev1',teamId:'T123',userId:'U123',channelId:'D123',text:'hello',threadTs:'123.4'}]);
  assert.deepEqual(socket.sent.map(x=>x.envelope_id).sort(),['one','three','two']);
  await slackTransport.post(tokens,{channel:'D123',threadTs:'123.4',text:'reply'});
  assert.deepEqual(requests.at(-1),{url:'https://slack.com/api/chat.postMessage',authorization:'Bearer xoxb-synthetic',body:{channel:'D123',text:'reply',unfurl_links:false,unfurl_media:false,thread_ts:'123.4'}});
  stop();
 }finally{globalThis.fetch=originalFetch;globalThis.WebSocket=OriginalWebSocket;}
});
