import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import * as TOML from '@iarna/toml';

export type AgentSettings = {name:string; description:string; provider:string; model:string|null; reasoning:string|null; instructions:string};
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
  const allowed=['name','description','provider','model','reasoning'];
  if (Object.keys(data).some(key=>!allowed.includes(key)) || typeof data.name!=='string' || !data.name.trim() || data.name.length>200 || typeof data.description!=='string' || Buffer.byteLength(data.description,'utf8')>4096 || typeof data.provider!=='string' || !['demo','codex','openrouter','lmstudio','live'].includes(data.provider) || !(data.model===undefined || typeof data.model==='string' && data.model.length<=200) || !(data.reasoning===undefined || typeof data.reasoning==='string' && data.reasoning.length<=100) || instructions.length>30000) throw Error('Invalid agent.toml or soul.md');
  return {name:data.name,description:data.description,provider:data.provider,model:data.model??null,reasoning:data.reasoning??null,instructions};
}
export function parseAgentFiles(settings:string,instructions:string):AgentSettings {
  if (Buffer.from(settings,'utf8').toString('utf8')!==settings || Buffer.from(instructions,'utf8').toString('utf8')!==instructions) throw Error('Configuration files must contain valid UTF-8 text');
  return parseSettings(TOML.parse(settings),instructions);
}
export function decodeAgentFile(bytes:Uint8Array):string {
  try { return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); }
  catch { throw Error('Configuration files must contain valid UTF-8 text'); }
}
export function formatAgentToml(input:AgentSettings):string {
  const values={name:input.name,description:input.description,provider:input.provider,...(input.model===null?{}:{model:input.model}),...(input.reasoning===null?{}:{reasoning:input.reasoning})};
  for (const value of [...Object.values(values),input.instructions]) if (Buffer.from(value,'utf8').toString('utf8')!==value) throw Error('Configuration files must contain valid UTF-8 text');
  parseSettings(values,input.instructions);
  return TOML.stringify(values);
}
function updateAgentToml(source:string,input:AgentSettings):string {
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
    if (!assignment?.[1]) throw new AgentConfigConflict('Cannot safely update this TOML layout. Use config-checkout and config-publish.');
    const parsed=TOML.parse(`${assignment[1]} = ""`),key=Object.keys(parsed)[0];
    if (!key || !Object.hasOwn(values,key)) throw new AgentConfigConflict('Cannot safely update this TOML layout. Use config-checkout and config-publish.');
    const start=offset+assignment[0].length,quote=source[start];
    if (quote!=="'" && quote!=='"') throw new AgentConfigConflict('Cannot safely update this TOML value. Use config-checkout and config-publish.');
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
    if (!closed) throw new AgentConfigConflict('Cannot safely update this TOML value. Use config-checkout and config-publish.');
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
  if (parsed.name!==input.name || parsed.description!==input.description || parsed.provider!==input.provider || parsed.model!==input.model || parsed.reasoning!==input.reasoning) throw new AgentConfigConflict('Cannot safely update this TOML layout. Use config-checkout and config-publish.');
  return result;
}
function sealFiles(dir:string,settings:string,instructions:string) {
  const snapshot=join(dir,'.published'),temporary=join(dir,`.published-${randomUUID()}`);
  mkdirSync(temporary,{mode:0o700});
  writeDurable(join(temporary,'agent.toml'),settings);
  writeDurable(join(temporary,'soul.md'),instructions);
  syncDirectory(temporary);renameSync(temporary,snapshot);
  syncDirectory(dir);
}
function checkPublished(dir:string,settings:string,instructions:string) {
  const snapshot=join(dir,'.published'),marker=join(dir,'.sealed');
  if (existsSync(marker) && !existsSync(snapshot)) throw new AgentConfigInvalid(`Invalid configuration: the published snapshot is missing at ${snapshot}. Restore it from a backup before continuing.`);
  if (!existsSync(snapshot)) sealFiles(dir,settings,instructions);
  const savedSettings=decodeAgentFile(readFileSync(join(snapshot,'agent.toml'))),savedInstructions=decodeAgentFile(readFileSync(join(snapshot,'soul.md')));
  if (settings!==savedSettings || instructions!==savedInstructions) throw new AgentConfigInvalid(`Invalid configuration: published files were edited outside the versioned editing workflow at ${dir}. Your file changes remain there; the last published files are in ${snapshot}. Save your edits elsewhere, restore both files from that directory, then use config-checkout and config-publish to reconcile them.`);
  if (!existsSync(marker)) { writeDurable(marker,'1');syncDirectory(dir); }
}
function revisionFiles(dir:string, archived:boolean) {
  const toml=join(dir,'agent.toml'),soul=join(dir,'soul.md');
  if (statSync(toml).size>65536 || statSync(soul).size>120000) throw Error('Configuration file exceeds the size limit');
  const settings=decodeAgentFile(readFileSync(toml)),instructions=decodeAgentFile(readFileSync(soul));
  const revision=createHash('sha256').update(basename(dir)).update('\0').update(settings).update('\0').update(instructions).update(archived ? '\x01' : '\0').digest('hex');
  const legacyRevision=createHash('sha256').update(settings).update('\0').update(instructions).update(archived ? '\x01' : '\0').digest('hex');
  return {settings,instructions,revision,legacyRevision};
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
        if (data.revision!==files.revision && data.revision!==files.legacyRevision) throw Error('Changed');
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
      if (!existsSync(join(base,target,'.published'))) parseAgentFiles(files.settings,files.instructions);
      checkPublished(join(base,target),files.settings,files.instructions);
      if (revisionFiles(join(base,target),archived).revision!==files.revision) throw new AgentConfigInvalid(`Configuration changed while reading ${configDir}. Inspect the files and retry.`);
      const settings=parseAgentFiles(files.settings,files.instructions);
      return {...settings,revision:files.revision,configDir};
    } catch (error) {
      if (error instanceof AgentConfigInvalid) throw error;
      throw new AgentConfigInvalid(`Invalid configuration at ${configDir}: ${error instanceof Error ? error.message : 'cannot read files'}`);
    }
  }
  readFiles(id:string,archived:boolean) {
    const config=this.read(id,archived),target=this.currentTarget(id);
    const files=revisionFiles(join(this.root,id,target),archived);
    if (files.revision!==config.revision) throw new AgentConfigConflict('Profile changed. Refresh before editing.');
    return {revision:config.revision,settings:files.settings,instructions:files.instructions};
  }
  publish(id:string, input:AgentSettings, archived:boolean, expected?:string):AgentConfig {
    let settings=formatAgentToml(input);
    if (expected!==undefined) {
      const current=this.readFiles(id,archived);
      if (current.revision!==expected) throw new AgentConfigConflict('Profile changed. Refresh before editing.');
      const existing=parseAgentFiles(current.settings,current.instructions);
      const same=existing.name===input.name && existing.description===input.description && existing.provider===input.provider && existing.model===input.model && existing.reasoning===input.reasoning;
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
    sealFiles(revisionDir,settings,instructions);
    writeDurable(join(revisionDir,'.sealed'),'1');
    syncDirectory(revisionDir); syncDirectory(revisions);
    const publishedRevision=revisionFiles(revisionDir,archived).revision;
    let previous:string|undefined;
    if (expected!==undefined) {
      if (this.read(id,archived).revision!==expected) throw new AgentConfigConflict('Profile changed. Refresh before editing.');
      previous=this.currentTarget(id);
      retireRevision(join(base,previous),expected,archived);
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
    if (previous && expected!==undefined) {
      let unchanged=false;
      try { unchanged=revisionFiles(join(base,previous),archived).revision===expected; } catch {}
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
