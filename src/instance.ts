import {parseToolMode,type ToolMode} from './tool-mode.js';
import {ProviderDefaultsStore} from './provider-choices.js';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentConfigStore, AgentConfigUncertain } from './agent-config.js';
import {AgentImageAssets} from './agent-image-assets.js';
import {imageSetting,type AgentImage,type AgentImageInput} from './agent-image.js';
import { hasCode } from './validation.js';
import type { Session, Message } from './types.js';
import { validSession } from './validation.js';
import { evaluateApproval, type ApprovalMode, type Action } from './approval-policy.js';
import { TaskInbox, taskInboxSchema, appendTaskInputs } from './task-inbox.js';
import { MemoryStore, memorySchema, type MemoryScope } from './memory.js';
import { SkillCatalog, skillCatalogSchema } from './skill-catalog.js';
import { ScheduleStore, scheduleStoreSchema } from './schedule-store.js';
import { discoverBots } from './bot-discovery.js';
import { CollaborationStore, collaborationSchema } from './collaboration.js';
import { ActionJournal, actionJournalSchema, type WorkRef, type StartPermit } from './action-journal.js';
import { checkedSearchOrigin, checkedSearchQuery } from './searxng-search.js';
import { checkedOwnerWebUrl } from './web-reader.js';
import { scratchLimits } from './shell-sandbox.js';
import { WorkActionService, workActionsSchema, type ActionIdentity } from './work-actions.js';
import { ApprovalGrants, approvalGrantSchema, type GrantBoundary } from './approval-grants.js';

const clockAction: Action = { capability:'clock', operation:'read', resource:'utc', effect:'read', limits:{}, risk:'safe' };
const clockBoundary = { enabledCapabilities:['clock'], actions:[clockAction] };
const modes: ApprovalMode[] = ['ask-every-time','ask-for-risky-actions','never-ask'];
export const INSTANCE_SCHEMA_VERSION = 34;
const MAINTENANCE_VERSION = 2147483647;

export const starterSoul = "You are an assistant working for the owner. Be clear and candid. Distinguish observations from assumptions. Follow the owner's role instructions and work within the permissions and task scope granted to you.";
export type BotEdit = { revision: string; name: string; description?: string; instructions: string; provider: string; model: string | null; reasoning: string | null;toolMode?:ToolMode;image?:AgentImageInput };
export class BotConflict extends Error {}

function parseToolModeFromProfile(raw:unknown) {
  if(raw===null || raw===undefined)return parseToolMode(undefined);
  if(typeof raw!=='string')throw Error('Invalid captured profile');
  const profile:unknown=JSON.parse(raw);
  if(!profile || typeof profile!=='object')throw Error('Invalid captured profile');
  return parseToolMode('toolMode' in profile ? profile.toolMode : undefined);
}
function parseCapturedProfile(profile:unknown) {
  if (!profile || typeof profile !== 'object' || !('provider' in profile) || typeof profile.provider !== 'string' || !('model' in profile) || !(profile.model === null || typeof profile.model === 'string') || !('reasoning' in profile) || !(profile.reasoning === null || typeof profile.reasoning === 'string') || !('instructions' in profile) || typeof profile.instructions !== 'string' || !('chatId' in profile) || typeof profile.chatId !== 'string') throw Error('Invalid captured profile');
  return {provider:profile.provider,model:profile.model,reasoning:profile.reasoning,instructions:profile.instructions,chatId:profile.chatId,toolMode:parseToolMode('toolMode' in profile ? profile.toolMode : undefined)};
}

function freezeCaptured(value:unknown):void {
  if (value && typeof value==='object') {
    for (const child of Object.values(value)) freezeCaptured(child);
    Object.freeze(value);
  }
}

export function assertDatasetAvailable(path: string, maintenanceToken?:string) {
  if (path !== ':memory:' && existsSync(`${path}.maintenance.json`)) {
    if (maintenanceToken) {
      try {const marker:unknown=JSON.parse(readFileSync(`${path}.maintenance.json`,'utf8'));if(marker && typeof marker==='object' && 'token' in marker && marker.token===maintenanceToken)return;} catch {}
    }
    throw Error('Dataset maintenance was interrupted. Run pnpm dev:recover before starting Staf.');
  }
}

function upgradeVersion(path:string, token:string|undefined):number|undefined {
  if (!token) return undefined;
  const marker:unknown=JSON.parse(readFileSync(`${path}.maintenance.json`,'utf8'));
  if (!marker || typeof marker!=='object' || !('phase' in marker) || marker.phase!=='upgrading' || !('token' in marker) || marker.token!==token || !('schemaVersion' in marker) || typeof marker.schemaVersion!=='number' || !Number.isSafeInteger(marker.schemaVersion) || marker.schemaVersion<0 || marker.schemaVersion>=INSTANCE_SCHEMA_VERSION) throw Error('Invalid upgrade maintenance marker.');
  return marker.schemaVersion;
}

