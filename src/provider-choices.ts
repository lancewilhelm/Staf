import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isRecord} from './validation.js';
import {AgentConfigConflict} from './agent-config.js';
export type ProviderChoice={model:string|null;reasoning:string|null};
export type ProviderChoices=Record<string,ProviderChoice>;
export function parseChoices(value:unknown):ProviderChoices {
 if(!isRecord(value))throw Error('Invalid provider choices');
 const result:ProviderChoices={};
 for(const [provider,pair] of Object.entries(value)){
  if(!['demo','codex','openrouter','lmstudio','live'].includes(provider)||!isRecord(pair)||Object.keys(pair).some(k=>!['model','reasoning'].includes(k)))throw Error('Invalid provider choice');
  const model=pair.model??null,reasoning=pair.reasoning??null;
  if(!(model===null||typeof model==='string')||!(reasoning===null||typeof reasoning==='string'))throw Error('Invalid provider choice');
  if(model!==null&&(!model.trim()||model.length>200||/[\x00-\x1f\x7f]/.test(model)||/sk-[A-Za-z0-9_-]+/i.test(model)))throw Error('Invalid model identifier');
  if(reasoning!==null&&!['default','none','minimal','low','medium','high','xhigh','max'].includes(reasoning))throw Error('Invalid reasoning choice');
  result[provider]={model,reasoning};
 }
 return result;
}
/** Nonsecret owner defaults. Reading and saving never contact a provider. */
export class ProviderDefaultsStore {
 constructor(private readonly root:string){}
 read(){const path=join(this.root,'provider-defaults.json');const text=existsSync(path)?readFileSync(path,'utf8'):'{}';return {revision:createHash('sha256').update(text).digest('hex'),providers:parseChoices(JSON.parse(text))};}
 set(revision:string,provider:string,pair:ProviderChoice){const current=this.read();if(current.revision!==revision)throw new AgentConfigConflict('Provider defaults changed. Refresh before editing.');const providers=parseChoices({...current.providers,[provider]:pair});mkdirSync(this.root,{recursive:true,mode:0o700});const path=join(this.root,`provider-defaults-${randomUUID()}.tmp`);writeFileSync(path,JSON.stringify(providers,null,2)+'\n',{mode:0o600});renameSync(path,join(this.root,'provider-defaults.json'));return this.read();}
}
