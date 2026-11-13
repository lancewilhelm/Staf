import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';

const text=z.string().trim().min(1).max(1000);
const choices=z.array(text).min(1).max(12).refine(values=>new Set(values).size===values.length,{message:'Choices must be distinct'});
export const questionSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('single'),prompt:text,choices}),
  z.strictObject({kind:z.literal('multiple'),prompt:text,choices}),
  z.strictObject({kind:z.literal('text'),prompt:text}),
]);
export const questionSetInput=z.strictObject({questions:z.array(questionSchema).min(1).max(12)});
const draftAnswer=z.union([z.null(),z.strictObject({choices:z.array(z.string().max(1000)).max(12),writeIn:z.string().max(4000)})]);
const drafts=z.array(draftAnswer).max(12);
export const questionSetSchema=`CREATE TABLE IF NOT EXISTS question_sets (
 id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), command_id TEXT NOT NULL REFERENCES commands(id),
 questions TEXT NOT NULL, draft TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('open','submitted','dismissed')),
 result TEXT, continuation_id TEXT NOT NULL UNIQUE, delivery_error TEXT
);`;
export class QuestionSets {
 constructor(private db:DatabaseSync) {}
 create(id:string,botId:string,commandId:string,input:z.infer<typeof questionSetInput>) {
  const questions=questionSetInput.parse(input).questions;
  this.db.prepare("INSERT OR IGNORE INTO question_sets VALUES (?,?,?,?,?,'open',NULL,?,NULL)").run(id,botId,commandId,JSON.stringify(questions),JSON.stringify(questions.map(()=>null)),randomUUID());
  const row=this.db.prepare('SELECT bot_id,command_id,questions FROM question_sets WHERE id=?').get(id);
  if(!row || row.bot_id!==botId || row.command_id!==commandId || row.questions!==JSON.stringify(questions))throw Error('Question request identity conflict');
 }
 list() {
  return this.db.prepare(`SELECT q.*,c.state AS origin_state,n.state AS continuation_state,n.error AS continuation_error FROM question_sets q JOIN commands c ON c.id=q.command_id LEFT JOIN commands n ON n.id=q.continuation_id ORDER BY q.rowid`).all().map(row=>({id:String(row.id),botId:String(row.bot_id),workId:String(row.command_id),questions:questionSetInput.parse({questions:JSON.parse(String(row.questions))}).questions,draft:drafts.parse(JSON.parse(String(row.draft))),state:String(row.state),result:typeof row.result==='string'?JSON.parse(row.result):null,originState:String(row.origin_state),continuationId:String(row.continuation_id),continuationState:typeof row.continuation_state==='string'?row.continuation_state:null,continuationError:typeof row.continuation_error==='string'?row.continuation_error:null,deliveryError:typeof row.delivery_error==='string'?row.delivery_error:null}));
 }
 draft(id:string,value:unknown) {
  const answers=drafts.parse(value),row=this.list().find(q=>q.id===id);if(!row || row.state!=='open')throw Error('Question request is not open');if(answers.length!==row.questions.length)throw Error('Invalid answer count');
  for(let i=0;i<answers.length;i++){const answer=answers[i],question=row.questions[i];if(!answer || !question)continue;if(question.kind==='text' && answer.choices.length)throw Error('Text questions do not accept choices');if(question.kind!=='text' && (answer.choices.some(choice=>!question.choices.includes(choice)) || new Set(answer.choices).size!==answer.choices.length || question.kind==='single' && answer.choices.length+(answer.writeIn.trim()?1:0)>1))throw Error('Invalid choices');}
  this.db.prepare("UPDATE question_sets SET draft=? WHERE id=? AND state='open'").run(JSON.stringify(answers),id);
 }
 finish(id:string,decision:'submit'|'dismiss') {
  const row=this.list().find(q=>q.id===id);if(!row)throw Error('Question request not found');
  const state=decision==='submit'?'submitted':'dismissed';if(row.state!== 'open'){if(row.state!==state)throw Error('Question request already resolved');return row;}
  const result=decision==='dismiss'?{status:'dismissed'}:{status:'submitted',answers:row.questions.map((question,i)=>{const answer=row.draft[i];return !answer || (!answer.choices.length && !answer.writeIn.trim())?{question:question.prompt,status:'skipped'}:{question:question.prompt,status:'answered',choices:answer.choices,writeIn:answer.writeIn};})};
  this.db.prepare("UPDATE question_sets SET state=?,result=? WHERE id=? AND state='open'").run(state,JSON.stringify(result),id);return this.list().find(q=>q.id===id)!;
 }
 deliveryError(id:string,value:string|null) {this.db.prepare('UPDATE question_sets SET delivery_error=? WHERE id=?').run(value,id);}
 ancestors(id:string):string[] {return this.db.prepare(`WITH RECURSIVE lineage(id) AS (SELECT command_id FROM question_sets WHERE continuation_id=? UNION SELECT q.command_id FROM question_sets q JOIN lineage l ON q.continuation_id=l.id) SELECT id FROM lineage`).all(id).map(row=>String(row.id));}
 continuationState(id:string) {const row=this.db.prepare('SELECT state FROM question_sets WHERE continuation_id=?').get(id);return row?.state;}
 isContinuation(id:string) {return !!this.db.prepare('SELECT 1 FROM question_sets WHERE continuation_id=?').get(id);}
 queued() {return this.list().filter(row=>row.state!=='open' && row.continuationState===null && row.originState==='completed');}
}
