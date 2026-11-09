import {z} from 'zod';

export type SlackTokens={appToken:string;botToken:string};
export type SlackEvent={eventId:string;teamId:string;userId:string;channelId:string;text:string;threadTs?:string;messageTs?:string};
export class SlackRateLimited extends Error {
 constructor(readonly retryAfterMs:number) {super('Slack rate limited the request');}
}
export interface SlackTransport {
 identify(tokens:SlackTokens):Promise<{teamId:string;botUserId:string}>;
 start(tokens:SlackTokens,receive:(event:SlackEvent)=>Promise<void>,status?:(status:'connected'|'reconnecting')=>void):Promise<()=>void>;
 post(tokens:SlackTokens,message:{channel:string;threadTs?:string;text:string}):Promise<void>;
}
const apiResult=z.object({ok:z.boolean(),team_id:z.string().optional(),user_id:z.string().optional(),url:z.string().optional()});
async function api(method:string,token:string,body:object) {
 const response=await fetch('https://slack.com/api/'+method,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(response.status===429) {const seconds=Number(response.headers.get('retry-after'));throw new SlackRateLimited(Number.isFinite(seconds) && seconds>0 ? Math.min(seconds*1000,3600000) : 30000);}
 if(!response.ok)throw Error('Slack request failed');
 const result=apiResult.parse(await response.json());if(!result.ok)throw Error('Slack rejected the request');return result;
}
const envelope=z.object({type:z.string(),envelope_id:z.string().optional(),payload:z.unknown().optional()});
const eventPayload=z.object({event_id:z.string(),team_id:z.string(),event:z.object({type:z.string(),channel_type:z.string().optional(),channel:z.string().optional(),user:z.string().optional(),text:z.string().optional(),thread_ts:z.string().optional(),ts:z.string().optional(),subtype:z.string().optional(),bot_id:z.string().optional()})});
export const slackTransport:SlackTransport={
 async identify(tokens){const result=await api('auth.test',tokens.botToken,{});if(!result.team_id || !result.user_id)throw Error('Slack identity unavailable');return {teamId:result.team_id,botUserId:result.user_id};},
 async start(tokens,receive,status){
  let stopped=false,socket:WebSocket|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  async function connect() {
   const result=await api('apps.connections.open',tokens.appToken,{});if(!result.url)throw Error('Slack socket URL unavailable');
   const url=new URL(result.url);if(url.protocol!=='wss:' || !(url.hostname==='slack.com' || url.hostname.endsWith('.slack.com')))throw Error('Invalid Slack socket URL');
   if(stopped)return;
   socket=new WebSocket(url);const current=socket;
   current.addEventListener('open',()=>{if(!stopped)status?.('connected');});
   current.addEventListener('message',message=>{
    let value:unknown;try{value=JSON.parse(String(message.data));}catch{return;}
    const parsed=envelope.safeParse(value);if(!parsed.success)return;
    const item=parsed.data,decoded=eventPayload.safeParse(item.payload),payload=decoded.success?decoded.data:undefined,event=payload?.event;
    if(item.type==='events_api' && payload && event && event.type==='message' && event.channel_type==='im' && !event.subtype && !event.bot_id && event.user && event.channel && event.text) {
      const accepted:SlackEvent={eventId:payload.event_id,teamId:payload.team_id,userId:event.user,channelId:event.channel,text:event.text,...(event.thread_ts?{threadTs:event.thread_ts}:{}),...(event.ts?{messageTs:event.ts}:{})};
      void receive(accepted).then(()=>{if(item.envelope_id && current.readyState===WebSocket.OPEN)current.send(JSON.stringify({envelope_id:item.envelope_id}));}).catch(()=>{});
    } else if(item.envelope_id && current.readyState===WebSocket.OPEN)current.send(JSON.stringify({envelope_id:item.envelope_id}));
   });
   current.addEventListener('close',()=>{if(!stopped)status?.('reconnecting');if(!stopped)timer=setTimeout(()=>{void connect().catch(retry);},3000);});
   current.addEventListener('error',()=>current.close());
  }
  function retry(){if(!stopped)timer=setTimeout(()=>{void connect().catch(retry);},3000);}
  try {await connect();} catch {if(!stopped){status?.('reconnecting');retry();}}
  return ()=>{stopped=true;if(timer)clearTimeout(timer);socket?.close();};
 },
 async post(tokens,message){await api('chat.postMessage',tokens.botToken,{channel:message.channel,text:message.text,unfurl_links:false,unfurl_media:false,...(message.threadTs?{thread_ts:message.threadTs}:{})});},
};