/** Instance-owned records. Callers supply execution; no provider runs during creation. */
export class Instance {
  private readonly db: DatabaseSync;
  private readonly configs: AgentConfigStore;
  private images:AgentImageAssets|undefined;
  private readonly temporaryConfigRoot: string | undefined;
  private readonly agentRoot: string;
  private readonly fingerprintKey: Uint8Array;
  private readonly datasetKey: Uint8Array;
  private maintenanceToken: string | undefined;
  private actionService: WorkActionService | undefined;
  private readonly grantControllers = new Map<string,Set<AbortController>>();
  readonly migrationBackup: string | undefined;
  constructor(path: string, private readonly redactSkill: (text:string) => string = text => text, maintenanceToken?:string) {
    assertDatasetAvailable(path,maintenanceToken);
    this.temporaryConfigRoot = path === ':memory:' ? mkdtempSync(join(tmpdir(),'staf-config-')) : undefined;
    this.agentRoot = resolve(this.temporaryConfigRoot ?? join(dirname(resolve(path)),'agents'));
    this.configs = new AgentConfigStore(this.agentRoot);
    if (path !== ':memory:') {
      try { closeSync(openSync(path, 'wx', 0o600)); }
      catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
    }
    this.db = new DatabaseSync(path);
    try {
    this.db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    assertDatasetAvailable(path,maintenanceToken);
    const hasBots = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bots'").get();
    const hasProfiles = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bot_profiles'").get();
    const versionRow = this.db.prepare('PRAGMA user_version').get();
    const storedVersion = Number(versionRow?.user_version ?? 0);
    const originalVersion=upgradeVersion(path,maintenanceToken);
    if (originalVersion!==undefined && storedVersion!==MAINTENANCE_VERSION) throw Error('Upgrade database is not fenced.');
    const version = originalVersion ?? storedVersion;
    this.maintenanceToken=maintenanceToken;
    if (version > INSTANCE_SCHEMA_VERSION) throw new Error(`Database version ${version} is newer than this Staf (maximum ${INSTANCE_SCHEMA_VERSION}). Use a compatible checkout or select another data directory; the database was not reset.`);
    if (hasBots && version < INSTANCE_SCHEMA_VERSION && path !== ':memory:') {
      this.migrationBackup = `${path}.before-${version < 2 ? 'profiles' : version < 3 ? 'tasks' : version < 4 ? 'approvals' : version < 5 ? 'task-inbox' : version < 6 ? 'memory' : version < 7 ? 'memory-confirmation' : version < 8 ? 'skills' : version < 9 ? 'schedules' : version < 10 ? 'schedule-retries' : version < 11 ? 'schedule-lineage' : version < 12 ? 'bot-description' : version < 13 ? 'delegation-scope' : version < 14 ? 'collaboration' : version < 15 ? 'disclosure' : version < 16 ? 'chat-tasks' : version < 17 ? 'creation-defaults' : version < 18 ? 'web-actions' : version < 19 ? 'search-actions' : version < 20 ? 'scratch-shell' : version < 21 ? 'approval-grants' : version < 22 ? 'schedule-web-scope' : version < 23 ? 'schedule-search-scope' : version < 24 ? 'schedule-shell-scope' : version < 25 ? 'main-bot' : version < 26 ? 'command-events' : version < 27 ? 'bot-creation' : version < 28 ? 'response-progress' : version < 31 ? 'response-stop' : version < 33 ? 'work-actions' : 'search-bindings'}-${randomUUID()}.sqlite`;
      const previousUmask = process.umask(0o077);
      try {
        this.db.prepare('VACUUM INTO ?').run(this.migrationBackup);
        if(originalVersion!==undefined){const backup=new DatabaseSync(this.migrationBackup);try{backup.exec(`PRAGMA user_version=${version}`)}finally{backup.close()}}
      }
      finally { process.umask(previousUmask); }
    }
    this.db.exec(`PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS clients (token_hash TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, instructions TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, reasoning TEXT);
      CREATE TABLE IF NOT EXISTS bot_profiles (bot_id TEXT PRIMARY KEY REFERENCES bots(id), revision INTEGER NOT NULL, soul TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS command_profiles (command_id TEXT PRIMARY KEY, profile TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), role TEXT NOT NULL, content TEXT NOT NULL, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), content TEXT NOT NULL, state TEXT NOT NULL, error TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_turn ON commands(bot_id) WHERE state='pending';
      CREATE TABLE IF NOT EXISTS sessions (bot_id TEXT PRIMARY KEY REFERENCES bots(id), session TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instance_secrets (name TEXT PRIMARY KEY, value BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS command_fingerprints (command_id TEXT PRIMARY KEY REFERENCES commands(id), digest TEXT NOT NULL);
      UPDATE commands SET state='interrupted', error='Instance restarted during execution' WHERE state='pending';
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), objective TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_attempts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), bot_id TEXT NOT NULL REFERENCES bots(id), predecessor TEXT REFERENCES task_attempts(id), profile TEXT NOT NULL, context TEXT NOT NULL, state TEXT NOT NULL, outcome TEXT, limit_ms INTEGER NOT NULL, session TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_task ON task_attempts(bot_id) WHERE state IN ('queued','running','stopping');
      CREATE UNIQUE INDEX IF NOT EXISTS one_waiting_replacement ON task_attempts(bot_id) WHERE state='waiting';
      CREATE TABLE IF NOT EXISTS task_activity (seq INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL REFERENCES task_attempts(id), event TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_fingerprints (attempt_id TEXT PRIMARY KEY REFERENCES task_attempts(id), digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_notices (message_id TEXT PRIMARY KEY REFERENCES messages(id), bot_id TEXT NOT NULL REFERENCES bots(id), delivered INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS command_notices (command_id TEXT NOT NULL REFERENCES commands(id), message_id TEXT NOT NULL REFERENCES task_notices(message_id), PRIMARY KEY(command_id,message_id));
      CREATE TABLE IF NOT EXISTS approval_settings (scope TEXT PRIMARY KEY, mode TEXT, clock_enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS approval_requests (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, work_kind TEXT NOT NULL, work_id TEXT NOT NULL, action TEXT NOT NULL, state TEXT NOT NULL);
      INSERT OR IGNORE INTO approval_settings VALUES ('instance','ask-for-risky-actions',1);
      INSERT INTO task_activity (attempt_id,event) SELECT work_id,json_object('type','approval_interrupted','id',id) FROM approval_requests WHERE state='pending' AND work_kind='task';
      UPDATE approval_requests SET state='interrupted' WHERE state='pending';
      `);
    if (version < 5) this.db.exec(taskInboxSchema);
    if (version < 6) this.db.exec(memorySchema);
    if (version < 7) this.db.exec("CREATE TABLE IF NOT EXISTS memory_proposals (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), text TEXT, state TEXT NOT NULL CHECK(state IN ('pending','confirmed','cancelled')), CHECK((state = 'pending' AND text IS NOT NULL) OR (state <> 'pending' AND text IS NULL)))");
    if (version < 8) this.db.exec(skillCatalogSchema + `CREATE TABLE IF NOT EXISTS task_skill_catalog (attempt_id TEXT NOT NULL REFERENCES task_attempts(id), skill_id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(attempt_id,skill_id)); CREATE TABLE IF NOT EXISTS command_skill_activity (command_id TEXT NOT NULL REFERENCES commands(id), event TEXT NOT NULL)`);
    if (version < 9) this.db.exec(scheduleStoreSchema);
    if (version < 10) this.db.exec('CREATE TABLE schedule_task_retries (attempt_id TEXT PRIMARY KEY REFERENCES task_attempts(id), schedule_id TEXT NOT NULL, due_at INTEGER NOT NULL, FOREIGN KEY(schedule_id,due_at) REFERENCES schedule_occurrences(schedule_id,due_at))');
    if (version < 11) {
      const lineage=`WITH RECURSIVE descendants(attempt_id,schedule_id,due_at) AS (
        SELECT a.id,o.schedule_id,o.due_at FROM task_attempts a JOIN schedule_occurrences o ON a.predecessor=o.task_id
        UNION
        SELECT a.id,d.schedule_id,d.due_at FROM task_attempts a JOIN descendants d ON a.predecessor=d.attempt_id
      )`;
      const conflict=this.db.prepare(`${lineage} SELECT 1 FROM descendants d JOIN schedule_task_retries r ON r.attempt_id=d.attempt_id WHERE r.schedule_id<>d.schedule_id OR r.due_at<>d.due_at LIMIT 1`).get();
      if (conflict) throw Error('Conflicting schedule task lineage');
      this.db.exec(`${lineage} INSERT INTO schedule_task_retries SELECT d.attempt_id,d.schedule_id,d.due_at FROM descendants d WHERE NOT EXISTS (SELECT 1 FROM schedule_task_retries r WHERE r.attempt_id=d.attempt_id)`);
    }
    this.db.exec("UPDATE schedule_occurrences SET status='completed' WHERE status IN ('claimed','started') AND task_id IN (SELECT id FROM task_attempts WHERE state IN ('completed','failed','stopped'))");
    this.db.exec("UPDATE schedule_occurrences SET status='uncertain', reason='Instance restarted during execution; inspect the task before retrying' WHERE status IN ('claimed','started') OR EXISTS (SELECT 1 FROM schedule_task_retries r JOIN task_attempts a ON a.id=r.attempt_id WHERE r.schedule_id=schedule_occurrences.schedule_id AND r.due_at=schedule_occurrences.due_at AND a.state IN ('queued','running','stopping','waiting'))");
    if (version < 12 && !this.db.prepare("SELECT 1 FROM pragma_table_info('bot_profiles') WHERE name='description'").get()) this.db.exec("ALTER TABLE bot_profiles ADD COLUMN description TEXT NOT NULL DEFAULT ''");
    if (version < 13 && !this.db.prepare("SELECT 1 FROM pragma_table_info('task_attempts') WHERE name='delegation_clock'").get()) this.db.exec('ALTER TABLE task_attempts ADD COLUMN delegation_clock INTEGER NOT NULL DEFAULT 0 CHECK(delegation_clock IN (0,1))');
    if (version < 14 && !this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collaboration_assignments'").get()) this.db.exec(collaborationSchema);
    this.db.exec("UPDATE collaboration_assignments SET state='cancelled' WHERE state='active'");
    if (version < 15) this.db.exec(`CREATE TABLE IF NOT EXISTS disclosure_requests (id TEXT PRIMARY KEY, parent_attempt_id TEXT NOT NULL REFERENCES task_attempts(id), sender_bot_id TEXT NOT NULL REFERENCES bots(id), recipient_bot_id TEXT NOT NULL REFERENCES bots(id), kind TEXT NOT NULL CHECK(kind IN ('request','question','answer','result','failure')), content TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','approved','denied','consumed','interrupted')), CHECK(sender_bot_id<>recipient_bot_id))`);
    this.db.exec("UPDATE disclosure_requests SET state='interrupted' WHERE state IN ('pending','approved')");
    if (version < 16) this.db.exec("CREATE TABLE IF NOT EXISTS command_task_starts (command_id TEXT PRIMARY KEY REFERENCES commands(id), call_id TEXT NOT NULL, digest TEXT NOT NULL, attempt_id TEXT REFERENCES task_attempts(id), outcome TEXT NOT NULL CHECK(outcome IN ('accepted','busy')))");
    if (version < 17) this.db.exec("CREATE TABLE IF NOT EXISTS creation_defaults (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT, reasoning TEXT); INSERT OR IGNORE INTO creation_defaults (id,revision,provider,model,reasoning) VALUES (1,1,'demo',NULL,NULL)");
    if(version < 18){if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='action_journal'").get())this.db.exec(actionJournalSchema);this.db.exec("CREATE TABLE IF NOT EXISTS web_permissions (scope TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK(enabled IN (0,1))); CREATE TABLE IF NOT EXISTS web_action_decisions (action_id TEXT PRIMARY KEY REFERENCES action_journal(id), fingerprint TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('approve','deny')))");}
    this.db.exec("UPDATE action_journal SET state='uncertain',result=NULL WHERE state='started'; UPDATE action_journal SET state='cancelled',result=NULL WHERE state='prepared'");
    if(version < 19)this.db.exec("CREATE TABLE IF NOT EXISTS search_config (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,origin TEXT); INSERT OR IGNORE INTO search_config VALUES (1,1,NULL); CREATE TABLE IF NOT EXISTS search_permissions (scope TEXT PRIMARY KEY,enabled INTEGER NOT NULL CHECK(enabled IN (0,1))); CREATE TABLE IF NOT EXISTS search_action_decisions (action_id TEXT PRIMARY KEY REFERENCES action_journal(id),fingerprint TEXT NOT NULL,decision TEXT NOT NULL CHECK(decision IN ('approve','deny'))); CREATE TABLE IF NOT EXISTS search_dispatches (action_id TEXT PRIMARY KEY REFERENCES action_journal(id),started_ms INTEGER NOT NULL)");
    if(version < 20)this.db.exec("CREATE TABLE IF NOT EXISTS shell_config (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,docker_binary TEXT,docker_socket TEXT,image_id TEXT); INSERT OR IGNORE INTO shell_config VALUES (1,1,NULL,NULL,NULL); CREATE TABLE IF NOT EXISTS shell_permissions (scope TEXT PRIMARY KEY,enabled INTEGER NOT NULL CHECK(enabled IN (0,1))); CREATE TABLE IF NOT EXISTS shell_action_configs (action_id TEXT PRIMARY KEY REFERENCES action_journal(id),fingerprint TEXT NOT NULL,docker_binary TEXT NOT NULL,docker_socket TEXT NOT NULL,image_id TEXT NOT NULL,decision TEXT NOT NULL CHECK(decision IN ('approve','deny'))); CREATE TABLE IF NOT EXISTS shell_lock (id INTEGER PRIMARY KEY CHECK(id=1),action_id TEXT NOT NULL UNIQUE REFERENCES action_journal(id)); CREATE TABLE IF NOT EXISTS shell_reviews (action_id TEXT PRIMARY KEY REFERENCES action_journal(id),reviewed_ms INTEGER NOT NULL)");
    if(version < 21)this.db.exec(approvalGrantSchema);
    if(version < 22)this.db.exec("CREATE TABLE IF NOT EXISTS schedule_web_scopes (attempt_id TEXT PRIMARY KEY REFERENCES task_attempts(id), url TEXT NOT NULL); CREATE TABLE IF NOT EXISTS schedule_web_dispatches (schedule_id TEXT NOT NULL, due_at INTEGER NOT NULL, action_id TEXT PRIMARY KEY REFERENCES action_journal(id), FOREIGN KEY(schedule_id,due_at) REFERENCES schedule_occurrences(schedule_id,due_at))");
    if(version < 23)this.db.exec("CREATE TABLE IF NOT EXISTS schedule_search_scopes (attempt_id TEXT PRIMARY KEY REFERENCES task_attempts(id), query TEXT NOT NULL, origin TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS schedule_search_dispatches (schedule_id TEXT NOT NULL, due_at INTEGER NOT NULL, action_id TEXT PRIMARY KEY REFERENCES action_journal(id), FOREIGN KEY(schedule_id,due_at) REFERENCES schedule_occurrences(schedule_id,due_at))");
    if(version < 24)this.db.exec("CREATE TABLE IF NOT EXISTS schedule_shell_scopes (attempt_id TEXT PRIMARY KEY REFERENCES task_attempts(id), command TEXT NOT NULL, docker_binary TEXT NOT NULL, docker_socket TEXT NOT NULL, image_id TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS schedule_shell_dispatches (schedule_id TEXT NOT NULL, due_at INTEGER NOT NULL, action_id TEXT PRIMARY KEY REFERENCES action_journal(id), FOREIGN KEY(schedule_id,due_at) REFERENCES schedule_occurrences(schedule_id,due_at))");
    if(version < 25)this.db.exec('CREATE TABLE IF NOT EXISTS local_bootstrap (id INTEGER PRIMARY KEY CHECK(id=1)); CREATE TABLE IF NOT EXISTS main_bot (id INTEGER PRIMARY KEY CHECK(id=1), bot_id TEXT NOT NULL REFERENCES bots(id))');
    if(version < 25 && hasBots)this.db.exec('INSERT OR IGNORE INTO local_bootstrap VALUES (1)');
    if(version < 26)this.db.exec('CREATE TABLE IF NOT EXISTS command_runtime_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, command_id TEXT NOT NULL REFERENCES commands(id), type TEXT NOT NULL, name TEXT NOT NULL, success INTEGER)');
    if(version < 27)this.db.exec('CREATE TABLE IF NOT EXISTS bot_creation_operations (id TEXT PRIMARY KEY, digest TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id))');
    if(version < 28)this.db.exec("CREATE TABLE IF NOT EXISTS response_progress (command_id TEXT PRIMARY KEY REFERENCES commands(id), text TEXT NOT NULL DEFAULT '')");
    if(version < 29)this.db.exec("CREATE TABLE IF NOT EXISTS response_stops (command_id TEXT PRIMARY KEY REFERENCES commands(id))");
    if(version < 31 && !this.db.prepare("SELECT 1 FROM pragma_table_info('creation_defaults') WHERE name='tool_mode'").get())this.db.exec("ALTER TABLE creation_defaults ADD COLUMN tool_mode TEXT NOT NULL DEFAULT 'hybrid'");
    if(version < 32) {
      this.db.exec(workActionsSchema);
      this.db.exec("CREATE TABLE IF NOT EXISTS work_bindings (kind TEXT NOT NULL CHECK(kind IN ('command','task')), work_id TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id), working_directory TEXT NOT NULL, PRIMARY KEY(kind,work_id))");
      for (const row of this.db.prepare("SELECT 'command' AS kind,id,bot_id FROM commands UNION ALL SELECT 'task',id,bot_id FROM task_attempts").all()) {
        if ((row.kind !== 'command' && row.kind !== 'task') || typeof row.id !== 'string' || typeof row.bot_id !== 'string') throw Error('Invalid legacy work binding');
        this.bindWork({kind:row.kind,id:row.id}, row.bot_id);
      }
    }
    if(version < 34) this.db.exec('CREATE TABLE IF NOT EXISTS search_action_bindings (action_id TEXT PRIMARY KEY REFERENCES action_journal(id), fingerprint TEXT NOT NULL, work_kind TEXT NOT NULL, work_id TEXT NOT NULL, boundary TEXT NOT NULL, grant_id TEXT, grant_revision INTEGER)');
    if(version < 33) this.db.exec(`CREATE TABLE IF NOT EXISTS code_executions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, work_id TEXT NOT NULL, response_id TEXT NOT NULL, call_id TEXT NOT NULL, source TEXT NOT NULL, source_hash TEXT NOT NULL, outcome TEXT NOT NULL, result TEXT, UNIQUE(kind,work_id,response_id,call_id));`);
    this.db.exec("UPDATE code_executions SET outcome='interrupted' WHERE outcome='running'");
    if(version < 30 && !this.db.prepare("SELECT 1 FROM pragma_table_info('command_runtime_events') WHERE name='detail'").get())this.db.exec('ALTER TABLE command_runtime_events ADD COLUMN detail TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS command_runtime_events_command ON command_runtime_events(command_id,seq)');
    if (!maintenanceToken) this.db.exec(`PRAGMA user_version=${INSTANCE_SCHEMA_VERSION}`);
    for (const row of this.db.prepare("SELECT id,bot_id FROM task_attempts WHERE state IN ('queued','running','stopping','waiting') ORDER BY rowid").all()) {
      if (typeof row.id !== 'string' || typeof row.bot_id !== 'string') throw Error('Invalid interrupted task');
      this.cancelTaskInputs(row.id);
      this.taskEvent(row.id,{type:'interrupted',message:'Instance restarted during execution'});
      this.taskAnnouncement(row.bot_id,`Task ${row.id} interrupted: Instance restarted during execution`);
    }
    this.db.exec("UPDATE task_questions SET state='cancelled' WHERE state='open' AND attempt_id IN (SELECT id FROM task_attempts WHERE state IN ('queued','running','stopping','waiting'))");
    this.db.exec("UPDATE task_attempts SET state='interrupted', outcome='Instance restarted during execution' WHERE state IN ('queued','running','stopping','waiting')");
    this.db.prepare('INSERT OR IGNORE INTO bot_profiles (bot_id, revision, soul, archived) SELECT id, 1, ?, 0 FROM bots').run('');
    if (version < 2) this.db.prepare("INSERT INTO instance_secrets VALUES ('command-fingerprint', ?)").run(randomBytes(32));
    const key = this.db.prepare("SELECT value FROM instance_secrets WHERE name='command-fingerprint'").get()?.value;
    if (!(key instanceof Uint8Array) || key.length !== 32) throw Error('Invalid instance fingerprint key');
    this.fingerprintKey = key;
    const datasetKey=this.db.prepare("SELECT value FROM instance_secrets WHERE name='dataset-identity'").get()?.value;
    if(datasetKey!==undefined && (!(datasetKey instanceof Uint8Array)||datasetKey.length!==32))throw Error('Invalid dataset identity key');
    this.datasetKey=datasetKey ?? key;
    this.db.exec('COMMIT');
    // Seal valid pre-existing file configurations before accepting clients.
    this.bots();
    } catch (error) { this.db.close(); if(this.temporaryConfigRoot)rmSync(this.temporaryConfigRoot,{recursive:true,force:true}); throw error; }
  }
  private bindWork(work:WorkRef, botId:string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(botId)) throw Error('Invalid agent identity for working directory');
    const directory=join(this.agentRoot,botId,'work');
    mkdirSync(directory,{recursive:true,mode:0o700});
    this.db.prepare('INSERT OR IGNORE INTO work_bindings VALUES (?,?,?,?)').run(work.kind,work.id,botId,directory);
  }
  workContext(work:WorkRef, signal:AbortSignal) {
    const binding=this.db.prepare('SELECT bot_id,working_directory FROM work_bindings WHERE kind=? AND work_id=?').get(work.kind,work.id);
    if (typeof binding?.bot_id !== 'string' || typeof binding.working_directory !== 'string' || !isAbsolute(binding.working_directory)) throw Error('Accepted work binding unavailable');
    const row=work.kind==='command' ? this.db.prepare('SELECT profile FROM command_profiles WHERE command_id=?').get(work.id) : this.db.prepare('SELECT profile,context FROM task_attempts WHERE id=?').get(work.id);
    if (typeof row?.profile !== 'string') throw Error('Accepted work profile unavailable');
    const profile=parseCapturedProfile(JSON.parse(row.profile));
    const conversation=work.kind==='command' ? {kind:'chat' as const,conversationId:profile.chatId} : {kind:'task' as const,conversationId:profile.chatId,context:typeof row.context==='string' ? JSON.parse(row.context) : []};
    const acceptedWork={...work};freezeCaptured(acceptedWork);freezeCaptured(conversation);
    return Object.freeze({work:acceptedWork,botId:binding.bot_id,conversation,mode:profile.toolMode,workingDirectory:binding.working_directory,signal});
  }
  workActions():WorkActionService {
    if (!this.actionService) this.actionService=new WorkActionService(this.db,this.fingerprintKey,
      (work,signal)=>this.workContext(work,signal),
      work=>{
        const record=work.kind==='command' ? this.command(work.id) : this.taskAttempt(work.id);
        if (!record || typeof record.botId !== 'string' || record.state!==(work.kind==='command' ? 'pending' : 'running') || this.botIdentity(record.botId)?.archived !== false || (work.kind==='command' && this.responseStopping(work.id)) || (work.kind==='task' && this.taskHasPending(work.id))) throw Error('Work is no longer active or authorized');
      });
    return this.actionService;
  }
  private scheduleOrigin(attemptId:string) {
    return this.db.prepare(`SELECT s.id AS schedule_id, s.revoked, s.authorization, o.due_at, o.status
      FROM schedules s JOIN schedule_occurrences o ON o.schedule_id=s.id
      WHERE o.task_id=? OR EXISTS (SELECT 1 FROM schedule_task_retries r WHERE r.attempt_id=? AND r.schedule_id=o.schedule_id AND r.due_at=o.due_at)`).get(attemptId,attemptId);
  }
  datasetIdentity() { return createHmac('sha256',this.datasetKey).update('staf-dataset-identity-v1').digest('hex'); }
  scheduleClockAllowed(attemptId:string) {
    const row=this.scheduleOrigin(attemptId);
    if (!row) return true;
    if (row.revoked !== 0 || typeof row.authorization !== 'string') return false;
    const a: unknown=JSON.parse(row.authorization);
    return !!a && typeof a === 'object' && 'action' in a && a.action === 'clock.read' && 'resource' in a && a.resource === 'utc' && 'limits' in a && JSON.stringify(a.limits) === JSON.stringify({reads:'permitted'});
  }
  scheduleOccurrences(id:string) {
    return this.schedules.occurrences(id).map(occurrence=>({...occurrence,retries:this.db.prepare('SELECT a.id,a.state,a.outcome FROM schedule_task_retries r JOIN task_attempts a ON a.id=r.attempt_id WHERE r.schedule_id=? AND r.due_at=? ORDER BY r.rowid').all(id,occurrence.due_at as number)}));
  }
  get schedules() { return new ScheduleStore(this.db); }
  scheduleTick(id:string, now:number) {
    return this.schedules.tick({id,now,
      isBusy:botId=>this.taskAttempts(botId).some(attempt=>['queued','running','stopping','waiting'].includes(String(attempt.state))) || !this.botIdentity(botId) || !!this.botIdentity(botId)?.archived,
      createTask:schedule=>{
        const taskId=randomUUID();
        const result=this.acceptTaskInTransaction({id:taskId,botId:schedule.botId,objective:schedule.objective,limitMs:300000});
        if (result.kind !== 'accepted') throw new BotConflict('Agent is busy');
        if(schedule.authorization.action==='web.read')this.db.prepare('INSERT INTO schedule_web_scopes VALUES (?,?)').run(taskId,schedule.authorization.resource);
        if(schedule.authorization.action==='search.read')this.db.prepare('INSERT INTO schedule_search_scopes VALUES (?,?,?,?)').run(taskId,schedule.authorization.resource,String(schedule.authorization.limits.origin),Number(schedule.authorization.limits.revision));
        if(schedule.authorization.action==='shell.execute'){const limits=schedule.authorization.limits;this.db.prepare('INSERT INTO schedule_shell_scopes VALUES (?,?,?,?,?,?)').run(taskId,schedule.authorization.resource,String(limits.dockerBinary),String(limits.dockerSocket),String(limits.imageId),Number(limits.revision));}
        return taskId;
      }});
  }
  get skills() { return new SkillCatalog(this.db, this.redactSkill); }
  get memories() { return new MemoryStore(this.db); }
  proposeSharedMemory(botId:string,text:string,id:string=randomUUID()) {
    const clean=text.trim();
    if (!clean || clean.length>4000) throw Error('Invalid memory text');
    this.db.prepare("INSERT INTO memory_proposals VALUES (?,?,?,'pending')").run(id,botId,clean);
    return {id,state:'pending' as const};
  }
  sharedMemoryProposal(botId:string,id:string) {
    const row=this.db.prepare('SELECT id,state FROM memory_proposals WHERE id=? AND bot_id=?').get(id,botId);
    if (!row || (row.state!=='pending' && row.state!=='confirmed' && row.state!=='cancelled')) return null;
    return {id:String(row.id),state:row.state};
  }

