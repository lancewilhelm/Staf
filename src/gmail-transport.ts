import {z} from 'zod';
import {GmailHistoryExpired, type GmailHistoryTransport} from './gmail-history.js';

const profile=z.object({emailAddress:z.email(),historyId:z.string().regex(/^\d+$/)});
const historyPage=z.object({historyId:z.string().regex(/^\d+$/),nextPageToken:z.string().min(1).optional(),history:z.array(z.object({id:z.string().regex(/^\d+$/).optional(),messagesAdded:z.array(z.object({message:z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)})})).optional()})).optional()});

async function boundedJson(response:Response):Promise<unknown> {
  if(!response.body)throw Error('Gmail response was empty');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;if(bytes>2*1024*1024){await reader.cancel();throw Error('Gmail response exceeded the limit');}chunks.push(value);
    }
  } finally {reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** The caller owns OAuth, credential storage, and authorization at each request. */
export function gmailHistoryTransport({accessToken,request=fetch,signal,assertAuthority=()=>{}}:{accessToken:()=>Promise<string>;request?:typeof fetch;signal?:AbortSignal;assertAuthority?:()=>void}):GmailHistoryTransport {
  async function get(url:URL,history:boolean):Promise<unknown> {
    assertAuthority();const token=await accessToken();assertAuthority();signal?.throwIfAborted();
    if(!token || /\s/.test(token))throw Error('Gmail credentials unavailable');
    const response=await request(url,{headers:{Authorization:`Bearer ${token}`},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),redirect:'error'});
    if(history && response.status===404)throw new GmailHistoryExpired();
    if(!response.ok)throw Error(`Gmail request failed (HTTP ${response.status})`);
    return boundedJson(response);
  }
  return {
    async profile(){return profile.parse(await get(new URL('https://gmail.googleapis.com/gmail/v1/users/me/profile'),false));},
    async history({startHistoryId,pageToken}){
      const url=new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
      url.searchParams.set('startHistoryId',startHistoryId);url.searchParams.set('historyTypes','messageAdded');url.searchParams.set('maxResults','500');
      if(pageToken)url.searchParams.set('pageToken',pageToken);
      const page=historyPage.parse(await get(url,true));
      return {historyId:page.historyId,...(page.nextPageToken?{nextPageToken:page.nextPageToken}:{}),messageIds:(page.history??[]).flatMap(item=>(item.messagesAdded??[]).map(added=>added.message.id)),additions:(page.history??[]).flatMap(item=>(item.messagesAdded??[]).map(added=>({messageId:added.message.id,historyId:item.id??null})))};
    },
    async messageMetadata(messageId){
      const id=z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).parse(messageId);
      const url=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+id);
      url.searchParams.set('format','full');url.searchParams.set('fields','id,historyId,labelIds');
      return get(url,false);
    },
  };
}
