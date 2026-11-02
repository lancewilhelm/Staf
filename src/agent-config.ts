import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import * as TOML from '@iarna/toml';

import {parseChoices,type ProviderChoices} from './provider-choices.js';

export type AgentSettings = {name:string; description:string; provider:string; model:string|null; reasoning:string|null; instructions:string; providerChoices?:ProviderChoices};
export type AgentConfig = AgentSettings & {revision:string; configDir:string};
export class AgentConfigConflict extends Error {}
export class AgentConfigInvalid extends Error {}
export class AgentConfigUncertain extends Error {}

function syncDirectory(path:string) {
  const fd=openSync(path,'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function writeDurable(path:string, text:string) {
  const fd=openSync(path,'wx',0o600);
  try { writeFileSync(fd,text,'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
}
function retireRevision(dir:string, revision:string, archived:boolean) {
  const marker=join(dir,`.retired-${randomUUID()}`);
  writeDurable(marker,JSON.stringify({revision,archived}));
  renameSync(marker,join(dir,'.retired'));syncDirectory(dir);
}
function parseSettings(data:ReturnType<typeof TOML.parse>, instructions:string):AgentSettings {
  const allowed=['name','description','provider','model','reasoning','providerChoices'];
  if (Object.keys(data).some(key=>!allowed.includes(key)) || typeof data.name!=='string' || !data.name.trim() || data.name.length>200 || typeof data.description!=='string' || Buffer.byteLength(data.description,'utf8')>4096 || typeof data.provider!=='string' || !['demo','codex','openrouter','lmstudio','live'].includes(data.provider) || !(data.model===undefined || typeof data.model==='string' && data.model.length<=200) || !(data.reasoning===undefined || typeof data.reasoning==='string' && data.reasoning.length<=100) || instructions.length>30000) throw Error('Invalid agent.toml or soul.md');
  const providerChoices=parseChoices(data.providerChoices??{});
  // Active top-level values are authoritative, including after a direct edit.
  providerChoices[data.provider]={model:data.model??null,reasoning:data.reasoning??null};
  parseChoices(providerChoices);
  return {providerChoices,name:data.name,description:data.description,provider:data.provider,model:data.model??null,reasoning:data.reasoning??null,instructions};
}
function parseAgentFiles(settings:string,instructions:string):AgentSettings {
  if (Buffer.from(settings,'utf8').toString('utf8')!==settings || Buffer.from(instructions,'utf8').toString('utf8')!==instructions) throw Error('Configuration files must contain valid UTF-8 text');
  return parseSettings(TOML.parse(settings),instructions);
}
function decodeAgentFile(bytes:Uint8Array):string {
  try { return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); }
  catch { throw Error('Configuration files must contain valid UTF-8 text'); }
}
function formatAgentToml(input:AgentSettings):string {
  const values={name:input.name,description:input.description,provider:input.provider,...(input.model===null?{}:{model:input.model}),...(input.reasoning===null?{}:{reasoning:input.reasoning})};
  for (const value of [...Object.values(values),input.instructions]) if (Buffer.from(value,'utf8').toString('utf8')!==value) throw Error('Configuration files must contain valid UTF-8 text');
  parseSettings(values,input.instructions);
  const histories=Object.fromEntries(Object.entries({...input.providerChoices,[input.provider]:{model:input.model,reasoning:input.reasoning}}).map(([key,pair])=>[key,{...(pair.model===null?{}:{model:pair.model}),...(pair.reasoning===null?{}:{reasoning:pair.reasoning})}]));
  parseChoices(histories);
  return TOML.stringify({...values,providerChoices:histories});
}
function updateAgentToml(source:string,input:AgentSettings):string {
  const tableStart=source.search(/^\s*\[/m);
  const historySource=tableStart<0?'':source.slice(tableStart);
  if(tableStart>=0) source=source.slice(0,tableStart);
  const values={name:input.name,description:input.description,provider:input.provider,model:input.model,reasoning:input.reasoning};
  const existing=parseAgentFiles(source,input.instructions);
  const replacements:Array<{start:number;end:number;text:string}>=[];
  const found=new Set<string>();let offset=0;
  while (offset<source.length) {
    const lineEnd=source.indexOf('\n',offset),end=lineEnd<0?source.length:lineEnd+1,line=source.slice(offset,end);
    if (/^[ \t]*(?:#.*)?\r?\n?$/.test(line)) { offset=end;continue; }
    // Quoted keys and multiline strings are accepted by the TOML parser; the
    // edit must preserve all text around each value, including comments.
    const assignment=/^[ \t]*((?:[A-Za-z0-9_-]+)|(?:"(?:\\.|[^"\\])*")|(?:'[^']*'))[ \t]*=[ \t]*/.exec(line);
    if (!assignment?.[1]) throw new AgentConfigConflict('Cannot safely update this TOML layout. Edit agent.toml directly.');
    const parsed=TOML.parse(`${assignment[1]} = ""`),key=Object.keys(parsed)[0];
    if (!key || !Object.hasOwn(values,key)) throw new AgentConfigConflict('Cannot safely update this TOML layout. Edit agent.toml directly.');
    const start=offset+assignment[0].length,quote=source[start];
    if (quote!=="'" && quote!=='"') throw new AgentConfigConflict('Cannot safely update this TOML value. Edit agent.toml directly.');
    const triple=source.slice(start,start+3)===quote.repeat(3);let cursor=start+(triple?3:1),closed=false;
    while (cursor<source.length) {
      if (quote==='"' && source[cursor]==='\\') { cursor+=2;continue; }
      if (source[cursor]===quote) {
        if (!triple) { cursor++;closed=true;break; }
        let count=0;while(source[cursor+count]===quote)count++;
        if (count>=3) { cursor+=count;closed=true;break; }
        cursor+=count;continue;
      }
      cursor++;
    }
    if (!closed) throw new AgentConfigConflict('Cannot safely update this TOML value. Edit agent.toml directly.');
    found.add(key);
    const field=key as keyof typeof values,value=values[field];
    if (value!==existing[field]) {
      if (value===null) replacements.push({start:offset,end:cursor,text:''});
      else replacements.push({start,end:cursor,text:TOML.stringify({value}).slice('value = '.length).trimEnd()});
    }
    const next=source.indexOf('\n',cursor);offset=next<0?source.length:next+1;
  }
  let result=source;
  for (const replacement of replacements.reverse()) result=result.slice(0,replacement.start)+replacement.text+result.slice(replacement.end);
  for (const [key,value] of Object.entries(values)) if (!found.has(key) && value!==null) result+=(result && !result.endsWith('\n')?'\n':'')+TOML.stringify({[key]:value});
  const parsed=parseAgentFiles(result,input.instructions);
  if (parsed.name!==input.name || parsed.description!==input.description || parsed.provider!==input.provider || parsed.model!==input.model || parsed.reasoning!==input.reasoning) throw new AgentConfigConflict('Cannot safely update this TOML layout. Edit agent.toml directly.');
  const histories=Object.fromEntries(Object.entries({...input.providerChoices,[input.provider]:{model:input.model,reasoning:input.reasoning}}).map(([key,pair])=>[key,{...(pair.model===null?{}:{model:pair.model}),...(pair.reasoning===null?{}:{reasoning:pair.reasoning})}]));
  const original=historySource?TOML.parse(historySource).providerChoices??{}:{};
  return result+(JSON.stringify(original)===JSON.stringify(histories)?historySource:TOML.stringify({providerChoices:histories}));
}
function writeSnapshot(dir:string,name:string,settings:string,instructions:string) {
  const snapshot=join(dir,name),temporary=join(dir,`.snapshot-${randomUUID()}`);
  mkdirSync(temporary,{mode:0o700});
  writeDurable(join(temporary,'agent.toml'),settings);
  writeDurable(join(temporary,'soul.md'),instructions);
  syncDirectory(temporary);renameSync(temporary,snapshot);
  syncDirectory(dir);
}
function contentRevision(dir:string,settings:string,instructions:string,archived:boolean) {
  return createHash('sha256').update(basename(dir)).update('\0').update(settings).update('\0').update(instructions).update(archived ? '\x01' : '\0').digest('hex');
}
function writeObserved(dir:string,fingerprint:string) {
  const state={fingerprint,generation:randomUUID()},temporary=join(dir,`.observed-${randomUUID()}`);
  writeDurable(temporary,JSON.stringify(state));renameSync(temporary,join(dir,'.observed'));syncDirectory(dir);
  return state;
}
function rememberPublished(dir:string,files:ReturnType<typeof revisionFiles>,archived:boolean) {
  const snapshot=join(dir,'.published'),marker=join(dir,'.sealed');
  if (existsSync(marker) && !existsSync(snapshot)) throw new AgentConfigInvalid(`Invalid configuration: the published snapshot is missing at ${snapshot}. Restore it from a backup before continuing.`);
  if (!existsSync(snapshot)) writeSnapshot(dir,'.published',files.settings,files.instructions);
  const savedSettings=decodeAgentFile(readFileSync(join(snapshot,'agent.toml'))),savedInstructions=decodeAgentFile(readFileSync(join(snapshot,'soul.md')));
  const stateFile=join(dir,'.observed');
  let observed:{fingerprint:string;generation:string};
  if (existsSync(stateFile)) {
    const saved:unknown=JSON.parse(readFileSync(stateFile,'utf8'));
    if (!saved || typeof saved!=='object' || !('fingerprint' in saved) || typeof saved.fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(saved.fingerprint) || !('generation' in saved) || typeof saved.generation!=='string' || !/^[a-f0-9-]{36}$/.test(saved.generation)) throw Error('Invalid configuration observation marker');
    observed={fingerprint:saved.fingerprint,generation:saved.generation};
  } else observed=writeObserved(dir,contentRevision(dir,savedSettings,savedInstructions,archived));
  if (files.contentFingerprint!==observed.fingerprint) {
    const history=join(dir,'.history'),entry=join(history,files.contentFingerprint);
    const existed=existsSync(history);
    mkdirSync(history,{recursive:true,mode:0o700});
    if (!existed) syncDirectory(dir);
    if (!existsSync(entry)) writeSnapshot(history,files.contentFingerprint,files.settings,files.instructions);
    if (decodeAgentFile(readFileSync(join(entry,'agent.toml')))!==files.settings || decodeAgentFile(readFileSync(join(entry,'soul.md')))!==files.instructions) throw new AgentConfigInvalid(`Configuration recovery copy is invalid at ${entry}. Inspect the files before continuing.`);
    if (revisionFiles(dir,archived).fileFingerprint!==files.fileFingerprint) throw new AgentConfigInvalid(`Configuration changed while reading ${dir}. Inspect the files and retry.`);
    observed=writeObserved(dir,files.contentFingerprint);
  }
  if (!existsSync(marker)) { writeDurable(marker,'1');syncDirectory(dir); }
  return observed.generation;
}
function revisionFiles(dir:string, archived:boolean) {
  const toml=join(dir,'agent.toml'),soul=join(dir,'soul.md');
  const tomlStat=statSync(toml,{bigint:true}),soulStat=statSync(soul,{bigint:true});
  if (tomlStat.size>65536n || soulStat.size>120000n) throw Error('Configuration file exceeds the size limit');
  const settings=decodeAgentFile(readFileSync(toml)),instructions=decodeAgentFile(readFileSync(soul));
  const contentFingerprint=contentRevision(dir,settings,instructions,archived);
  const fileFingerprint=createHash('sha256').update(contentFingerprint).update('\0').update([tomlStat.dev,tomlStat.ino,tomlStat.ctimeNs,tomlStat.mtimeNs,soulStat.dev,soulStat.ino,soulStat.ctimeNs,soulStat.mtimeNs].join(':')).digest('hex');
  const legacyRevision=createHash('sha256').update(settings).update('\0').update(instructions).update(archived ? '\x01' : '\0').digest('hex');
  return {settings,instructions,fileFingerprint,contentFingerprint,legacyRevision};
}

/** A current symlink publishes a complete, durable pair of editable files. */
export class AgentConfigStore {
  constructor(private readonly root:string) {}
  location(id:string) { return join(this.root,id,'current'); }
  private currentTarget(id:string) {
    const target=readlinkSync(this.location(id));
    if (!/^revisions\/[a-f0-9-]+$/.test(target)) throw Error('Invalid revision link');
    return target;
  }
  private checkRetired(base:string,active:string) {
    const revisions=join(base,'revisions');
    for (const entry of readdirSync(revisions,{withFileTypes:true})) {
      if (!entry.isDirectory() || `revisions/${entry.name}`===active) continue;
      const previous=join(revisions,entry.name),marker=join(previous,'.retired');
      if (!existsSync(marker)) continue;
      try {
        const data:unknown=JSON.parse(readFileSync(marker,'utf8'));
        if (!data || typeof data!=='object' || !('revision' in data) || typeof data.revision!=='string' || !('archived' in data) || typeof data.archived!=='boolean') throw Error('Invalid retired marker');
        const files=revisionFiles(previous,data.archived);
        if (data.revision!==files.fileFingerprint && data.revision!==files.contentFingerprint && data.revision!==files.legacyRevision) throw Error('Changed');
      } catch {
        throw new AgentConfigInvalid(`A previous revision was edited after publication: ${previous}. Reconcile its files with the current configuration, then remove its .retired marker.`);
      }
    }
  }
  read(id:string, archived:boolean):AgentConfig {
    const base=join(this.root,id), configDir=this.location(id);
    try {
      const target=this.currentTarget(id);
      this.checkRetired(base,target);
      const files=revisionFiles(join(base,target),archived);
      const settings=parseAgentFiles(files.settings,files.instructions);
      const generation=rememberPublished(join(base,target),files,archived);
      if (revisionFiles(join(base,target),archived).fileFingerprint!==files.fileFingerprint) throw new AgentConfigInvalid(`Configuration changed while reading ${configDir}. Inspect the files and retry.`);
      const revision=createHash('sha256').update(files.contentFingerprint).update('\0').update(generation).digest('hex');
      return {...settings,revision,configDir};
    } catch (error) {
      if (error instanceof AgentConfigInvalid) throw error;
      throw new AgentConfigInvalid(`Invalid configuration at ${configDir}: ${error instanceof Error ? error.message : 'cannot read files'}`);
    }
  }
  readFiles(id:string,archived:boolean) {
    const config=this.read(id,archived),target=this.currentTarget(id);
    const files=revisionFiles(join(this.root,id,target),archived);
    const current=this.read(id,archived);
    if (current.revision!==config.revision || this.currentTarget(id)!==target || revisionFiles(join(this.root,id,target),archived).fileFingerprint!==files.fileFingerprint) throw new AgentConfigConflict('Profile changed. Refresh before editing.');
    return {revision:config.revision,settings:files.settings,instructions:files.instructions};
  }
  publish(id:string, input:AgentSettings, archived:boolean, expected?:string):AgentConfig {
    let settings=formatAgentToml(input);
    if (expected!==undefined) {
      const current=this.readFiles(id,archived);
      if (current.revision!==expected) throw new AgentConfigConflict('Profile changed. Refresh before editing.');
      const existing=parseAgentFiles(current.settings,current.instructions);
      const same=existing.name===input.name && existing.description===input.description && existing.provider===input.provider && existing.model===input.model && existing.reasoning===input.reasoning && JSON.stringify(existing.providerChoices)===JSON.stringify(input.providerChoices);
      if (same) settings=current.settings;
      else settings=updateAgentToml(current.settings,input);
    }
    return this.publishFiles(id,settings,input.instructions,archived,expected);
  }
  publishFiles(id:string,settings:string,instructions:string,archived:boolean,expected?:string):AgentConfig {
    if (Buffer.byteLength(settings,'utf8')>65536 || Buffer.byteLength(instructions,'utf8')>120000) throw Error('Configuration file exceeds the size limit');
    parseAgentFiles(settings,instructions);
    if (expected!==undefined && this.read(id,archived).revision!==expected) throw new AgentConfigConflict('Profile changed. Refresh before editing.');
    const base=join(this.root,id), revisions=join(base,'revisions');
    mkdirSync(revisions,{recursive:true,mode:0o700});
    const revision=randomUUID(), revisionDir=join(revisions,revision);
    mkdirSync(revisionDir,{mode:0o700});
    writeDurable(join(revisionDir,'agent.toml'),settings);
    writeDurable(join(revisionDir,'soul.md'),instructions);
    writeSnapshot(revisionDir,'.published',settings,instructions);
    writeDurable(join(revisionDir,'.sealed'),'1');
    syncDirectory(revisionDir); syncDirectory(revisions);
    const publishedRevision=revisionFiles(revisionDir,archived).contentFingerprint;
    let previous:string|undefined,previousFiles:ReturnType<typeof revisionFiles>|undefined;
    if (expected!==undefined) {
      if (this.read(id,archived).revision!==expected) throw new AgentConfigConflict('Profile changed. Refresh before editing.');
      previous=this.currentTarget(id);
      previousFiles=revisionFiles(join(base,previous),archived);
      retireRevision(join(base,previous),previousFiles.contentFingerprint,archived);
      if (this.read(id,archived).revision!==expected) throw new AgentConfigConflict('Profile changed. Refresh before editing.');
    }
    const next=join(base,`.current-${revision}`);
    symlinkSync(`revisions/${revision}`,next,'dir');
    try {
      renameSync(next,this.location(id));
      syncDirectory(base); syncDirectory(dirname(base)); syncDirectory(dirname(this.root));
    } catch {
      throw new AgentConfigUncertain('Configuration save may have taken effect. Inspect the current configuration before retrying.');
    }
    if (previous && previousFiles && expected!==undefined) {
      let unchanged=false;
      try { unchanged=revisionFiles(join(base,previous),archived).fileFingerprint===previousFiles.fileFingerprint; } catch {}
      if (!unchanged) {
        try {
          retireRevision(revisionDir,publishedRevision,archived);
          const rollback=join(base,`.current-rollback-${revision}`);
          symlinkSync(previous,rollback,'dir');renameSync(rollback,this.location(id));syncDirectory(base);
        } catch {
          throw new AgentConfigUncertain('Configuration save may have taken effect. Inspect the current configuration before retrying.');
        }
        throw new AgentConfigConflict('Profile changed during publication. Refresh before editing.');
      }
    }
    try { return this.read(id,archived); }
    catch(error) { throw new AgentConfigUncertain(`Configuration save may have taken effect. Inspect the current configuration before retrying. ${error instanceof Error ? error.message : ''}`); }
  }
}