  get #approvalGrants() { return new ApprovalGrants(this.db); }
  listApprovalGrants() { return this.#approvalGrants.list(); }
  recordGrantedDecision(input:{work:WorkRef;boundary:GrantBoundary;id:string;fingerprint:string;scope:'bot'|'all-bots';lifetime:'task'|'remembered'} & ({kind:'registered'} | {kind?:'legacy';callId:string;hop:number})):void {
    if(this.db.isTransaction!==false)throw new BotConflict('Instance connection is busy');
    this.db.exec('BEGIN IMMEDIATE');try {
      this.validateGrantBoundary(input.boundary);
      const identity=input.kind==='registered' ? this.registeredSearchIdentity(input.work,input.id,input.fingerprint,input.boundary) : (input.boundary.kind==='web'?this.webIdentity(input.work,input.callId,input.hop,input.boundary.url):input.boundary.kind==='search'?this.searchIdentity(input.work,input.callId,input.boundary.origin,input.boundary.revision,input.boundary.query):this.shellIdentity(input.work,input.callId,{revision:input.boundary.revision,dockerBinary:input.boundary.dockerBinary,dockerSocket:input.boundary.dockerSocket,imageId:input.boundary.imageId},input.boundary.command));
      if(!identity || identity.id!==input.id || identity.fingerprint!==input.fingerprint)throw new BotConflict('Grant boundary does not match action');
      const action=this.webJournal().get(input.id);
      if(!action || action.state!=='prepared' || action.fingerprint!==input.fingerprint || action.work.kind!==input.work.kind || action.work.id!==input.work.id)throw new BotConflict('Action changed');
      if(input.boundary.kind==='web')this.recordWebDecision(input.id,input.fingerprint,'approve');
      else if(input.boundary.kind==='search')this.recordSearchDecision(input.id,input.fingerprint,'approve');
      else if(input.boundary.kind==='shell')this.recordShellDecision(input.id,input.fingerprint,input.boundary,'approve');
      else throw new BotConflict('Invalid action');
      this.createApprovalGrant(input.work,input.boundary,input.scope,input.lifetime);
      this.db.exec('COMMIT');
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  private validateGrantBoundary(boundary:GrantBoundary):void {
    if(!boundary || typeof boundary!=='object')throw new BotConflict('Invalid grant boundary');
    const keys=(names:string[])=>Object.keys(boundary).sort().join(',')===names.sort().join(',');
    if(boundary.kind==='web') {
      if(!keys(['kind','url']) || typeof boundary.url!=='string' || checkedOwnerWebUrl(boundary.url).href!==boundary.url)throw new BotConflict('Invalid web grant');
    } else if(boundary.kind==='search') {
      if(!keys(['kind','query','origin','revision','results','timeoutMs']) || typeof boundary.query!=='string' || checkedSearchQuery(boundary.query)!==boundary.query || typeof boundary.origin!=='string' || checkedSearchOrigin(boundary.origin)!==boundary.origin || !Number.isSafeInteger(boundary.revision) || boundary.revision<1 || boundary.results!==10 || boundary.timeoutMs!==10000)throw new BotConflict('Invalid search grant');
    } else if(boundary.kind==='shell') {
      const config=this.shellConfig();
      if(!keys(['kind','command','dockerBinary','dockerSocket','imageId','revision','sizeBytes','maxInodes','timeoutMs','maxOutputBytes']) || typeof boundary.command!=='string' || !boundary.command.trim() || boundary.command.includes('\0') || Buffer.byteLength(boundary.command,'utf8')>8000 || boundary.dockerBinary!==config.dockerBinary || boundary.dockerSocket!==config.dockerSocket || boundary.imageId!==config.imageId || boundary.revision!==config.revision || boundary.sizeBytes!==scratchLimits.sizeBytes || boundary.maxInodes!==scratchLimits.maxInodes || boundary.timeoutMs!==scratchLimits.timeoutMs || boundary.maxOutputBytes!==scratchLimits.maxOutputBytes)throw new BotConflict('Invalid shell grant');
    } else throw new BotConflict('Unsupported grant boundary');
  }
  createApprovalGrant(work:WorkRef,boundary:GrantBoundary,scope:'bot'|'all-bots',lifetime:'task'|'remembered') {
    this.validateGrantBoundary(boundary);
    if(work.kind==='task' && this.scheduleOrigin(work.id))throw new BotConflict('Schedule grants are unsupported');
    const botId=this.webWorkBotId(work);
    if(!botId || (lifetime==='task' && work.kind!=='task') || !['bot','all-bots'].includes(scope) || !['task','remembered'].includes(lifetime))throw new BotConflict('Invalid grant scope');
    if(boundary.kind==='web' && !this.webAllowed(work))throw new BotConflict('Web access revoked');
    if(boundary.kind==='search' && !this.searchAllowed(work,boundary.origin,boundary.revision))throw new BotConflict('Search access revoked');
    if(boundary.kind==='shell' && !this.shellAllowed(work,boundary.revision))throw new BotConflict('Shell access revoked');
    return this.#approvalGrants.create(boundary,scope==='bot'?{kind:'bot',botId}:{kind:'all-bots'},lifetime==='task'?{kind:'task',taskId:work.id}:{kind:'remembered'});
  }
  approvalSettings(scope: string) {
    const row=this.db.prepare('SELECT mode,clock_enabled FROM approval_settings WHERE scope=?').get(scope);
    return { mode: typeof row?.mode === 'string' ? row.mode : null, clockEnabled: row?.clock_enabled !== 0 };
  }
  setApprovalSettings(scope:string, mode:ApprovalMode | null, clockEnabled:boolean) {
    if (!(scope === 'instance' || /^(bot|task):[\w-]+$/.test(scope)) || (scope === 'instance' && mode === null) || (mode !== null && !modes.includes(mode))) throw Error('Invalid approval settings');
    if (scope.startsWith('bot:') && !this.botIdentity(scope.slice(4))) throw Error('Agent not found');
    if (scope.startsWith('task:') && !this.taskAttempt(scope.slice(5))) throw Error('Task not found');
    this.db.prepare('INSERT INTO approval_settings VALUES (?,?,?) ON CONFLICT(scope) DO UPDATE SET mode=excluded.mode,clock_enabled=excluded.clock_enabled').run(scope,mode,clockEnabled ? 1 : 0);
    return this.approvalSettings(scope);
  }
  clockDecision(botId:string, workKind:'task'|'command', workId:string) {
    const instance=this.approvalSettings('instance'), bot=this.approvalSettings('bot:'+botId), task=workKind === 'task' ? this.approvalSettings('task:'+workId) : null;
    const assignment=workKind === 'task' ? this.db.prepare(`SELECT c.*, p.state AS parent_state, p.delegation_clock, h.state AS helper_state FROM collaboration_assignments c JOIN task_attempts p ON p.id=c.parent_attempt_id JOIN task_attempts h ON h.id=c.helper_attempt_id WHERE c.helper_attempt_id=?`).get(workId) : undefined;
    if (assignment) {
      const requesterId=String(assignment.requester_bot_id), rootId=String(assignment.parent_attempt_id);
      const requester=this.approvalSettings('bot:'+requesterId), root=this.approvalSettings('task:'+rootId);
      const permission=(enabled:boolean)=>enabled ? clockBoundary : {enabledCapabilities:[],actions:[]};
      const rootMode=root.mode ?? requester.mode ?? instance.mode, helperMode=task?.mode ?? bot.mode ?? instance.mode;
      if (!modes.some(item=>item===rootMode) || !modes.some(item=>item===helperMode)) throw Error('Invalid stored approval mode');
      const live=assignment.state === 'active' && assignment.parent_state === 'running' && assignment.helper_state === 'running' && assignment.helper_bot_id === botId && !this.botIdentity(requesterId)?.archived && !this.botIdentity(botId)?.archived && this.scheduleClockAllowed(rootId);
      return evaluateApproval({action:clockAction,botId:requesterId,taskId:rootId,scheduleId:null,now:Date.now(),instancePermissions:permission(instance.clockEnabled),botPermissions:permission(requester.clockEnabled),taskScope:live && assignment.delegation_clock === 1 && root.clockEnabled ? [clockAction] : [],modes:[rootMode as ApprovalMode],helper:{permissions:permission(bot.clockEnabled && task?.clockEnabled !== false),assignmentScope:live && assignment.delegation_clock === 1 ? [clockAction] : [],mode:helperMode as ApprovalMode},grants:[],ownerRequest:null});
    }
    const mode=task?.mode ?? bot.mode ?? instance.mode;
    if (!modes.some(item=>item===mode)) throw Error('Invalid stored approval mode');
    const permission=(enabled:boolean)=>enabled ? clockBoundary : {enabledCapabilities:[],actions:[]};
    return evaluateApproval({action:clockAction,botId,taskId:workId,scheduleId:null,now:Date.now(),instancePermissions:permission(instance.clockEnabled),botPermissions:permission(bot.clockEnabled),taskScope:task?.clockEnabled === false ? [] : [clockAction],modes:[mode as ApprovalMode],grants:[],ownerRequest:null});
  }
  openQuestions() { return this.db.prepare("SELECT q.id,q.attempt_id AS attemptId,q.text,a.bot_id AS botId FROM task_questions q JOIN task_attempts a ON a.id=q.attempt_id WHERE q.state='open' ORDER BY q.rowid").all(); }
  approvalRequests() { return this.db.prepare('SELECT id,bot_id AS botId,work_kind AS workKind,work_id AS workId,action,state FROM approval_requests ORDER BY rowid DESC').all(); }
  requestClockApproval(botId:string,workKind:'task'|'command',workId:string) {
    const id=randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("INSERT INTO approval_requests VALUES (?,?,?,?,?,'pending')").run(id,botId,workKind,workId,JSON.stringify(clockAction));
      if(workKind === 'task') this.taskEvent(workId,{type:'approval_requested',id,action:clockAction});
      this.taskAnnouncement(botId,`Approval needed for ${workKind} ${workId}: read the current UTC time (request ${id})`);
      this.db.exec('COMMIT'); return id;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  decideApproval(id:string,state:'approved'|'denied'|'interrupted') {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.db.prepare("SELECT bot_id,work_kind,work_id FROM approval_requests WHERE id=? AND state='pending'").get(id);
      if (!row || typeof row.bot_id !== 'string' || typeof row.work_kind !== 'string' || typeof row.work_id !== 'string') throw new BotConflict('Approval is no longer pending');
      if (row.work_kind === 'task' && this.taskAttempt(row.work_id)?.state !== 'running') state='interrupted';
      if (row.work_kind === 'command' && this.command(row.work_id)?.state !== 'pending') state='interrupted';
      this.db.prepare('UPDATE approval_requests SET state=? WHERE id=?').run(state,id);
      if(row.work_kind === 'task') this.taskEvent(row.work_id,{type:'approval_'+state,id});
      this.db.exec('COMMIT'); return state;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  bootstrapLocal(token: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('SELECT 1 FROM local_bootstrap WHERE id=1').get()) {
        this.authorize(token);
        this.db.prepare('INSERT INTO local_bootstrap VALUES (1)').run();
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  mainBot() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.db.prepare('SELECT bot_id FROM main_bot WHERE id=1').get();
      if (row && typeof row.bot_id === 'string') { const bot=this.bots().find(item=>item.id===row.bot_id); if (!bot) throw Error('Main bot is missing'); this.db.exec('COMMIT'); return bot; }
      const id=randomUUID(), chatId=randomUUID(), defaults=this.creationDefaults();
      this.configs.publish(id,{name:'Staf',description:'',provider:defaults.provider,model:defaults.model,reasoning:defaults.reasoning,toolMode:defaults.toolMode,instructions:starterSoul},false);
      this.db.prepare('INSERT INTO bots VALUES (?, ?, ?, ?, ?, ?, ?)').run(id,chatId,'','','demo',null,null);
      this.db.prepare('INSERT INTO bot_profiles (bot_id,revision,soul,archived) VALUES (?, 1, ?, 0)').run(id,'');
      this.db.prepare('INSERT INTO main_bot VALUES (1,?)').run(id);
      const bot=this.bot(id); this.db.exec('COMMIT'); return bot;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  authorize(token: string) { this.db.prepare('INSERT INTO clients VALUES (?)').run(createHash('sha256').update(token).digest('hex')); }
  authorized(token: string) { return !!this.db.prepare('SELECT 1 FROM clients WHERE token_hash=?').get(createHash('sha256').update(token).digest('hex')); }
  clients(token: string) {
    const current = createHash('sha256').update(token).digest('hex');
    return this.db.prepare('SELECT token_hash FROM clients ORDER BY rowid').all().flatMap(row => {
      if (typeof row.token_hash !== 'string') return [];
      return [{id: createHash('sha256').update('staf-client:' + row.token_hash).digest('hex'), current: row.token_hash === current}];
    });
  }
  revokeClient(id: string) {
    for (const row of this.db.prepare('SELECT token_hash FROM clients').all()) {
      if (typeof row.token_hash === 'string' && createHash('sha256').update('staf-client:' + row.token_hash).digest('hex') === id) {
        this.db.prepare('DELETE FROM clients WHERE token_hash=?').run(row.token_hash); return true;
      }
    }
    return false;
  }
  finishUpgrade(token:string) {
    if (!this.maintenanceToken || this.maintenanceToken!==token) throw Error('Invalid upgrade maintenance token.');
    this.db.exec(`PRAGMA user_version=${INSTANCE_SCHEMA_VERSION}`);this.maintenanceToken=undefined;
  }
  close() { this.db.close(); if(this.temporaryConfigRoot)rmSync(this.temporaryConfigRoot,{recursive:true,force:true}); }
  shellConfig() {const row=this.db.prepare('SELECT revision,docker_binary AS dockerBinary,docker_socket AS dockerSocket,image_id AS imageId FROM shell_config WHERE id=1').get();if(!row || typeof row.revision!=='number' || !(row.dockerBinary===null || typeof row.dockerBinary==='string') || !(row.dockerSocket===null || typeof row.dockerSocket==='string') || !(row.imageId===null || typeof row.imageId==='string'))throw Error('Invalid shell configuration');return {revision:row.revision,dockerBinary:row.dockerBinary,dockerSocket:row.dockerSocket,imageId:row.imageId};}
  shellUnresolved() {return this.db.prepare("SELECT a.id,a.state,a.summary,c.docker_binary AS dockerBinary,c.docker_socket AS dockerSocket,c.image_id AS imageId FROM action_journal a LEFT JOIN shell_action_configs c ON c.action_id=a.id WHERE a.summary='Run scratch command' AND a.state='uncertain' AND NOT EXISTS (SELECT 1 FROM shell_reviews r WHERE r.action_id=a.id) ORDER BY a.rowid").all();}
  shellBusy() {return !!this.db.prepare("SELECT 1 FROM action_journal a WHERE a.summary='Run scratch command' AND (a.state='started' OR (a.state='uncertain' AND NOT EXISTS (SELECT 1 FROM shell_reviews r WHERE r.action_id=a.id))) LIMIT 1").get() || !!this.db.prepare('SELECT 1 FROM shell_lock').get();}
  setShellConfig(input:{revision:number;dockerBinary:string|null;dockerSocket:string|null;imageId:string|null}) {if(!Number.isSafeInteger(input.revision) || input.revision<1)throw Error('Invalid shell configuration');const empty=input.dockerBinary===null && input.dockerSocket===null && input.imageId===null;if(!empty && !(typeof input.dockerBinary==='string' && isAbsolute(input.dockerBinary) && resolve(input.dockerBinary)===input.dockerBinary && typeof input.dockerSocket==='string' && isAbsolute(input.dockerSocket) && resolve(input.dockerSocket)===input.dockerSocket && typeof input.imageId==='string' && /^sha256:[a-f0-9]{64}$/.test(input.imageId)))throw Error('Invalid shell configuration');if(this.shellBusy())throw new BotConflict('Review or settle shell work before changing its daemon');const r=this.db.prepare('UPDATE shell_config SET revision=revision+1,docker_binary=?,docker_socket=?,image_id=? WHERE id=1 AND revision=?').run(input.dockerBinary,input.dockerSocket,input.imageId,input.revision);if(!r.changes)throw new BotConflict('Shell configuration changed. Refresh before editing.');return this.shellConfig();}
  shellPermission(scope:string) {
    if(!(scope==='instance'||/^(bot|task):[\w-]+$/.test(scope)))throw Error('Invalid shell scope');const row=this.db.prepare('SELECT enabled FROM shell_permissions WHERE scope=?').get(scope),enabled=row?.enabled===1;if(!scope.startsWith('task:'))return {enabled};
    const id=scope.slice(5),scheduled=this.scheduleShellScope(id),override=row?(enabled?'enabled':'disabled'):'inherit',scopeEnabled=scheduled?row?.enabled!==0:enabled,config=this.shellConfig();
    const unspent=!scheduled || !this.db.prepare('SELECT 1 FROM schedule_shell_dispatches WHERE schedule_id=? AND due_at=?').get(scheduled.scheduleId,scheduled.dueAt);
    const effective=this.shellCanOffer({kind:'task',id}) && scopeEnabled && unspent && !this.taskHasPending(id) && !this.shellBusy() && (!scheduled || (config.revision===scheduled.revision && config.dockerBinary===scheduled.dockerBinary && config.dockerSocket===scheduled.dockerSocket && config.imageId===scheduled.imageId));
    return {enabled,override,inheritedSchedule:!!scheduled,scopeEnabled,effective,scheduledCommand:scheduled?.command??null};
  }
  setShellPermission(scope:string,enabled:boolean) {if(!(scope==='instance'||/^(bot|task):[\w-]+$/.test(scope))||typeof enabled!=='boolean')throw Error('Invalid shell scope');if(scope.startsWith('bot:')&&!this.botIdentity(scope.slice(4)))throw Error('Agent not found');if(scope.startsWith('task:')&&!this.taskAttempt(scope.slice(5)))throw Error('Task not found');this.db.prepare('INSERT INTO shell_permissions VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET enabled=excluded.enabled').run(scope,enabled?1:0);return this.shellPermission(scope);}
  scheduleShellScope(attemptId:string) {
    const origin=this.scheduleOrigin(attemptId),scope=this.db.prepare('SELECT command,docker_binary,docker_socket,image_id,revision FROM schedule_shell_scopes WHERE attempt_id=?').get(attemptId);
    if(!origin || origin.revoked!==0 || typeof origin.authorization!=='string' || typeof scope?.command!=='string' || typeof scope.docker_binary!=='string' || typeof scope.docker_socket!=='string' || typeof scope.image_id!=='string' || typeof scope.revision!=='number')return null;
    let a:unknown;try{a=JSON.parse(origin.authorization);}catch{return null;}
    if(!a || typeof a!=='object' || !('action' in a) || a.action!=='shell.execute' || !('resource' in a) || a.resource!==scope.command || !('limits' in a) || JSON.stringify(a.limits)!==JSON.stringify({maxExecutions:1,dockerBinary:scope.docker_binary,dockerSocket:scope.docker_socket,imageId:scope.image_id,revision:scope.revision,...scratchLimits}))return null;
    return {command:scope.command,dockerBinary:scope.docker_binary,dockerSocket:scope.docker_socket,imageId:scope.image_id,revision:scope.revision,scheduleId:String(origin.schedule_id),dueAt:Number(origin.due_at)};
  }
  shellCanOffer(work:WorkRef) {const record=work.kind==='task'?this.taskAttempt(work.id):this.command(work.id),config=this.shellConfig();if(!record||typeof record.botId!=='string'||record.state!==(work.kind==='task'?'running':'pending')||!config.dockerBinary||!config.dockerSocket||!config.imageId||!this.shellPermission('instance').enabled||!this.shellPermission('bot:'+record.botId).enabled||!this.botIdentity(record.botId)||this.botIdentity(record.botId)?.archived)return false;if(work.kind!=='task')return true;if(this.isHelperAttempt(work.id))return false;return !this.scheduleOrigin(work.id)||!!this.scheduleShellScope(work.id);}
  shellAllowed(work:WorkRef,revision:number,command?:string) {if(!this.shellCanOffer(work)||this.shellConfig().revision!==revision||this.shellBusy())return false;if(work.kind!=='task')return true;const origin=this.scheduleOrigin(work.id);if(origin){const scope=this.scheduleShellScope(work.id),row=this.db.prepare('SELECT enabled FROM shell_permissions WHERE scope=?').get('task:'+work.id),config=this.shellConfig();if(!scope||row?.enabled===0||scope.revision!==revision||scope.dockerBinary!==config.dockerBinary||scope.dockerSocket!==config.dockerSocket||scope.imageId!==config.imageId||(command!==undefined && scope.command!==command)||this.db.prepare('SELECT 1 FROM schedule_shell_dispatches WHERE schedule_id=? AND due_at=?').get(scope.scheduleId,scope.dueAt))return false;}else if(!this.shellPermission('task:'+work.id).enabled)return false;return !this.taskHasPending(work.id);}
  shellIdentity(work:WorkRef,callId:string,config:{revision:number;dockerBinary:string;dockerSocket:string;imageId:string},command:string) {const hex=createHmac('sha256',this.fingerprintKey).update(JSON.stringify(['shell-id',work.kind,work.id,callId])).digest('hex').slice(0,32).split('');hex[12]='4';hex[16]=['8','9','a','b'][parseInt(hex[16] ?? '0',16)%4] ?? '8';const raw=hex.join(''),id=`${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;return {id,fingerprint:createHmac('sha256',this.fingerprintKey).update(JSON.stringify(['shell-action',work.kind,work.id,callId,config,command,scratchLimits])).digest('hex')};}
  recordShellDecision(id:string,fingerprint:string,config:{dockerBinary:string;dockerSocket:string;imageId:string},decision:'approve'|'deny') {this.db.prepare('INSERT INTO shell_action_configs VALUES (?,?,?,?,?,?)').run(id,fingerprint,config.dockerBinary,config.dockerSocket,config.imageId,decision);}
  reserveShell(id:string) {this.db.exec('BEGIN IMMEDIATE');try{const other=this.db.prepare("SELECT 1 FROM action_journal a WHERE a.id<>? AND a.summary='Run scratch command' AND (a.state='started' OR (a.state='uncertain' AND NOT EXISTS (SELECT 1 FROM shell_reviews r WHERE r.action_id=a.id))) LIMIT 1").get(id);if(other||this.db.prepare('SELECT 1 FROM shell_lock').get()){this.db.exec('ROLLBACK');return false;}this.db.prepare('INSERT INTO shell_lock VALUES (1,?)').run(id);this.db.exec('COMMIT');return true;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  reserveScheduledShell(work:WorkRef,id:string,revision:number,command:string) {
    if(work.kind!=='task' || !this.scheduleOrigin(work.id))return this.reserveShell(id);
    if(this.db.isTransaction!==false)throw new BotConflict('Instance connection is busy');this.db.exec('BEGIN IMMEDIATE');try{
      const scope=this.scheduleShellScope(work.id),config=this.shellConfig(),row=this.db.prepare('SELECT enabled FROM shell_permissions WHERE scope=?').get('task:'+work.id);
      const other=this.db.prepare("SELECT 1 FROM action_journal a WHERE a.id<>? AND a.summary='Run scratch command' AND (a.state='started' OR (a.state='uncertain' AND NOT EXISTS (SELECT 1 FROM shell_reviews r WHERE r.action_id=a.id))) LIMIT 1").get(id);
      if(!scope || !this.shellCanOffer(work) || row?.enabled===0 || this.taskHasPending(work.id) || scope.command!==command || scope.revision!==revision || config.revision!==revision || config.dockerBinary!==scope.dockerBinary || config.dockerSocket!==scope.dockerSocket || config.imageId!==scope.imageId || other || this.db.prepare('SELECT 1 FROM shell_lock').get() || this.db.prepare('SELECT 1 FROM schedule_shell_dispatches WHERE schedule_id=? AND due_at=?').get(scope.scheduleId,scope.dueAt)){this.db.exec('ROLLBACK');return false;}
      this.db.prepare('INSERT INTO shell_lock VALUES (1,?)').run(id);this.db.prepare('INSERT INTO schedule_shell_dispatches VALUES (?,?,?)').run(scope.scheduleId,scope.dueAt,id);this.db.exec('COMMIT');return true;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  releaseShell(id:string) {this.db.prepare('DELETE FROM shell_lock WHERE id=1 AND action_id=?').run(id);}
  reviewShell(id:string) {this.db.exec('BEGIN IMMEDIATE');try{const row=this.db.prepare("SELECT c.docker_binary,c.docker_socket,c.image_id FROM action_journal a JOIN shell_action_configs c ON c.action_id=a.id WHERE a.id=? AND a.summary='Run scratch command' AND a.state='uncertain' AND NOT EXISTS (SELECT 1 FROM shell_reviews r WHERE r.action_id=a.id)").get(id),config=this.shellConfig();if(!row || row.docker_binary!==config.dockerBinary || row.docker_socket!==config.dockerSocket || row.image_id!==config.imageId)throw new BotConflict('Uncertain action or recorded endpoint configuration not found');this.db.prepare('INSERT INTO shell_reviews VALUES (?,?)').run(id,Date.now());this.releaseShell(id);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}}
  shellActions(work:WorkRef) {return this.db.prepare(`SELECT id,state,summary,result FROM action_journal WHERE ${work.kind==='task'?'task_attempt_id':'command_id'}=? AND summary='Run scratch command' ORDER BY rowid`).all(work.id);}
  searchConfig() {const row=this.db.prepare('SELECT revision,origin FROM search_config WHERE id=1').get();if(!row || typeof row.revision !== 'number' || !(row.origin === null || typeof row.origin === 'string'))throw Error('Invalid search configuration');return {revision:row.revision,origin:row.origin};}
  setSearchConfig(input:{revision:number;origin:string|null}) {if(!Number.isSafeInteger(input.revision) || input.revision<1 || !(input.origin===null || typeof input.origin==='string'))throw Error('Invalid search configuration');const origin=input.origin===null ? null : checkedSearchOrigin(input.origin);const result=this.db.prepare('UPDATE search_config SET revision=revision+1,origin=? WHERE id=1 AND revision=?').run(origin,input.revision);if(!result.changes)throw new BotConflict('Search configuration changed. Refresh before editing.');return this.searchConfig();}
  searchPermission(scope:string) {
    if (!(scope === 'instance' || /^(bot|task):[\w-]+$/.test(scope)))throw Error('Invalid search scope');
    const row=this.db.prepare('SELECT enabled FROM search_permissions WHERE scope=?').get(scope),enabled=row?.enabled===1;if(!scope.startsWith('task:'))return {enabled};
    const id=scope.slice(5),scheduled=this.scheduleSearchScope(id),override=row?(enabled?'enabled':'disabled'):'inherit',scopeEnabled=scheduled?row?.enabled!==0:enabled;
    const unspent=!scheduled || !this.db.prepare('SELECT 1 FROM schedule_search_dispatches WHERE schedule_id=? AND due_at=?').get(scheduled.scheduleId,scheduled.dueAt);
    const config=this.searchConfig(),effective=this.searchCanOffer({kind:'task',id}) && scopeEnabled && unspent && !this.taskHasPending(id) && !!scheduled && config.origin===scheduled.origin && config.revision===scheduled.revision;
    return {enabled,override,inheritedSchedule:!!scheduled,scopeEnabled,effective:scheduled?effective:this.searchCanOffer({kind:'task',id}) && scopeEnabled && !this.taskHasPending(id),scheduledQuery:scheduled?.query??null,scheduledOrigin:scheduled?.origin??null};
  }
  setSearchPermission(scope:string,enabled:boolean) {if (!(scope === 'instance' || /^(bot|task):[\w-]+$/.test(scope)) || typeof enabled !== 'boolean')throw Error('Invalid search scope');if(scope.startsWith('bot:') && !this.botIdentity(scope.slice(4)))throw Error('Agent not found');if(scope.startsWith('task:') && !this.taskAttempt(scope.slice(5)))throw Error('Task not found');this.db.prepare('INSERT INTO search_permissions VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET enabled=excluded.enabled').run(scope,enabled ? 1 : 0);return this.searchPermission(scope);}
  scheduleSearchScope(attemptId:string) {
    const origin=this.scheduleOrigin(attemptId),scope=this.db.prepare('SELECT query,origin,revision FROM schedule_search_scopes WHERE attempt_id=?').get(attemptId);
    if(!origin || origin.revoked!==0 || typeof origin.authorization!=='string' || typeof scope?.query!=='string' || typeof scope.origin!=='string' || typeof scope.revision!=='number')return null;
    let a:unknown;try{a=JSON.parse(origin.authorization);}catch{return null;}
    if(!a || typeof a!=='object' || !('action' in a) || a.action!=='search.read' || !('resource' in a) || a.resource!==scope.query || !('limits' in a) || JSON.stringify(a.limits)!==JSON.stringify({maxSearches:1,origin:scope.origin,revision:scope.revision}))return null;
    return {query:scope.query,origin:scope.origin,revision:scope.revision,scheduleId:String(origin.schedule_id),dueAt:Number(origin.due_at)};
  }
  searchCanOffer(work:WorkRef) {const record=work.kind==='task' ? this.taskAttempt(work.id) : this.command(work.id);if(!record || typeof record.botId!=='string' || record.state !== (work.kind==='task' ? 'running' : 'pending'))return false;if(!this.botIdentity(record.botId) || this.botIdentity(record.botId)?.archived || !this.searchConfig().origin || !this.searchPermission('instance').enabled || !this.searchPermission('bot:'+record.botId).enabled)return false;if(work.kind!=='task')return true;if(this.isHelperAttempt(work.id))return false;return !this.scheduleOrigin(work.id) || !!this.scheduleSearchScope(work.id);}
  searchAllowed(work:WorkRef,origin:string,revision:number,query?:string,actionId?:string) {if(!this.searchCanOffer(work) || this.searchConfig().origin!==origin || this.searchConfig().revision!==revision)return false;if(work.kind!=='task')return true;const scheduled=this.scheduleOrigin(work.id);if(scheduled){const scope=this.scheduleSearchScope(work.id),row=this.db.prepare('SELECT enabled FROM search_permissions WHERE scope=?').get('task:'+work.id);if(!scope || row?.enabled===0 || scope.origin!==origin || scope.revision!==revision || (query!==undefined && query!==scope.query) || this.db.prepare('SELECT 1 FROM schedule_search_dispatches WHERE schedule_id=? AND due_at=? AND action_id<>?').get(scope.scheduleId,scope.dueAt,actionId ?? ''))return false;}else if(!this.searchPermission('task:'+work.id).enabled)return false;return !this.taskHasPending(work.id);}
  claimScheduledSearchDispatch(work:WorkRef,origin:string,revision:number,query:string,actionId:string) {
    if(work.kind!=='task' || !this.scheduleOrigin(work.id))return true;
    if(this.db.isTransaction!==false)throw new BotConflict('Instance connection is busy');this.db.exec('BEGIN IMMEDIATE');try{const scope=this.scheduleSearchScope(work.id);if(!scope || !this.searchAllowed(work,origin,revision,query)){this.db.exec('ROLLBACK');return false;}this.db.prepare('INSERT INTO schedule_search_dispatches VALUES (?,?,?)').run(scope.scheduleId,scope.dueAt,actionId);this.db.exec('COMMIT');return true;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  searchIdentity(work:WorkRef,callId:string,origin:string,revision:number,query:string) {return {id:createHmac('sha256',this.fingerprintKey).update(JSON.stringify(['search-id',work.kind,work.id,callId])).digest('hex'),fingerprint:createHmac('sha256',this.fingerprintKey).update(JSON.stringify(['search-action',work.kind,work.id,callId,origin,revision,query,{results:10,timeoutMs:10000}])).digest('hex')};}
  bindRegisteredSearch(work:WorkRef,action:ActionIdentity,boundary:Extract<GrantBoundary,{kind:'search'}>) {
    this.validateGrantBoundary(boundary);
    const record=this.webJournal().get(action.id);
    if(!record || record.state!=='prepared' || record.fingerprint!==action.fingerprint || record.work.kind!==work.kind || record.work.id!==work.id || !this.searchAllowed(work,boundary.origin,boundary.revision,boundary.query))throw new BotConflict('Search action changed');
    this.db.prepare('INSERT INTO search_action_bindings VALUES (?,?,?,?,?,NULL,NULL)').run(action.id,action.fingerprint,work.kind,work.id,JSON.stringify(boundary));
  }
  private registeredSearchIdentity(work:WorkRef,id:string,fingerprint:string,boundary:GrantBoundary):ActionIdentity|null {
    const row=this.db.prepare('SELECT fingerprint,work_kind,work_id,boundary FROM search_action_bindings WHERE action_id=?').get(id);
    if(!row)return null;
    if(row.fingerprint!==fingerprint || row.work_kind!==work.kind || row.work_id!==work.id || row.boundary!==JSON.stringify(boundary))throw new BotConflict('Search binding changed');
    return {id,fingerprint};
  }
  registeredSearchBoundary(work:WorkRef,action:ActionIdentity,query:string) {
    const row=this.db.prepare('SELECT boundary,grant_id,grant_revision FROM search_action_bindings WHERE action_id=?').get(action.id);
    if(typeof row?.boundary!=='string')throw new BotConflict('Search binding unavailable');
    const boundary:GrantBoundary=JSON.parse(row.boundary);this.validateGrantBoundary(boundary);
    if(boundary.kind!=='search' || boundary.query!==query || !this.registeredSearchIdentity(work,action.id,action.fingerprint,boundary) || !this.searchAllowed(work,boundary.origin,boundary.revision,query,action.id))throw new BotConflict('Search scope changed');
    if(typeof row.grant_id==='string') {
      const botId=this.webWorkBotId(work),grant=this.#approvalGrants.list().find(g=>g.id===row.grant_id);
      if(!botId || !grant || grant.revoked || grant.revision!==row.grant_revision || JSON.stringify(grant.boundary)!==row.boundary || (grant.scope.kind==='bot' && grant.scope.botId!==botId) || (grant.lifetime.kind==='task' && (work.kind!=='task' || grant.lifetime.taskId!==work.id)))throw new BotConflict('Search grant revoked');
    }
    return boundary;
  }
  assertRegisteredSearchDecision(work:WorkRef,action:ActionIdentity,query:string):void {
    this.registeredSearchBoundary(work,action,query);
    const decision=this.db.prepare('SELECT fingerprint,decision FROM search_action_decisions WHERE action_id=?').get(action.id);
    if(decision?.fingerprint!==action.fingerprint || decision.decision!=='approve')throw new BotConflict('Search decision changed');
  }
  claimRegisteredSearchGrant(work:WorkRef,action:ActionIdentity,query:string,controller:AbortController):string {
    if(!this.db.isTransaction || controller.signal.aborted)throw new BotConflict('Search claim requires active transaction');
    const boundary=this.registeredSearchBoundary(work,action,query),botId=this.webWorkBotId(work);
    if(!botId || !this.matchingApprovalGrant(work,boundary))throw new BotConflict('Search grant changed');
    const grantId=this.#approvalGrants.matchingId(boundary,botId,work.kind==='task'?work.id:null);
    const record=this.webJournal().get(action.id);
    if(!grantId || !record || record.state!=='prepared')throw new BotConflict('Search grant or action changed');
    const grant=this.#approvalGrants.list().find(item=>item.id===grantId);if(!grant)throw new BotConflict('Search grant changed');
    this.db.prepare('UPDATE search_action_bindings SET grant_id=?,grant_revision=? WHERE action_id=?').run(grantId,grant.revision,action.id);
    const controllers=this.grantControllers.get(grantId)??new Set<AbortController>();controllers.add(controller);this.grantControllers.set(grantId,controllers);
    return grantId;
  }
  recordSearchDecision(id:string,fingerprint:string,decision:'approve'|'deny') {this.db.prepare('INSERT INTO search_action_decisions VALUES (?,?,?)').run(id,fingerprint,decision);}
  claimSearchDispatch(id:string,now:number) {this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('DELETE FROM search_dispatches WHERE started_ms<?').run(now-60000);const count=Number(this.db.prepare('SELECT count(*) AS count FROM search_dispatches').get()?.count);if(count>=10){this.db.exec('ROLLBACK');return false;}this.db.prepare('INSERT INTO search_dispatches VALUES (?,?)').run(id,now);this.db.exec('COMMIT');return true;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  searchActions(work:WorkRef) {return this.db.prepare(`SELECT id,state,summary,result FROM action_journal WHERE ${work.kind==='task' ? 'task_attempt_id' : 'command_id'}=? AND summary='Search configured backend' ORDER BY rowid`).all(work.id);}
  webPermission(scope:string) {
    if (!(scope === 'instance' || /^(bot|task):[\w-]+$/.test(scope)))throw Error('Invalid web scope');
    const row=this.db.prepare('SELECT enabled FROM web_permissions WHERE scope=?').get(scope),enabled=row?.enabled===1;
    if(!scope.startsWith('task:'))return {enabled};
    const id=scope.slice(5),scheduled=this.scheduleWebScope(id),override=row ? (enabled?'enabled':'disabled') : 'inherit';
    const scopeEnabled=scheduled ? row?.enabled!==0 : enabled;
    const unspent=!scheduled || !this.db.prepare('SELECT 1 FROM schedule_web_dispatches WHERE schedule_id=? AND due_at=?').get(scheduled.scheduleId,scheduled.dueAt);
    const effective=this.webCanOffer({kind:'task',id}) && scopeEnabled && unspent && !this.taskHasPending(id);
    return {enabled,override,inheritedSchedule:!!scheduled,scopeEnabled,effective,scheduledUrl:scheduled?.url ?? null};
  }
  setWebPermission(scope:string,enabled:boolean) {if (!(scope === 'instance' || /^(bot|task):[\w-]+$/.test(scope)) || typeof enabled !== 'boolean')throw Error('Invalid web scope');if(scope.startsWith('bot:') && !this.botIdentity(scope.slice(4)))throw Error('Agent not found');if(scope.startsWith('task:') && !this.taskAttempt(scope.slice(5)))throw Error('Task not found');this.db.prepare('INSERT INTO web_permissions VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET enabled=excluded.enabled').run(scope,enabled ? 1 : 0);return this.webPermission(scope);}
  webWorkBotId(work:WorkRef) {const record=work.kind==='task' ? this.taskAttempt(work.id) : this.command(work.id);return typeof record?.botId==='string' ? record.botId : undefined;}
  scheduleWebScope(attemptId:string) {
    const origin=this.scheduleOrigin(attemptId),scope=this.db.prepare('SELECT url FROM schedule_web_scopes WHERE attempt_id=?').get(attemptId);
    if(!origin || origin.revoked!==0 || typeof origin.authorization!=='string' || typeof scope?.url!=='string')return null;
    let authorization:unknown;try {authorization=JSON.parse(origin.authorization);}catch{return null;}
    if(!authorization || typeof authorization!=='object' || !('action' in authorization) || authorization.action!=='web.read' || !('resource' in authorization) || authorization.resource!==scope.url || !('limits' in authorization) || JSON.stringify(authorization.limits)!==JSON.stringify({maxReads:1}))return null;
    return {url:scope.url,scheduleId:String(origin.schedule_id),dueAt:Number(origin.due_at)};
  }
  scheduleOwnsAttempt(attemptId:string,scheduleId:string) {return this.scheduleOrigin(attemptId)?.schedule_id===scheduleId;}
  webCanOffer(work:WorkRef) {const record=work.kind==='task' ? this.taskAttempt(work.id) : this.command(work.id);if(!record || typeof record.botId!=='string' || record.state !== (work.kind==='task' ? 'running' : 'pending'))return false;if(!this.botIdentity(record.botId) || this.botIdentity(record.botId)?.archived || !this.webPermission('instance').enabled || !this.webPermission('bot:'+record.botId).enabled)return false;if(work.kind!=='task')return true;if(this.isHelperAttempt(work.id))return false;const origin=this.scheduleOrigin(work.id);return !origin || !!this.scheduleWebScope(work.id);}
  webAllowed(work:WorkRef,url?:string) {if(!this.webCanOffer(work))return false;if(work.kind==='task'){const origin=this.scheduleOrigin(work.id);if(origin){const scope=this.scheduleWebScope(work.id);const setting=this.db.prepare('SELECT enabled FROM web_permissions WHERE scope=?').get('task:'+work.id);if(!scope || setting?.enabled===0 || (url!==undefined && url!==scope.url) || this.db.prepare('SELECT 1 FROM schedule_web_dispatches WHERE schedule_id=? AND due_at=?').get(scope.scheduleId,scope.dueAt))return false;}else if(!this.webPermission('task:'+work.id).enabled)return false;if(this.taskHasPending(work.id))return false;}return true;}
  claimScheduledWebDispatch(work:WorkRef,url:string,actionId:string) {
    if(work.kind!=='task' || !this.scheduleOrigin(work.id))return true;
    if(this.db.isTransaction!==false)throw new BotConflict('Instance connection is busy');this.db.exec('BEGIN IMMEDIATE');try{const scope=this.scheduleWebScope(work.id);if(!scope || !this.webAllowed(work,url) || this.db.prepare('SELECT 1 FROM schedule_web_dispatches WHERE schedule_id=? AND due_at=?').get(scope.scheduleId,scope.dueAt)){this.db.exec('ROLLBACK');return false;}this.db.prepare('INSERT INTO schedule_web_dispatches VALUES (?,?,?)').run(scope.scheduleId,scope.dueAt,actionId);this.db.exec('COMMIT');return true;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  webIdentity(work:WorkRef,callId:string,hop:number,url:string) {return {id:createHmac('sha256',this.fingerprintKey).update(JSON.stringify(['web-id',work.kind,work.id,callId,hop])).digest('hex'),fingerprint:createHmac('sha256',this.fingerprintKey).update(JSON.stringify(['web-action',work.kind,work.id,callId,hop,url])).digest('hex')};}
  matchingApprovalGrant(work:WorkRef,boundary:GrantBoundary):boolean {
    const botId=this.webWorkBotId(work);if(!botId || (work.kind==='task' && this.scheduleOrigin(work.id)))return false;
    const mode=(work.kind==='task'?this.approvalSettings('task:'+work.id).mode:null)??this.approvalSettings('bot:'+botId).mode??this.approvalSettings('instance').mode;
    return mode==='ask-for-risky-actions' && !!this.#approvalGrants.matchingId(boundary,botId,work.kind==='task'?work.id:null);
  }
  claimGrantedAction(input:{work:WorkRef;callId:string;hop:number;boundary:GrantBoundary;journal:ActionJournal;permit:StartPermit;controller:AbortController}):string {
    if(this.db.isTransaction !== false)throw new BotConflict('Instance connection is busy');
    if(input.controller.signal.aborted)throw new BotConflict('Action cancelled');
    this.db.exec('BEGIN IMMEDIATE');
    let registered:string|null=null,committed=false;
    try {
      const {work,boundary}=input;this.validateGrantBoundary(boundary);if(work.kind==='task' && this.scheduleOrigin(work.id))throw new BotConflict('Schedule grants are unsupported');const botId=this.webWorkBotId(work);
      if(!botId)throw new BotConflict('Work no longer exists');
      const mode=(work.kind==='task'?this.approvalSettings('task:'+work.id).mode:null)??this.approvalSettings('bot:'+botId).mode??this.approvalSettings('instance').mode;
      if(mode!=='ask-for-risky-actions')throw new BotConflict('Approval mode requires a fresh decision');
      let identity:{id:string;fingerprint:string};
      if(boundary.kind==='web') {
        if(!this.webAllowed(work))throw new BotConflict('Web access revoked');
        identity=this.webIdentity(work,input.callId,input.hop,boundary.url);
      } else if(boundary.kind==='search') {
        if(boundary.results!==10 || boundary.timeoutMs!==10000 || !this.searchAllowed(work,boundary.origin,boundary.revision))throw new BotConflict('Search scope changed');
        identity=this.searchIdentity(work,input.callId,boundary.origin,boundary.revision,boundary.query);
      } else {
        const config=this.shellConfig();
        if(boundary.sizeBytes!==scratchLimits.sizeBytes || boundary.maxInodes!==scratchLimits.maxInodes || boundary.timeoutMs!==scratchLimits.timeoutMs || boundary.maxOutputBytes!==scratchLimits.maxOutputBytes || config.dockerBinary!==boundary.dockerBinary || config.dockerSocket!==boundary.dockerSocket || config.imageId!==boundary.imageId || !this.shellAllowed(work,boundary.revision))throw new BotConflict('Shell scope changed');
        identity=this.shellIdentity(work,input.callId,{revision:boundary.revision,dockerBinary:boundary.dockerBinary,dockerSocket:boundary.dockerSocket,imageId:boundary.imageId},boundary.command);
      }
      const grantId=this.#approvalGrants.matchingId(boundary,botId,work.kind==='task'?work.id:null);
      const prepared=input.journal.get(identity.id);
      if(!grantId || !prepared || prepared.fingerprint!==identity.fingerprint || prepared.work.kind!==work.kind || prepared.work.id!==work.id)throw new BotConflict('Grant or action changed');
      if(boundary.kind==='shell')this.recordShellDecision(identity.id,identity.fingerprint,{dockerBinary:boundary.dockerBinary,dockerSocket:boundary.dockerSocket,imageId:boundary.imageId},'approve');
      input.journal.startInInstanceTransaction(input.permit,this.db,{...identity,work});
      const controllers=this.grantControllers.get(grantId)??new Set<AbortController>();controllers.add(input.controller);this.grantControllers.set(grantId,controllers);registered=grantId;
      this.db.exec('COMMIT');committed=true;
      input.journal.finalizeInstanceStart(input.permit);
      return grantId;
    } catch(error) {if(!committed && this.db.isTransaction)this.db.exec('ROLLBACK');if(!committed && registered)this.releaseGrantController(registered,input.controller);throw error;}
  }
  releaseGrantController(grantId:string,controller:AbortController) {const controllers=this.grantControllers.get(grantId);controllers?.delete(controller);if(!controllers?.size)this.grantControllers.delete(grantId);}
  editApprovalGrant(id:string,revision:number,scope:{kind:'bot';botId:string}|{kind:'all-bots'},lifetime:{kind:'task';taskId:string}|{kind:'remembered'}) {
    if(scope.kind==='bot' && !this.botIdentity(scope.botId))throw new BotConflict('Agent not found');
    if(lifetime.kind==='task') {const attempt=this.taskAttempt(lifetime.taskId);if(!attempt || (scope.kind==='bot' && attempt.botId!==scope.botId))throw new BotConflict('Task does not match grant scope');}
    this.#approvalGrants.edit(id,revision,scope,lifetime);for(const controller of this.grantControllers.get(id)??[])controller.abort();
  }
  revokeApprovalGrant(id:string,revision:number) {this.#approvalGrants.revoke(id,revision);for(const controller of this.grantControllers.get(id)??[])controller.abort();}
  webJournal() {return new ActionJournal(this.db);}
  recordWebDecision(actionId:string,fingerprint:string,decision:'approve'|'deny') {this.db.prepare('INSERT INTO web_action_decisions VALUES (?,?,?)').run(actionId,fingerprint,decision);}
  webActions(work:WorkRef) {return this.db.prepare(`SELECT id,state,summary,result FROM action_journal WHERE ${work.kind==='task' ? 'task_attempt_id' : 'command_id'}=? AND summary='Read public web page' ORDER BY rowid`).all(work.id);}
  providerDefaults() { return new ProviderDefaultsStore(dirname(dirname(this.configs.location('placeholder')))); }
  selectBotProvider(id:string,revision:string,provider:string,model?:string|null,reasoning?:string|null) {
    const current=this.bot(id);if(!current)throw Error('Agent not found');
    const pair=current.providerChoices?.[provider]??this.providerDefaults().read().providers[provider]??{model:null,reasoning:null};
    return this.editBot(id,{...current,revision,provider,model:model===undefined?pair.model:model,reasoning:reasoning===undefined?pair.reasoning:reasoning});
  }
  creationDefaults() {const row=this.db.prepare('SELECT revision,provider,model,reasoning,tool_mode FROM creation_defaults WHERE id=1').get();if(!row || typeof row.revision !== 'number' || typeof row.provider !== 'string' || !(row.model === null || typeof row.model === 'string') || !(row.reasoning === null || typeof row.reasoning === 'string'))throw Error('Invalid creation defaults');return {revision:row.revision,provider:row.provider,model:row.model,reasoning:row.reasoning,toolMode:parseToolMode(row.tool_mode)};}
  setCreationDefaults(input:{revision:number;provider:string;model:string|null;reasoning:string|null;toolMode?:ToolMode}) {
    if(!Number.isSafeInteger(input.revision) || input.revision<1 || !['demo','codex','openrouter','lmstudio','live'].includes(input.provider) || !(input.model === null || typeof input.model === 'string' && input.model.length <= 200) || !(input.reasoning === null || typeof input.reasoning === 'string' && input.reasoning.length <= 100))throw Error('Invalid creation defaults');
    const toolMode=input.toolMode===undefined?this.creationDefaults().toolMode:parseToolMode(input.toolMode);
    const result=this.db.prepare('UPDATE creation_defaults SET revision=revision+1,provider=?,model=?,reasoning=?,tool_mode=? WHERE id=1 AND revision=?').run(input.provider,input.model,input.reasoning,toolMode,input.revision);
    if(!result.changes)throw new BotConflict('Creation defaults changed. Refresh before editing.');return this.creationDefaults();
  }
  private imageAssets() {return this.images??=new AgentImageAssets(join(dirname(dirname(this.configs.location('placeholder'))),'.images'));}
  agentImage(assetId:string) {return this.imageAssets().read(assetId);}
  private requireStoredImage(image:AgentImage,previous?:AgentImage) {
    if(image.kind==='upload' && !(previous?.kind==='upload' && previous.assetId===image.assetId) && !this.imageAssets().read(image.assetId)) throw Error('The selected image is unavailable. Upload it again or choose another image.');
  }
  createBot(input: {name: string; instructions: string; provider?: string; model?: string; reasoning?: string; operationId?: string;toolMode?:ToolMode;image?:AgentImageInput}, advertisedModel?:string) {
    if (!input.name.trim() || (input.provider !== undefined && !input.provider.trim())) throw new Error('Name and provider are required');
    if(input.toolMode!==undefined)parseToolMode(input.toolMode);
    const id = randomUUID(), chatId = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const image:AgentImage=input.image?.kind==='upload-data'?this.imageAssets().accept(input.image):input.image??{kind:'initials'};
      const savedImage=imageSetting(image);
      const digest=input.operationId ? createHmac('sha256',this.fingerprintKey).update(JSON.stringify([input.name,input.instructions,input.provider ?? null,input.model ?? null,input.reasoning ?? null,...(savedImage===null?[]:[savedImage]),...(input.toolMode===undefined?[]:['toolMode',input.toolMode])])).digest('hex') : null;
      if(input.operationId) { const existing=this.db.prepare('SELECT digest,bot_id FROM bot_creation_operations WHERE id=?').get(input.operationId); if(existing) { if(existing.digest!==digest || typeof existing.bot_id!=='string') throw new BotConflict('Creation operation ID conflict'); const bot=this.bot(existing.bot_id); this.db.exec('COMMIT'); return bot; } }
      this.requireStoredImage(image);
      const defaults=this.creationDefaults();const provider=input.provider ?? defaults.provider;
      const first=this.providerDefaults().read().providers[provider];
      const chosenModel=input.model ?? (input.provider===undefined?defaults.model:first?.model??advertisedModel??null);
      const chosenReasoning=input.reasoning ?? (input.provider===undefined?defaults.reasoning:first?.reasoning??null);
      this.configs.publish(id,{name:input.name,description:'',provider,model:chosenModel,reasoning:chosenReasoning,toolMode:input.toolMode??defaults.toolMode,instructions:input.instructions,providerChoices:{[provider]:{model:chosenModel,reasoning:chosenReasoning}},image},false);
      this.db.prepare('INSERT INTO bots VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, chatId, '', '', 'demo', null, null);
      this.db.prepare('INSERT INTO bot_profiles (bot_id,revision,soul,archived) VALUES (?, 1, ?, 0)').run(id, '');
      if(input.operationId && digest) this.db.prepare('INSERT INTO bot_creation_operations VALUES (?,?,?)').run(input.operationId,digest,id);
      this.db.exec('COMMIT');
      return this.bot(id);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  creationOperation(id:string) { const row=this.db.prepare('SELECT bot_id FROM bot_creation_operations WHERE id=?').get(id); return typeof row?.bot_id==='string' ? this.bot(row.bot_id) : undefined; }
  private botIdentity(id:string) {
    const row=this.db.prepare('SELECT b.id,b.chat_id AS chatId,p.archived FROM bots b JOIN bot_profiles p ON p.bot_id=b.id WHERE b.id=?').get(id);
    return row && typeof row.id==='string' && typeof row.chatId==='string' ? {id:row.id,chatId:row.chatId,archived:row.archived===1} : undefined;
  }
  bots() {
    return this.db.prepare('SELECT id FROM bots ORDER BY rowid').all().map(row=>{
      const id=String(row.id),identity=this.botIdentity(id);
      if(!identity)throw Error('Invalid agent identity');
      try { return {...identity,...this.configs.read(id,identity.archived)}; }
      catch(error) { return {...identity,name:'Invalid configuration',description:'',provider:'demo',model:null,reasoning:null,instructions:'',revision:'',configDir:this.configs.location(id),configError:error instanceof Error?error.message:'Invalid configuration'}; }
    });
  }
  bot(id: string) { const identity=this.botIdentity(id);return identity ? {...identity,...this.configs.read(id,identity.archived)} : undefined; }
  discoverBots(requesterId:string, query:string) {
    if (!this.botIdentity(requesterId) || this.botIdentity(requesterId)?.archived) throw new Error('Requesting agent not found');
    const entries=this.bots().filter(bot=>!('configError' in bot)).map(bot=>({id:String(bot.id),name:String(bot.name),description:String(bot.description),availability:bot.archived ? 'archived' as const : this.db.prepare("SELECT 1 FROM task_attempts WHERE bot_id=? AND state IN ('queued','running','stopping','waiting') UNION ALL SELECT 1 FROM commands WHERE bot_id=? AND state='pending' LIMIT 1").get(String(bot.id),String(bot.id)) ? 'busy' as const : 'active' as const}));
    return discoverBots({requesterId,query,entries});
  }
  editBot(id: string, edit: BotEdit) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.bot(id);
      if (!current) throw new Error('Agent not found');
      if (current.revision !== edit.revision) throw new BotConflict('Profile changed. Refresh before editing.');
      const providerChoices={...current.providerChoices,[current.provider]:{model:current.model,reasoning:current.reasoning},[edit.provider]:{model:edit.model,reasoning:edit.reasoning}};
      const image=edit.image?.kind==='upload-data'?this.imageAssets().accept(edit.image):edit.image??current.image;
      this.requireStoredImage(image,current.image);
      const config=this.configs.publish(id,{name:edit.name,description:edit.description ?? current.description,instructions:edit.instructions,provider:edit.provider,model:edit.model,reasoning:edit.reasoning,toolMode:edit.toolMode===undefined?current.toolMode:parseToolMode(edit.toolMode),providerChoices,image},current.archived,edit.revision);
      try { this.db.exec('COMMIT'); } catch { throw new AgentConfigUncertain('Configuration save may have taken effect. Inspect the current configuration before retrying.'); }
      return {...current,...config};
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
  }
  setArchived(id: string, revision: string, archived: boolean) {
    this.db.exec('BEGIN IMMEDIATE');
    let published=false;
    try {
      const bot = this.bot(id);
      if (!bot) throw new Error('Agent not found');
      if (bot.revision !== revision) throw new BotConflict('Profile changed. Refresh before editing.');
      if (archived && (this.db.prepare("SELECT 1 FROM commands WHERE bot_id=? AND state='pending'").get(id) || this.db.prepare("SELECT 1 FROM task_attempts WHERE bot_id=? AND state IN ('queued','running','stopping','waiting')").get(id))) throw new BotConflict('Agent is busy');
      if (bot.archived !== archived) {
        const files=this.configs.readFiles(id,bot.archived);
        this.configs.publishFiles(id,files.settings,files.instructions,bot.archived,revision);
        published=true;
        this.db.prepare('UPDATE bot_profiles SET archived=? WHERE bot_id=?').run(archived ? 1 : 0, id);
      }
      const result = this.bot(id);
      try { this.db.exec('COMMIT'); } catch { throw new AgentConfigUncertain('Archive state may have changed. Inspect the agent before retrying.'); }
      return result;
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} if(published && !(error instanceof AgentConfigUncertain))throw new AgentConfigUncertain('Archive state may have changed. Inspect the agent before retrying.');throw error; }
  }
  taskAttempts(botId: string) {
    return this.db.prepare(`SELECT a.id, a.task_id AS taskId, a.bot_id AS botId, t.objective, a.predecessor,
      a.state, a.outcome, a.limit_ms AS limitMs, a.delegation_clock AS delegationClock, json_extract(a.profile,'$.revision') AS profileRevision, a.profile AS capturedProfile
      FROM task_attempts a JOIN tasks t ON t.id=a.task_id WHERE a.bot_id=? ORDER BY a.rowid DESC`).all(botId).map(({capturedProfile,...row})=>({...row,state:row.state,toolMode:parseToolModeFromProfile(capturedProfile)}));
  }
  taskAttempt(id: string) {
    const row = this.db.prepare(`SELECT a.id, a.task_id AS taskId, a.bot_id AS botId, t.objective, a.predecessor,
      a.state, a.outcome, a.limit_ms AS limitMs, a.delegation_clock AS delegationClock, json_extract(a.profile,'$.revision') AS profileRevision, a.profile AS capturedProfile
      FROM task_attempts a JOIN tasks t ON t.id=a.task_id WHERE a.id=?`).get(id);
    if (!row) return undefined;
    const attempt = row as {id:string; taskId:string; botId:string; objective:string; predecessor:string | null; state:string; outcome:string | null; limitMs:number; profileRevision:string};
    const saved=this.db.prepare('SELECT session FROM task_attempts WHERE id=?').get(id);
    const session: Session | undefined=typeof saved?.session === 'string' ? JSON.parse(saved.session) : undefined;
    const inbox = new TaskInbox(this.db).inspect({botId:attempt.botId,attemptId:id});
    const waitReason=attempt.state === 'waiting' ? 'replacement' : inbox.questions.some(question=>question.state === 'open') ? 'owner-input' : this.db.prepare("SELECT 1 FROM approval_requests WHERE work_kind='task' AND work_id=? AND state='pending'").get(id) ? 'approval' : null;
    const {capturedProfile,...visible}=row as typeof attempt & {capturedProfile:unknown};
    return {...visible,toolMode:parseToolModeFromProfile(capturedProfile), waitReason, inbox, usage:session?.usage ?? [], activity: this.db.prepare('SELECT seq,event FROM task_activity WHERE attempt_id=? ORDER BY seq').all(id).map(event => { const value = JSON.parse(String(event.event)); if (value.type === 'tool_result' && value.name === 'select_skill' && typeof value.content === 'string') { value.content = this.redactSkill(value.content); if (value.success) { try { const detail=JSON.parse(value.content); if (typeof detail.digest === 'string' && detail.sourceDigest === undefined) { detail.sourceDigest=detail.digest; delete detail.digest; value.content=JSON.stringify(detail); } } catch { /* Historical error text is not structured selection evidence. */ } } } return {seq:event.seq, ...value}; })};
  }
  acceptTask(input: {id:string; botId:string; objective:string; limitMs:number; predecessor?:string; delegateClock?:boolean}, visibleObjective=input.objective) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result=this.acceptTaskInTransaction(input,visibleObjective);
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private acceptTaskInTransaction(input: {id:string; botId:string; objective:string; limitMs:number; predecessor?:string; delegateClock?:boolean}, visibleObjective=input.objective, isolated=false) {
    const digest=createHmac('sha256',this.fingerprintKey).update(JSON.stringify([input.id,input.botId,input.objective,input.limitMs,input.predecessor ?? null,...(input.delegateClock ? ['delegate-clock'] : [])])).digest('hex');
      const existing = this.taskAttempt(input.id);
      if (existing) {
        if (this.db.prepare('SELECT digest FROM task_fingerprints WHERE attempt_id=?').get(input.id)?.digest !== digest) throw new BotConflict('Task command ID conflict');
        return {kind:'existing' as const, attempt:existing};
      }
      const bot = this.bot(input.botId);
      if (!bot) throw Error('Agent not found');
      if (bot.archived) throw new BotConflict('Agent is archived');
      const active = this.taskAttempts(input.botId).find(a => ['queued','running','stopping','waiting'].includes(String(a.state)));
      if (active) return {kind:'busy' as const, attempt:active};
      let taskId: string = randomUUID();
      let origin: ReturnType<Instance['scheduleOrigin']>;
      if (input.predecessor) {
        const previous = this.taskAttempt(input.predecessor);
        if (!previous || previous.botId !== input.botId || !['failed','stopped','interrupted'].includes(String(previous.state))) throw new BotConflict('Only failed, stopped or interrupted attempts can be retried');
        origin=this.scheduleOrigin(input.predecessor);
        if (origin && (origin.revoked !== 0 || !['reviewed','completed'].includes(String(origin.status)))) throw new BotConflict('Review the scheduled occurrence and ensure its authorization is not revoked before retrying');
        if (origin && previous.objective !== visibleObjective) throw new BotConflict('Scheduled retries must retain their original objective');
        if (previous.objective === visibleObjective) taskId = String(previous.taskId);
      }
      if (input.predecessor) {
        const prior=this.db.prepare('SELECT delegation_clock FROM task_attempts WHERE id=?').get(input.predecessor);
        if ((prior?.delegation_clock === 1) !== (input.delegateClock === true)) throw new BotConflict('Retry must retain its delegation scope');
      }
      if (!this.db.prepare('SELECT 1 FROM tasks WHERE id=?').get(taskId)) this.db.prepare('INSERT INTO tasks VALUES (?,?,?)').run(taskId,input.botId,visibleObjective);
      const context = isolated ? [] : this.taskContext(input.botId);
      this.db.prepare("INSERT INTO task_attempts (id,task_id,bot_id,predecessor,profile,context,state,limit_ms) VALUES (?,?,?,?,?,?,'queued',?)").run(input.id,taskId,input.botId,input.predecessor ?? null,JSON.stringify(bot),JSON.stringify(context),input.limitMs);
      if (input.delegateClock) this.db.prepare('UPDATE task_attempts SET delegation_clock=1 WHERE id=?').run(input.id);
      if (origin) { if (typeof origin.schedule_id !== 'string' || typeof origin.due_at !== 'number') throw Error('Invalid schedule origin'); this.db.prepare('INSERT INTO schedule_task_retries VALUES (?,?,?)').run(input.id,origin.schedule_id,origin.due_at); const scope=this.db.prepare('SELECT url FROM schedule_web_scopes WHERE attempt_id=?').get(input.predecessor ?? '');if(typeof scope?.url==='string'){this.db.prepare('INSERT INTO schedule_web_scopes VALUES (?,?)').run(input.id,scope.url);const priorPermission=this.db.prepare('SELECT enabled FROM web_permissions WHERE scope=?').get('task:'+(input.predecessor ?? ''));if(priorPermission?.enabled===0)this.db.prepare('INSERT INTO web_permissions VALUES (?,0)').run('task:'+input.id);}const search=this.db.prepare('SELECT query,origin,revision FROM schedule_search_scopes WHERE attempt_id=?').get(input.predecessor ?? '');if(typeof search?.query==='string' && typeof search.origin==='string' && typeof search.revision==='number'){this.db.prepare('INSERT INTO schedule_search_scopes VALUES (?,?,?,?)').run(input.id,search.query,search.origin,search.revision);const prior=this.db.prepare('SELECT enabled FROM search_permissions WHERE scope=?').get('task:'+(input.predecessor ?? ''));if(prior?.enabled===0)this.db.prepare('INSERT INTO search_permissions VALUES (?,0)').run('task:'+input.id);}const shell=this.db.prepare('SELECT command,docker_binary,docker_socket,image_id,revision FROM schedule_shell_scopes WHERE attempt_id=?').get(input.predecessor ?? '');if(typeof shell?.command==='string' && typeof shell.docker_binary==='string' && typeof shell.docker_socket==='string' && typeof shell.image_id==='string' && typeof shell.revision==='number'){this.db.prepare('INSERT INTO schedule_shell_scopes VALUES (?,?,?,?,?,?)').run(input.id,shell.command,shell.docker_binary,shell.docker_socket,shell.image_id,shell.revision);const prior=this.db.prepare('SELECT enabled FROM shell_permissions WHERE scope=?').get('task:'+(input.predecessor ?? ''));if(prior?.enabled===0)this.db.prepare('INSERT INTO shell_permissions VALUES (?,0)').run('task:'+input.id);} }
      this.bindWork({kind:'task',id:input.id},input.botId);
      this.captureTaskSkills(input.id,input.botId);
      this.db.prepare('INSERT INTO task_fingerprints VALUES (?,?)').run(input.id,digest);
      this.taskEvent(input.id,{type:'queued',message:'Task accepted'});
      this.taskAnnouncement(input.botId,`Task ${input.id} accepted: ${visibleObjective}`);
      const attempt=this.taskAttempt(input.id); return {kind:'accepted' as const,attempt};
  }
  helperAssignment(attemptId:string) { return this.db.prepare('SELECT * FROM collaboration_assignments WHERE helper_attempt_id=?').get(attemptId); }
  isHelperAttempt(attemptId:string) { return !!this.db.prepare('SELECT 1 FROM collaboration_assignments WHERE helper_attempt_id=?').get(attemptId); }
  private assertNoPendingParentInput(parentId:string,botId:string) {if(new TaskInbox(this.db).hasPending({botId,attemptId:parentId})) throw new BotConflict('Parent task has pending input; process it before sending');}
  disclosureRequests() { return this.db.prepare('SELECT id,parent_attempt_id AS parentAttemptId,sender_bot_id AS senderBotId,recipient_bot_id AS recipientBotId,kind,content,state FROM disclosure_requests ORDER BY rowid DESC').all(); }
  proposeDisclosure(input:{parentAttemptId:string;senderBotId:string;recipientBotId:string;kind:'request'|'question'|'answer'|'result'|'failure';content:string}) {
    if (!['request','question','answer','result','failure'].includes(input.kind) || !input.content.trim() || Buffer.byteLength(input.content,'utf8') > 16384 || input.senderBotId === input.recipientBotId) throw Error('Invalid disclosure');
    const parent=this.taskAttempt(input.parentAttemptId);
    if (!parent || parent.state !== 'running' || !this.botIdentity(input.senderBotId) || !this.botIdentity(input.recipientBotId)) throw new BotConflict('Disclosure participants unavailable');
    const id=randomUUID();this.db.prepare("INSERT INTO disclosure_requests VALUES (?,?,?,?,?,?,'pending')").run(id,input.parentAttemptId,input.senderBotId,input.recipientBotId,input.kind,input.content);return id;
  }
  decideDisclosure(id:string,approved:boolean) {
    const result=this.db.prepare("UPDATE disclosure_requests SET state=? WHERE id=? AND state='pending'").run(approved ? 'approved' : 'denied',id);
    if (!result.changes) throw new BotConflict('Disclosure decision is no longer pending');
    return approved ? 'approved' : 'denied';
  }
  interruptDisclosure(id:string) {this.db.prepare("UPDATE disclosure_requests SET state='interrupted' WHERE id=? AND state IN ('pending','approved')").run(id);}
  consumeDisclosure(id:string,input:{parentAttemptId:string;senderBotId:string;recipientBotId:string;kind:string;content:string}) {
    const result=this.db.prepare("UPDATE disclosure_requests SET state='consumed' WHERE id=? AND parent_attempt_id=? AND sender_bot_id=? AND recipient_bot_id=? AND kind=? AND content=? AND state='approved'").run(id,input.parentAttemptId,input.senderBotId,input.recipientBotId,input.kind,input.content);
    if (!result.changes) throw new BotConflict('Disclosure approval does not match');
  }
  helperQuestion(helperAttemptId:string,question:string,disclosureId:string) {
    const assignment=this.helperAssignment(helperAttemptId);if (!assignment) throw Error('Helper assignment not found');
    const assignmentId=String(assignment.id),parentId=String(assignment.parent_attempt_id),helper=String(assignment.helper_bot_id),requester=String(assignment.requester_bot_id),id=randomUUID();
    this.db.exec('BEGIN IMMEDIATE');try {
      this.assertNoPendingParentInput(parentId,requester);
      this.consumeDisclosure(disclosureId,{parentAttemptId:parentId,senderBotId:helper,recipientBotId:requester,kind:'question',content:question});
      const request=this.db.prepare("SELECT id FROM collaboration_messages WHERE assignment_id=? AND kind='request'").get(assignmentId);if(typeof request?.id !== 'string')throw Error('Request not found');
      const digest=createHmac('sha256',this.fingerprintKey).update(JSON.stringify([id,question])).digest('hex');
      new CollaborationStore(this.db).append({assignmentId,botId:helper,toBotId:requester,id,commandId:id,fingerprint:digest,kind:'question',inReplyTo:request.id,body:question});
      const text=`Helper question. Assignment ID: ${assignmentId}. Question ID: ${id}. ${question}`;
      new TaskInbox(this.db).enqueue({botId:requester,attemptId:parentId,commandId:randomUUID(),kind:'direction',text,digest});
      this.taskEvent(parentId,{type:'collaboration_question',assignmentId,messageId:id,helperAttemptId});this.taskEvent(helperAttemptId,{type:'collaboration_question',assignmentId,messageId:id,parentAttemptId:parentId});
      this.db.exec('COMMIT');return {assignmentId,questionId:id};
    }catch(error){this.db.exec('ROLLBACK');this.interruptDisclosure(disclosureId);throw error;}
  }
  answerHelper(parentId:string,assignmentId:string,questionId:string,answer:string,disclosureId:string,commandId:string) {
    const parent=this.taskAttempt(parentId);if(!parent)throw Error('Parent task not found');
    const assignment=this.db.prepare('SELECT * FROM collaboration_assignments WHERE id=? AND parent_attempt_id=?').get(assignmentId,parentId);if(!assignment)throw Error('Assignment not found');
    const helper=String(assignment.helper_bot_id),helperAttemptId=String(assignment.helper_attempt_id);
    const id=createHmac('sha256',this.fingerprintKey).update(JSON.stringify(['answer',parentId,commandId])).digest('hex');
    const digest=createHmac('sha256',this.fingerprintKey).update(JSON.stringify([assignmentId,questionId,answer])).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');try {
      this.assertNoPendingParentInput(parentId,parent.botId);
      const existing=!!this.db.prepare('SELECT 1 FROM collaboration_messages WHERE id=?').get(id);
      if(!existing)this.consumeDisclosure(disclosureId,{parentAttemptId:parentId,senderBotId:parent.botId,recipientBotId:helper,kind:'answer',content:answer});
      else this.interruptDisclosure(disclosureId);
      const message=new CollaborationStore(this.db).append({assignmentId,botId:parent.botId,toBotId:helper,id,commandId:id,fingerprint:digest,kind:'answer',inReplyTo:questionId,body:answer});
      if(!existing){this.taskEvent(parentId,{type:'collaboration_answer',assignmentId,messageId:id,helperAttemptId});this.taskEvent(helperAttemptId,{type:'collaboration_answer',assignmentId,messageId:id,parentAttemptId:parentId});}
      this.db.exec('COMMIT');return message;
    }catch(error){this.db.exec('ROLLBACK');this.interruptDisclosure(disclosureId);throw error;}
  }
  taskCollaborations(attemptId:string) {
    const attempt=this.taskAttempt(attemptId); if (!attempt) throw Error('Task not found');
    const store=new CollaborationStore(this.db);
    return this.db.prepare('SELECT id FROM collaboration_assignments WHERE parent_attempt_id=? OR helper_attempt_id=? ORDER BY rowid').all(attemptId,attemptId).map(row=>store.inspect({assignmentId:String(row.id),botId:attempt.botId}));
  }
  // Called only from a trusted task executor. No service endpoint exposes this operation yet.
  beginDelegation(input:{parentAttemptId:string; commandId:string; helperBotId:string; objective:string; context:string; disclosureId:string}) {
    for (const [key,value] of Object.entries(input)) if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value,'utf8') > (key === 'objective' || key === 'context' ? 8000 : 200)) throw Error('Invalid delegation input');
    const id=(part:string)=>createHmac('sha256',this.fingerprintKey).update(JSON.stringify(['delegation',input.parentAttemptId,input.commandId,part])).digest('hex');
    const assignmentId=id('assignment'), helperAttemptId=id('attempt'), requestId=id('request');
    const fingerprint=createHmac('sha256',this.fingerprintKey).update(JSON.stringify([input.parentAttemptId,input.commandId,input.helperBotId,input.objective,input.context])).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const parent=this.taskAttempt(input.parentAttemptId);
      if (!parent || parent.state !== 'running') throw new BotConflict('Parent task is not running');
      const helper=this.bot(input.helperBotId);
      if (!helper || helper.archived || helper.id === parent.botId) throw new BotConflict('Helper is unavailable');
      if (this.db.prepare("SELECT 1 FROM commands WHERE bot_id=? AND state='pending'").get(input.helperBotId)) throw new BotConflict('Helper is busy');
      const objective=`${input.objective}\n\nAssignment context:\n${input.context}`;
      this.assertNoPendingParentInput(input.parentAttemptId,parent.botId);
      if (!this.db.prepare('SELECT 1 FROM task_attempts WHERE id=?').get(helperAttemptId)) this.consumeDisclosure(input.disclosureId,{parentAttemptId:input.parentAttemptId,senderBotId:parent.botId,recipientBotId:input.helperBotId,kind:'request',content:objective});
      const claim=this.acceptTaskInTransaction({id:helperAttemptId,botId:input.helperBotId,objective,limitMs:parent.limitMs},objective,true);
      if (claim.kind === 'busy') throw new BotConflict('Helper is busy');
      if (claim.kind === 'existing') this.interruptDisclosure(input.disclosureId);
      const store=new CollaborationStore(this.db);
      const assignment=store.create({id:assignmentId,commandId:id('assignment-command'),fingerprint,parentAttemptId:input.parentAttemptId,helperAttemptId,requesterBotId:parent.botId,helperBotId:input.helperBotId,objective:input.objective,context:input.context});
      const message=store.append({assignmentId,botId:parent.botId,id:requestId,commandId:id('request-command'),fingerprint,kind:'request',toBotId:input.helperBotId,body:objective});
      if (claim.kind === 'accepted') {this.taskEvent(input.parentAttemptId,{type:'collaboration_request',assignmentId,messageId:requestId,helperAttemptId});this.taskEvent(helperAttemptId,{type:'collaboration_request',assignmentId,messageId:requestId,parentAttemptId:input.parentAttemptId});}
      this.db.exec('COMMIT'); return {kind:claim.kind,assignment,message,helperAttemptId};
    } catch (error) {this.db.exec('ROLLBACK');this.interruptDisclosure(input.disclosureId);throw error;}
  }
  startChatTask(commandId:string,callId:string,objective:string) {
    if (!callId.trim() || Buffer.byteLength(callId,'utf8')>200 || !objective.trim() || Buffer.byteLength(objective,'utf8')>16000) throw Error('Invalid task request');
    const digest=createHmac('sha256',this.fingerprintKey).update(JSON.stringify([callId,objective])).digest('hex');
    const attemptId=createHmac('sha256',this.fingerprintKey).update(JSON.stringify(['chat-task',commandId,callId])).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');try {
      const command=this.command(commandId);if(!command || command.state!=='pending' || typeof command.botId!=='string')throw new BotConflict('Chat command is no longer active');
      const previous=this.db.prepare('SELECT * FROM command_task_starts WHERE command_id=?').get(commandId);
      if(previous){if(previous.call_id!==callId || previous.digest!==digest)throw new BotConflict('A task was already requested for this chat message');this.db.exec('COMMIT');return {kind:'existing' as const,outcome:String(previous.outcome),attemptId:typeof previous.attempt_id==='string'?previous.attempt_id:null};}
      const result=this.acceptTaskInTransaction({id:attemptId,botId:command.botId,objective,limitMs:300000},objective);
      if(result.kind === 'existing')throw new BotConflict('Task identity conflict');
      this.db.prepare('INSERT INTO command_task_starts VALUES (?,?,?,?,?)').run(commandId,callId,digest,result.kind === 'accepted'?attemptId:null,result.kind);
      this.db.exec('COMMIT');return {kind:result.kind,outcome:result.kind,attemptId:result.kind === 'accepted'?attemptId:null};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  replaceTask(input:{id:string; predecessor:string; objective:string; limitMs:number; delegateClock?:boolean}, visibleObjective=input.objective) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous=this.taskAttempt(input.predecessor);
      if (!previous) throw Error('Task not found');
      if (this.scheduleOrigin(input.predecessor)) throw new BotConflict('Scheduled tasks cannot be replaced. Stop this task and explicitly start a new task.');
      const digest=createHmac('sha256',this.fingerprintKey).update(JSON.stringify([input.id,previous.botId,input.objective,input.limitMs,input.predecessor,...(input.delegateClock ? ['delegate-clock'] : [])])).digest('hex');
      const existing=this.taskAttempt(input.id);
      if(existing) {
        if(this.db.prepare('SELECT digest FROM task_fingerprints WHERE attempt_id=?').get(input.id)?.digest !== digest) throw new BotConflict('Task command ID conflict');
        this.db.exec('COMMIT');return {kind:'existing' as const,attempt:existing};
      }
      if(!['queued','running','stopping'].includes(previous.state)) throw new BotConflict('Task is no longer active');
      if(this.db.prepare("SELECT 1 FROM task_attempts WHERE bot_id=? AND state='waiting'").get(previous.botId)) throw new BotConflict('A replacement is already waiting');
      const bot=this.bot(previous.botId);if(!bot || bot.archived) throw new BotConflict('Agent unavailable');
      const taskId=randomUUID();this.db.prepare('INSERT INTO tasks VALUES (?,?,?)').run(taskId,previous.botId,visibleObjective);
      this.db.prepare("INSERT INTO task_attempts (id,task_id,bot_id,predecessor,profile,context,state,limit_ms) VALUES (?,?,?,?,?,?,'waiting',?)").run(input.id,taskId,previous.botId,input.predecessor,JSON.stringify(bot),JSON.stringify(this.taskContext(previous.botId)),input.limitMs);
      if (input.delegateClock) this.db.prepare('UPDATE task_attempts SET delegation_clock=1 WHERE id=?').run(input.id);
      this.bindWork({kind:'task',id:input.id},previous.botId);
      this.captureTaskSkills(input.id,previous.botId);
      this.db.prepare('INSERT INTO task_fingerprints VALUES (?,?)').run(input.id,digest);
      this.taskEvent(input.id,{type:'waiting',message:'Waiting for previous attempt to settle'});
      if(previous.state !== 'stopping') {this.db.prepare("UPDATE task_attempts SET state='stopping' WHERE id=?").run(input.predecessor);this.taskEvent(input.predecessor,{type:'stopping',message:'Replacement requested'});this.cancelDelegations(input.predecessor);}
      this.taskAnnouncement(previous.botId,`Replacement task ${input.id} accepted: ${visibleObjective}`);
      const attempt=this.taskAttempt(input.id);this.db.exec('COMMIT');return {kind:'accepted' as const,attempt};
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  taskInput(input: {attemptId:string; commandId:string; text:string} & ({kind:'direction'} | {kind:'answer';questionId:string}), visibleText:string) {
    const attempt=this.taskAttempt(input.attemptId); if(!attempt) throw Error('Task not found');
    const scope={botId:attempt.botId,attemptId:input.attemptId};
    const digest=createHmac('sha256',this.fingerprintKey).update(JSON.stringify(input)).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result=new TaskInbox(this.db).enqueue({...scope,...input,text:visibleText,digest});
      if(result.kind === 'accepted') {
        this.taskEvent(input.attemptId,{type:'input_accepted',commandId:input.commandId,kind:input.kind,text:visibleText});
        this.taskAnnouncement(attempt.botId,`Task ${input.attemptId} ${input.kind} accepted (not yet applied)`);
      }
      this.db.exec('COMMIT');return result;
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  taskDrain(id:string,session:Session) {
    const attempt=this.taskAttempt(id); if(!attempt) throw Error('Task not found');
    const scope={botId:attempt.botId,attemptId:id}; const inbox=new TaskInbox(this.db); const inputs:string[]=[];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (;;) {
        const row=inbox.claimNext(scope); if(!row) break;
        if(typeof row.command_id !== 'string' || typeof row.text !== 'string' || typeof row.kind !== 'string') throw Error('Invalid task input');
        inbox.mark({...scope,commandId:row.command_id,status:'applied'});
        this.taskEvent(id,{type:'input_applied',commandId:row.command_id,kind:row.kind});
        inputs.push(`${row.kind === 'answer' ? 'Owner answer' : 'Owner direction'}: ${row.text}`);
      }
      const messages=appendTaskInputs(session.messages,inputs);
      this.taskSave(id,{...session,messages});
      this.db.exec('COMMIT');return inputs;
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  taskHasPending(id:string) {const attempt=this.taskAttempt(id);if(!attempt) throw Error('Task not found');return new TaskInbox(this.db).hasPending({botId:attempt.botId,attemptId:id});}
  taskQuestion(id:string, question:string) {
    const attempt=this.taskAttempt(id); if(!attempt) throw Error('Task not found'); const questionId=randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {new TaskInbox(this.db).createQuestion({botId:attempt.botId,attemptId:id,questionId,text:question});this.taskEvent(id,{type:'question',questionId,text:question});this.taskAnnouncement(attempt.botId,`Task ${id} needs input (${questionId}): ${question}`);this.db.exec('COMMIT');return questionId;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  taskQuestionAnswered(id:string,questionId:string) {
    const attempt=this.taskAttempt(id); if(!attempt) throw Error('Task not found');
    return new TaskInbox(this.db).inspect({botId:attempt.botId,attemptId:id}).questions.some(q=>q.id===questionId && q.state==='answered');
  }
  private captureTaskSkills(attemptId:string,botId:string) {
    for (const skill of this.skills.availableToBot(botId).slice(0,32)) this.db.prepare('INSERT INTO task_skill_catalog VALUES (?,?,?,?,?,?)').run(attemptId,skill.id,skill.revision,skill.name,skill.description,skill.digest);
  }
  taskSkills(attemptId:string) {
    return this.db.prepare('SELECT skill_id AS id,revision,name,description,digest FROM task_skill_catalog WHERE attempt_id=? ORDER BY name,skill_id').all(attemptId).map(row=>({id:String(row.id),revision:Number(row.revision),name:this.redactSkill(String(row.name)),description:this.redactSkill(String(row.description)),digest:String(row.digest)}));
  }
  taskExecution(id: string) {
    const row=this.db.prepare('SELECT a.profile,a.context,a.state,a.limit_ms AS limitMs,t.objective FROM task_attempts a JOIN tasks t ON t.id=a.task_id WHERE a.id=?').get(id);
    if (!row || row.state !== 'queued' || typeof row.profile !== 'string' || typeof row.context !== 'string') throw Error('Task is not queued');
    const profile=parseCapturedProfile(JSON.parse(row.profile));
    const context=JSON.parse(row.context) as Array<{role:string;content:string;isNotice:number}>;
    return {profile,context,objective:String(row.objective),limitMs:Number(row.limitMs)};
  }
  private taskAnnouncement(botId:string,content:string) { const id=randomUUID();this.db.prepare("INSERT INTO messages VALUES (?, ?, 'assistant', ?, (SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE bot_id=?))").run(id,botId,content,botId);this.db.prepare("INSERT INTO task_notices (message_id,bot_id) VALUES (?,?)").run(id,botId); }
  taskEvent(id:string,event:object) { this.db.prepare('INSERT INTO task_activity (attempt_id,event) VALUES (?,?)').run(id,JSON.stringify(event)); }
  taskStart(id:string) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=this.db.prepare("UPDATE task_attempts SET state='running' WHERE id=? AND state='queued'").run(id); if (!result.changes) throw Error('Task is not queued'); this.taskEvent(id,{type:'running',message:'Task started'}); this.db.prepare("UPDATE schedule_occurrences SET status='started' WHERE task_id=? AND status='claimed'").run(id); this.db.exec('COMMIT'); }
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  delegatedChildren(id:string) {
    return this.db.prepare("SELECT helper_attempt_id AS id FROM collaboration_assignments WHERE parent_attempt_id=?").all(id).map(row=>String(row.id));
  }
  private cancelDelegations(id:string) {
    const children=this.db.prepare("SELECT helper_attempt_id FROM collaboration_assignments WHERE parent_attempt_id=? AND state='active'").all(id);
    this.db.prepare("UPDATE collaboration_assignments SET state='cancelled' WHERE parent_attempt_id=? AND state='active'").run(id);
    for (const child of children) {
      const childId=String(child.helper_attempt_id);
      if (this.db.prepare("UPDATE task_attempts SET state='stopping' WHERE id=? AND state IN ('queued','running')").run(childId).changes) this.taskEvent(childId,{type:'stopping',message:'Parent task ended'});
    }
  }
  taskStop(id:string,reason:string) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const waiting=this.db.prepare("SELECT bot_id FROM task_attempts WHERE id=? AND state='waiting'").get(id); if(typeof waiting?.bot_id === 'string') {this.db.prepare("UPDATE task_attempts SET state='stopped',outcome='Replacement cancelled' WHERE id=?").run(id);this.taskEvent(id,{type:'stopped',message:'Replacement cancelled'});this.taskAnnouncement(waiting.bot_id,`Task ${id} stopped: Replacement cancelled`);} const result=this.db.prepare("UPDATE task_attempts SET state='stopping' WHERE id=? AND state IN ('queued','running')").run(id); if (result.changes) {this.taskEvent(id,{type:'stopping',message:reason});this.cancelDelegations(id);} const attempt=this.taskAttempt(id); if(!attempt) throw Error('Task not found'); this.db.exec('COMMIT'); return attempt; }
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  taskSave(id:string,session:Session) { this.db.prepare('UPDATE task_attempts SET session=? WHERE id=?').run(JSON.stringify(session),id); }
  private cancelTaskInputs(id:string) {
    const pending=this.db.prepare("SELECT command_id FROM task_inbox WHERE attempt_id=? AND status IN ('accepted','claimed') ORDER BY seq").all(id);
    this.db.prepare("UPDATE task_inbox SET status='cancelled' WHERE attempt_id=? AND status IN ('accepted','claimed')").run(id);
    for (const row of pending) this.taskEvent(id,{type:'input_cancelled',commandId:row.command_id,message:'Task ended before input was applied'});
  }
  private deliverHelperOutcome(helperAttemptId:string, state:'completed'|'failed'|'stopped', outcome:string, disclosureId?:string) {
    const assignment=this.db.prepare('SELECT * FROM collaboration_assignments WHERE helper_attempt_id=?').get(helperAttemptId);
    if (!assignment) return;
    const assignmentId=String(assignment.id), requester=String(assignment.requester_bot_id), helper=String(assignment.helper_bot_id), parentId=String(assignment.parent_attempt_id);
    const request=this.db.prepare("SELECT id FROM collaboration_messages WHERE assignment_id=? AND kind='request'").get(assignmentId);
    if (typeof request?.id !== 'string') throw Error('Helper assignment has no request');
    const parent=this.taskAttempt(parentId), helperAttempt=this.taskAttempt(helperAttemptId), active=assignment.state === 'active' && parent?.state === 'running' && (helperAttempt?.state === 'running' || helperAttempt?.state === 'queued');
    const key=(suffix:string)=>createHmac('sha256',this.fingerprintKey).update(JSON.stringify(['helper-outcome',assignmentId,suffix])).digest('hex');
    const body=Buffer.from(outcome,'utf8').subarray(0,16000).toString('utf8') || 'No outcome';
    const store=new CollaborationStore(this.db);
    if (!active) {if (assignment.state === 'active') store.finish({assignmentId,botId:requester,state:'cancelled'});this.taskEvent(helperAttemptId,{type:'collaboration_late',assignmentId,parentAttemptId:parentId});return;}
    if (active) this.assertNoPendingParentInput(parentId,requester);
    if (active) this.consumeDisclosure(disclosureId ?? '',{parentAttemptId:parentId,senderBotId:helper,recipientBotId:requester,kind:state === 'completed' ? 'result' : 'failure',content:body});
    store.append({assignmentId,botId:helper,toBotId:requester,id:key('message'),commandId:key('message-command'),fingerprint:key(body),kind:state === 'completed' ? 'result' : 'failure',inReplyTo:request.id,body,...(!active ? {late:true} : {})});
    if (active) {
      store.finish({assignmentId,botId:requester,state:state === 'completed' ? 'completed' : 'failed'});
      const text=`Helper result (${assignmentId}): ${body}`;
      new TaskInbox(this.db).enqueue({botId:requester,attemptId:parentId,commandId:key('inbox'),kind:'direction',text,digest:key(text)});
      this.taskEvent(parentId,{type:'collaboration_result',assignmentId,messageId:key('message'),helperAttemptId});
    } else if (assignment.state === 'active') store.finish({assignmentId,botId:requester,state:'cancelled'});
    this.taskEvent(helperAttemptId,{type:'collaboration_result',assignmentId,messageId:key('message'),parentAttemptId:parentId,late:!active});
  }
  private finishTask(id:string,state:'completed'|'failed'|'stopped',outcome:string,disclosureId?:string) {
    this.cancelDelegations(id);
    this.deliverHelperOutcome(id,state,outcome,disclosureId);
    this.cancelTaskInputs(id);
    this.db.prepare("UPDATE task_questions SET state='cancelled' WHERE attempt_id=? AND state='open'").run(id);
    const result=this.db.prepare("UPDATE task_attempts SET state=?,outcome=? WHERE id=? AND state IN ('queued','running','stopping')").run(state,outcome,id);
    if(!result.changes) throw Error('Task already finished');
    this.db.prepare("UPDATE schedule_occurrences SET status='completed' WHERE task_id=? AND status IN ('claimed','started')").run(id);
    this.taskEvent(id,{type:state,message:outcome}); const attempt=this.taskAttempt(id);
    if(attempt) this.taskAnnouncement(attempt.botId,`Task ${id} ${state}: ${outcome}`);
    const next=this.db.prepare("SELECT id FROM task_attempts WHERE predecessor=? AND state='waiting'").get(id);
    if(typeof next?.id === 'string') {this.db.prepare("UPDATE task_attempts SET state='queued' WHERE id=?").run(next.id);this.taskEvent(next.id,{type:'queued',message:'Previous attempt settled'});}
    return typeof next?.id === 'string' ? next.id : undefined;
  }
  taskComplete(id:string,session:Session,disclosureId?:string) {
    const answer=session.messages.at(-1);if(!answer || answer.role !== 'assistant' || typeof answer.content !== 'string') throw Error('Missing task outcome');
    this.db.exec('BEGIN IMMEDIATE');
    try {const attempt=this.taskAttempt(id); if(!attempt) throw Error('Task not found'); if(this.isHelperAttempt(id) && attempt.state === 'stopping') {this.taskSave(id,session);this.taskEvent(id,{type:'assistant_observed',text:answer.content,late:true});const next=this.finishTask(id,'stopped','Task stopped');this.db.exec('COMMIT');return {completed:true as const,next};} if(new TaskInbox(this.db).hasPending({botId:attempt.botId,attemptId:id})) {this.db.exec('ROLLBACK');return {completed:false as const};} this.taskSave(id,session);this.taskEvent(id,{type:'assistant',text:answer.content});const next=this.finishTask(id,'completed',answer.content,disclosureId);this.db.exec('COMMIT');return {completed:true as const,next};}
    catch(error){this.db.exec('ROLLBACK');if(disclosureId)this.interruptDisclosure(disclosureId);throw error;}
  }
  taskFinish(id:string,state:'failed'|'stopped',outcome:string,disclosureId?:string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {const next=this.finishTask(id,state,outcome,disclosureId);this.db.exec('COMMIT');return next;}
    catch(error){this.db.exec('ROLLBACK');if(disclosureId)this.interruptDisclosure(disclosureId);throw error;}
  }
  private taskContext(botId:string) { return this.db.prepare('SELECT m.id,m.role,m.content,EXISTS(SELECT 1 FROM task_notices n WHERE n.message_id=m.id) AS isNotice FROM messages m WHERE m.bot_id=? ORDER BY m.seq').all(botId); }
  messages(botId: string) { return this.db.prepare('SELECT id, role, content FROM messages WHERE bot_id=? ORDER BY seq').all(botId); }
  hasBot(botId:string) {return !!this.botIdentity(botId);}
  command(id: string) { const row=this.db.prepare('SELECT c.id,c.bot_id AS botId,c.content,c.state,c.error,p.profile AS capturedProfile FROM commands c LEFT JOIN command_profiles p ON p.command_id=c.id WHERE c.id=?').get(id);if(!row)return undefined;const {capturedProfile,...command}=row;return {id:command.id,botId:command.botId,content:command.content,state:command.state,error:command.error,toolMode:parseToolModeFromProfile(capturedProfile)}; }
  responseProgress(id:string) {return this.db.prepare("SELECT c.id,c.bot_id AS botId,CASE WHEN c.state='pending' THEN CASE WHEN EXISTS(SELECT 1 FROM response_stops s WHERE s.command_id=c.id) THEN 'stopping' WHEN p.command_id IS NULL THEN 'accepted' ELSE 'running' END ELSE c.state END AS state,COALESCE(p.text,'') AS text,c.error FROM commands c LEFT JOIN response_progress p ON p.command_id=c.id WHERE c.id=?").get(id);}
  latestResponse(botId:string) {const row=this.db.prepare('SELECT id FROM commands WHERE bot_id=? ORDER BY rowid DESC LIMIT 1').get(botId);return typeof row?.id==='string'?this.responseProgress(row.id):null;}
  updateResponse(id:string,text:string) {this.db.prepare("INSERT INTO response_progress(command_id,text) SELECT id,? FROM commands WHERE id=? AND state='pending' ON CONFLICT(command_id) DO UPDATE SET text=excluded.text").run(text,id);}
  requestResponseStop(id:string) {
    const command=this.command(id);
    if(!command)return null;
    if(command.state==='pending')this.db.prepare('INSERT OR IGNORE INTO response_stops(command_id) VALUES (?)').run(id);
    return this.responseProgress(id);
  }
  responseStopping(id:string) {return !!this.db.prepare('SELECT 1 FROM response_stops WHERE command_id=?').get(id);}
  settleResponseStop(id:string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const command=this.command(id),progress=this.responseProgress(id);
      if(command?.state==='pending' && this.responseStopping(id) && typeof command.botId==='string') {
        this.db.prepare("INSERT INTO messages VALUES (?, ?, 'assistant_stopped', ?, (SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE bot_id=?))").run(randomUUID(),command.botId,String(progress?.text ?? ''),command.botId);
        this.db.prepare("UPDATE commands SET state='stopped',error=NULL WHERE id=? AND state='pending'").run(id);
      }
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  commandRuntimeEvent(id:string, event:{type:'tool_start'|'tool_result';name:string;success?:boolean}, detail:string|null=null) {
    this.db.prepare('INSERT INTO command_runtime_events (command_id,type,name,success,detail) VALUES (?,?,?,?,?)').run(id,event.type,event.name,event.success === undefined ? null : Number(event.success),detail);
  }
  commandRuntimeEvents(id:string) {
    return this.db.prepare('SELECT type,name,success FROM command_runtime_events WHERE command_id=? ORDER BY seq').all(id).map(row=>row.type === 'tool_result' ? {type:'tool_result' as const,name:String(row.name),success:row.success === 1} : {type:'tool_start' as const,name:String(row.name)});
  }
  chatWork(botId:string) {
    const events=this.db.prepare('SELECT e.command_id,e.seq AS id,e.type,e.name,e.success,e.detail FROM command_runtime_events e JOIN commands c ON c.id=e.command_id WHERE c.bot_id=? ORDER BY e.seq').all(botId);
    const byCommand=new Map<string,typeof events>();
    for(const event of events){const id=String(event.command_id);const group=byCommand.get(id) ?? [];group.push(event);byCommand.set(id,group);}
    const requests=this.db.prepare('SELECT c.id,p.profile AS capturedProfile FROM commands c LEFT JOIN command_profiles p ON p.command_id=c.id WHERE c.bot_id=? ORDER BY c.rowid').all(botId).map(row=>{
      const id=String(row.id);
      return {id,toolMode:parseToolModeFromProfile(row.capturedProfile),progress:this.responseProgress(id),events:byCommand.get(id) ?? [],codeExecutions:this.workActions().inspect({kind:'command',id})};
    });
    return {requests,messages:this.db.prepare('SELECT id,role,content FROM messages WHERE bot_id=? AND id NOT IN (SELECT message_id FROM task_notices) ORDER BY seq').all(botId)};
  }
  chatSession(botId:string):Session {
    const bot=this.botIdentity(botId);if(!bot || typeof bot.chatId !== 'string')throw Error('Agent not found');
    const row=this.db.prepare('SELECT session FROM sessions WHERE bot_id=?').get(botId);
    if(typeof row?.session !== 'string')return {version:1,id:bot.chatId,provider:null,messages:[],events:[]};
    const parsed:unknown=JSON.parse(row.session);if(!validSession(parsed,bot.chatId))throw Error('Invalid stored session');return parsed;
  }

  commandSkills(id:string) { return this.db.prepare('SELECT event FROM command_skill_activity WHERE command_id=? ORDER BY rowid').all(id).map(item=>{ const event=JSON.parse(String(item.event)); if (typeof event.name === 'string') event.name=this.redactSkill(event.name); if (typeof event.digest === 'string' && event.sourceDigest === undefined) { event.sourceDigest=event.digest; delete event.digest; } return event; }); }
  commandSkillLoaded(id:string,event:object) { this.db.prepare('INSERT INTO command_skill_activity VALUES (?,?)').run(id,JSON.stringify(event)); }
  /** Claims and persists the user message together; retries only inspect the existing command. */
  claim(input: {id: string; botId: string; content: string}, visibleContent = input.content) {
    if (!input.id.trim() || !input.content.trim()) throw new Error('Command ID and content are required');
    const digest = createHmac('sha256', this.fingerprintKey).update(JSON.stringify([input.id,input.botId,input.content])).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.command(input.id);
      if (existing) {
        const prior = this.db.prepare('SELECT digest FROM command_fingerprints WHERE command_id=?').get(input.id);
        if (existing.botId !== input.botId || prior?.digest !== digest) throw new Error('Command ID conflict or unverifiable prior submission');
        this.db.exec('COMMIT'); return {kind: 'existing' as const, command: existing};
      }
      const bot = this.bot(input.botId);
      if (!bot) throw new Error('Agent not found');
      if (bot.archived) throw new BotConflict('Agent is archived');
      if (this.db.prepare("SELECT id FROM commands WHERE bot_id=? AND state='pending'").get(input.botId)) {
        this.db.exec('COMMIT'); return {kind: 'busy' as const};
      }
      this.db.prepare("INSERT INTO commands VALUES (?, ?, ?, 'pending', NULL)").run(input.id, input.botId, visibleContent);
      this.db.prepare('INSERT INTO command_fingerprints VALUES (?, ?)').run(input.id, digest);
      this.db.prepare('INSERT INTO command_profiles VALUES (?, ?)').run(input.id, JSON.stringify(bot));
      this.bindWork({kind:'command',id:input.id},input.botId);
      this.db.prepare('INSERT INTO command_notices SELECT ?,message_id FROM task_notices WHERE bot_id=? AND delivered=0').run(input.id,input.botId);
      this.db.prepare("INSERT INTO messages VALUES (?, ?, 'user', ?, (SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE bot_id=?))").run('command-user-'+input.id, input.botId, visibleContent, input.botId);
      this.db.exec('COMMIT'); return {kind: 'accepted' as const,toolMode:bot.toolMode};
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  execution(id: string) {
    const command = this.command(id);
    const row = this.db.prepare('SELECT profile FROM command_profiles WHERE command_id=?').get(id);
    if (!command || command.state !== 'pending' || typeof command.botId !== 'string' || typeof command.content !== 'string' || typeof row?.profile !== 'string') throw Error('Command is not pending');
    const captured = parseCapturedProfile(JSON.parse(row.profile));
    const saved = this.db.prepare('SELECT session FROM sessions WHERE bot_id=?').get(command.botId);
    let session: Session;
    if (typeof saved?.session === 'string') {
      const parsed: unknown = JSON.parse(saved.session);
      if (!validSession(parsed, captured.chatId)) throw Error('Invalid stored session');
      session = parsed;
    } else {
      const messages: Message[] = [];
      for (const m of this.db.prepare('SELECT id,role,content FROM messages WHERE bot_id=? AND id NOT IN (SELECT message_id FROM task_notices) ORDER BY seq').all(command.botId).slice(0, -1)) {
        if (m.role === 'user' && typeof m.content === 'string') { if (messages.at(-1)?.role === 'user') messages.pop(); messages.push({role:'user',content:m.content}); }
        else if (m.role === 'assistant' && typeof m.content === 'string' && messages.at(-1)?.role === 'user') messages.push({role:'assistant',content:m.content});
      }
      if (messages.at(-1)?.role === 'user') messages.pop();
      session = {version:1,id:captured.chatId,provider:messages.length ? 'legacy-visible-chat' : null,messages,events:[]};
      if (!validSession(session, captured.chatId)) throw Error('Cannot reconstruct legacy chat');
    }
    const notices=this.db.prepare('SELECT m.content FROM command_notices n JOIN messages m ON m.id=n.message_id WHERE n.command_id=? ORDER BY m.seq').all(id).map(row=>String(row.content));
    return {command, profile:captured, session, notices};
  }
  completeMemoryCommand(id:string, input:{scope:MemoryScope; text:string} | null, reply:string, operation?:{kind:'list'|'edit'|'delete';scope:MemoryScope;id?:string;version?:number;text?:string}, proposal?:{kind:'propose';text:string}|{kind:'confirm'|'cancel';id:string}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const {command,session}=this.execution(id);
      if (typeof command.botId !== 'string' || typeof command.content !== 'string') throw Error('Invalid command');
      if (input) this.memories.create(input);
      if (proposal?.kind === 'propose') {
        this.proposeSharedMemory(command.botId,proposal.text,id);
        reply=`Proposed shared user memory: ${JSON.stringify(proposal.text)}\nALL agents will see this memory. Nothing has been saved to active memory yet. To save exactly this text, say: Confirm shared memory ${id}\nTo discard it, say: Cancel shared memory ${id}`;
      } else if (proposal) {
        const row=this.db.prepare('SELECT text,state FROM memory_proposals WHERE id=? AND bot_id=?').get(proposal.id,command.botId);
        if (!row) reply='No matching shared memory proposal for this agent. No changes were made.';
        else if (row.state === 'confirmed') reply='That shared memory proposal was already confirmed. No new memory was created.';
        else if (row.state === 'cancelled') reply='That shared memory proposal was cancelled. No changes were made.';
        else if (row.state !== 'pending' || typeof row.text !== 'string') throw Error('Invalid memory proposal');
        else if (proposal.kind === 'cancel') {this.db.prepare("UPDATE memory_proposals SET state='cancelled',text=NULL WHERE id=? AND state='pending'").run(proposal.id); reply='Shared memory proposal cancelled. No memory was saved.';}
        else {this.memories.create({scope:{kind:'user'},text:row.text}); this.db.prepare("UPDATE memory_proposals SET state='confirmed',text=NULL WHERE id=? AND state='pending'").run(proposal.id);reply='Confirmed and saved to shared user memory. All agents can retrieve it.';}
      }
      if (operation) {
        const entries=this.memories.list(operation.scope);
        const label=operation.scope.kind === 'user' ? 'shared user memory' : 'this agent’s memory';
        if (operation.kind === 'list') reply=entries.length ? `Entries in ${label}: ` + entries.map(item=>`${item.id} (version ${item.version}): ${item.text}`).join('\n') : `There are no entries in ${label}.`;
        else {
          const target=entries.find(item=>item.id === operation.id);
          if (!target) reply=`I could not find that memory in ${label}. No changes were made.`;
          else if (operation.version !== target.version) reply=`That memory changed. Refresh ${label} and use its current version. No changes were made.`;
          else if (operation.kind === 'delete') {this.memories.delete({id:target.id,scope:operation.scope,version:operation.version}); reply=`Deleted from ${label}.`;}
          else if (operation.text) {this.memories.update({id:target.id,scope:operation.scope,version:operation.version,text:operation.text}); reply=`Updated ${label}.`;}
        }
      }
      session.provider ??= 'local-memory';
      session.messages.push({role:'user',content:command.content},{role:'assistant',content:reply});
      session.events.push({type:'assistant',text:reply});
      this.db.prepare('INSERT INTO sessions VALUES (?,?) ON CONFLICT(bot_id) DO UPDATE SET session=excluded.session').run(command.botId,JSON.stringify(session));
      this.db.prepare("INSERT INTO messages VALUES (?, ?, 'assistant', ?, (SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE bot_id=?))").run(randomUUID(),command.botId,reply,command.botId);
      this.updateResponse(id,reply);
      this.db.prepare("UPDATE commands SET state='completed' WHERE id=?").run(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  saveExecution(id: string, session: Session, success: boolean) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const command = this.command(id);
      if (!command || command.state !== 'pending' || this.responseStopping(id) || typeof command.botId !== 'string') throw Error('Command is not pending');
      this.db.prepare('INSERT INTO sessions VALUES (?,?) ON CONFLICT(bot_id) DO UPDATE SET session=excluded.session').run(command.botId,JSON.stringify(session));
      if (success) {
        const answer=session.messages.at(-1);
        if (!answer || answer.role !== 'assistant' || typeof answer.content !== 'string') throw Error('Missing assistant answer');
        this.db.prepare("INSERT INTO messages VALUES (?, ?, 'assistant', ?, (SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE bot_id=?))").run(randomUUID(),command.botId,answer.content,command.botId);
        this.updateResponse(id,answer.content);
        this.db.prepare("UPDATE commands SET state='completed' WHERE id=?").run(id);
        this.db.prepare('UPDATE task_notices SET delivered=1 WHERE message_id IN (SELECT message_id FROM command_notices WHERE command_id=?)').run(id);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  complete(id: string, content: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const command = this.command(id);
      if (!command || command.state !== 'pending' || typeof command.botId !== 'string') throw new Error('Command is not pending');
      this.db.prepare("INSERT INTO messages VALUES (?, ?, 'assistant', ?, (SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE bot_id=?))").run(randomUUID(), command.botId, content, command.botId);
      this.updateResponse(id,content);
      this.db.prepare("UPDATE commands SET state='completed' WHERE id=?").run(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  fail(id: string, error: string) {
    const result = this.db.prepare("UPDATE commands SET state='failed', error=? WHERE id=? AND state='pending'").run(error, id);
    if (!result.changes) throw new Error('Command is not pending');
  }
}
