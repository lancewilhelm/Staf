import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type GrantBoundary =
  | { kind:'web'; url:string }
  | { kind:'search'; query:string; origin:string; revision:number; results:number; timeoutMs:number }
  | { kind:'shell'; command:string; dockerBinary:string; dockerSocket:string; imageId:string; revision:number; sizeBytes:number; maxInodes:number; timeoutMs:number; maxOutputBytes:number };
export type GrantScope = { kind:'bot'; botId:string } | { kind:'all-bots' };
export type GrantLifetime = { kind:'task'; taskId:string } | { kind:'remembered' };
export type Grant = { id:string; revision:number; boundary:GrantBoundary; scope:GrantScope; lifetime:GrantLifetime; revoked:boolean };
export const approvalGrantSchema = `CREATE TABLE IF NOT EXISTS approval_grants (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL, boundary TEXT NOT NULL,
 bot_id TEXT, task_id TEXT, revoked INTEGER NOT NULL CHECK(revoked IN (0,1))
)`;
export class ApprovalGrants {
  constructor(private readonly db:DatabaseSync) {}
  list():Grant[] {
    return this.db.prepare('SELECT id,revision,boundary,bot_id,task_id,revoked FROM approval_grants ORDER BY rowid DESC').all().map(row=>{
      if(typeof row.id!=='string'||typeof row.revision!=='number'||typeof row.boundary!=='string'||!(row.bot_id===null||typeof row.bot_id==='string')||!(row.task_id===null||typeof row.task_id==='string')||!(row.revoked===0||row.revoked===1))throw Error('Invalid approval grant');
      return {id:row.id,revision:row.revision,boundary:JSON.parse(row.boundary) as GrantBoundary,scope:row.bot_id===null?{kind:'all-bots'}:{kind:'bot',botId:row.bot_id},lifetime:row.task_id===null?{kind:'remembered'}:{kind:'task',taskId:row.task_id},revoked:row.revoked===1};
    });
  }
  create(boundary:GrantBoundary,scope:GrantScope,lifetime:GrantLifetime):Grant {
    const id=randomUUID();
    this.db.prepare('INSERT INTO approval_grants VALUES (?,1,?,?,?,0)').run(id,JSON.stringify(boundary),scope.kind==='bot'?scope.botId:null,lifetime.kind==='task'?lifetime.taskId:null);
    const result=this.list().find(item=>item.id===id);if(!result)throw Error('Grant creation failed');return result;
  }
  revoke(id:string,revision:number):void {
    const changed=this.db.prepare('UPDATE approval_grants SET revoked=1,revision=revision+1 WHERE id=? AND revision=? AND revoked=0').run(id,revision);
    if(!changed.changes)throw Error('Grant changed or was revoked');
  }
  edit(id:string,revision:number,scope:GrantScope,lifetime:GrantLifetime):void {
    const changed=this.db.prepare('UPDATE approval_grants SET revision=revision+1,bot_id=?,task_id=? WHERE id=? AND revision=? AND revoked=0').run(scope.kind==='bot'?scope.botId:null,lifetime.kind==='task'?lifetime.taskId:null,id,revision);
    if(!changed.changes)throw Error('Grant changed or was revoked');
  }
  matchingId(boundary:GrantBoundary,botId:string,taskId:string|null):string|null {
    const row=this.db.prepare('SELECT id FROM approval_grants WHERE revoked=0 AND boundary=? AND (bot_id IS NULL OR bot_id=?) AND (task_id IS NULL OR task_id=?) ORDER BY rowid LIMIT 1').get(JSON.stringify(boundary),botId,taskId);
    return typeof row?.id==='string'?row.id:null;
  }
}
