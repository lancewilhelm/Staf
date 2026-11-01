import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
function revisionFiles(dir:string, archived:boolean) {
  const toml=join(dir,'agent.toml'),soul=join(dir,'soul.md');
  if (statSync(toml).size>65536 || statSync(soul).size>120000) throw Error('Configuration file exceeds the size limit');
  const settings=readFileSync(toml,'utf8'),instructions=readFileSync(soul,'utf8');
  const revision=createHash('sha256').update(settings).update('\0').update(instructions).update(archived ? '\x01' : '\0').digest('hex');
  return {settings,instructions,revision};
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
        if (!data || typeof data!=='object' || !('revision' in data) || typeof data.revision!=='string' || !('archived' in data) || typeof data.archived!=='boolean' || revisionFiles(previous,data.archived).revision!==data.revision) throw Error('Changed');
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
      return {...parseSettings(TOML.parse(files.settings),files.instructions),revision:files.revision,configDir};
    } catch (error) {
      if (error instanceof AgentConfigInvalid) throw error;
      throw new AgentConfigInvalid(`Invalid configuration at ${configDir}: ${error instanceof Error ? error.message : 'cannot read files'}`);
    }
  }
  publish(id:string, input:AgentSettings, archived:boolean, expected?:string):AgentConfig {
    const values={name:input.name,description:input.description,provider:input.provider,...(input.model===null?{}:{model:input.model}),...(input.reasoning===null?{}:{reasoning:input.reasoning})};
    parseSettings(values,input.instructions);
    if (expected!==undefined && this.read(id,archived).revision!==expected) throw new AgentConfigConflict('Profile changed. Refresh before editing.');
    const base=join(this.root,id), revisions=join(base,'revisions');
    mkdirSync(revisions,{recursive:true,mode:0o700});
    const revision=randomUUID(), revisionDir=join(revisions,revision);
    mkdirSync(revisionDir,{mode:0o700});
    writeDurable(join(revisionDir,'agent.toml'),TOML.stringify(values));
    writeDurable(join(revisionDir,'soul.md'),input.instructions);
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
