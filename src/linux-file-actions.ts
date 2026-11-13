import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {z} from 'zod';
import {jsonValue} from './code-mode/json.js';
import {fileCapabilities,validateFilePage} from './file-actions.js';
import {isolatedFileRequest} from './linux-file-client.js';
import {isolatedWorkingDirectory,type LinuxHostBoundary} from './linux-host-boundary.js';
import {ActionFailed,type Capability,type WorkContext} from './work-actions.js';

const sha=z.string().regex(/^[a-f0-9]{64}$/);
const readResult=z.strictObject({data:z.string().max(512*1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),start:z.number().int().nonnegative(),index:z.number().int().nonnegative(),size:z.number().int().nonnegative(),sha256:sha.nullable()});
const changed=z.strictObject({bytes:z.number().int().nonnegative(),sha256:sha,replacements:z.literal(1).optional()});
const searchResult=z.union([z.strictObject({kind:z.literal('names'),matches:z.array(z.string()).max(100),offset:z.number().int().nonnegative(),nextOffset:z.number().int().nonnegative().nullable()}),z.strictObject({kind:z.literal('content'),matches:z.array(z.number().int().nonnegative()).max(100),offset:z.number().int().nonnegative(),scannedBytes:z.number().int().nonnegative(),size:z.number().int().nonnegative(),nextOffset:z.number().int().nonnegative().nullable()})]);

export function isolatedFileCapabilities(boundary:LinuxHostBoundary,redact:(value:string)=>string,allowed:(work:WorkContext)=>boolean,readOverlap:()=>number) {
 const base=fileCapabilities(redact,allowed,readOverlap);
 const mapped=(work:WorkContext):WorkContext=>Object.freeze({...work,workingDirectory:boundary.workspace});
 function adapt<I,O>(capability:Capability<I,O>):Capability<I,O> {
  return {...capability,describe:(input,work)=>capability.describe(input,mapped(work)),...(capability.sameAction?{sameAction:(a:I,b:I,work:WorkContext)=>capability.sameAction!(a,b,mapped(work))}:{})};
 }
 const path=(input:string)=>isolatedWorkingDirectory(boundary.workspace,resolve(boundary.workspace,input));
 const target=(input:string)=>resolve(boundary.workspace,input);
 const request=(input:unknown,work:WorkContext)=>isolatedFileRequest(boundary,jsonValue.parse(input),work.signal);
 const read=adapt(base.read);
 read.execute=async(input,work)=>{
  const overlap=readOverlap();if(!Number.isSafeInteger(overlap)||overlap<0||overlap>65536)throw new ActionFailed('Credential boundary exceeds isolated file limit');
  const raw=readResult.parse(await request({kind:'read',path:path(input.path),offset:input.offset,limit:input.limit,overlap},work));
  const buffer=Buffer.from(raw.data,'base64');if(buffer.toString('base64')!==raw.data)throw new ActionFailed('Invalid isolated file result');
  const page=validateFilePage({buffer,start:raw.start,index:raw.index,offset:input.offset,limit:input.limit,redact,overlap});const end=input.offset+page.length;
  return {path:target(input.path),encoding:'base64',data:page.toString('base64'),offset:input.offset,bytes:page.length,size:raw.size,nextOffset:end<raw.size?end:null,sha256:raw.sha256};
 };
 const write=adapt(base.write);
 write.execute=async(input,work)=>({path:target(input.path),...changed.parse(await request({kind:'write',path:path(input.path),content:input.content},work))});
 write.recovery={reconcile:async(input,evidence,work)=>{
  const parsed=z.strictObject({sha256:sha}).safeParse(evidence);if(!parsed.success || parsed.data.sha256!==createHash('sha256').update(input.content).digest('hex'))return false;
  try{return z.strictObject({matches:z.boolean()}).parse(await request({kind:'verify',path:path(input.path),sha256:parsed.data.sha256},work)).matches;}catch{return false;}
 }};
 const edit=adapt(base.edit);
 edit.execute=async(input,work)=>({path:target(input.path),...changed.parse(await request({kind:'edit',path:path(input.path),expectedHash:input.expectedHash,oldText:input.oldText,newText:input.newText},work))});
 const search=adapt(base.search);
 search.execute=async(input,work)=>{const found=searchResult.parse(await request({kind:'search',path:path(input.path),query:input.query,offset:input.offset,limit:input.limit},work));if(redact(JSON.stringify(found))!==JSON.stringify(found))throw new ActionFailed('File search cannot be retained safely');return {path:target(input.path),...found};};
 return {read,write,edit,search};
}
