function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
import type { Session } from './types.js';

export interface UsageMetrics {
  input?: number; output?: number; total?: number;
  cachedInput?: number; cacheWriteInput?: number; reasoningOutput?: number;
  costCredits?: number;
}
export interface UsageReport {
  scope?: 'request' | 'execution';
  status: 'reported' | 'unavailable' | 'not-applicable';
  source: string;
  model?: string;
  metrics: UsageMetrics;
}
export interface UsageObservation extends UsageReport {
  observedAt?: string;
  id: string; attempt: string; provider: string; latencyMs: number;
  outcome: 'response' | 'failed'; turnStart: number;
}
const counts = ['input','output','total','cachedInput','cacheWriteInput','reasoningOutput'] as const;
export const metricKeys = [...counts, 'costCredits'] as const;
function count(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function amount(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }
export function sanitizeMetrics(raw: unknown): UsageMetrics {
  if (!isRecord(raw)) return {};
  const result: UsageMetrics = {};
  for (const key of counts) { const value=count(raw[key]); if(value!==undefined) result[key]=value; }
  const cost=amount(raw.costCredits);if(cost!==undefined)result.costCredits=cost;
  if(result.input!==undefined) for(const key of ['cachedInput','cacheWriteInput'] as const) if((result[key]??0)>result.input)delete result[key];
  if(result.output!==undefined && (result.reasoningOutput??0)>result.output)delete result.reasoningOutput;
  if(result.input!==undefined && result.output!==undefined && result.total!==undefined && result.total!==result.input+result.output)delete result.total;
  return result;
}
export function httpUsage(body: Record<string, unknown>, provider: 'openrouter'|'lmstudio'|'live'): UsageReport {
  if(provider==='live')return {status:'unavailable',source:'Legacy HTTP has no verified usage contract',metrics:{}};
  const raw=isRecord(body.usage)?body.usage:{};
  const prompt=isRecord(raw.prompt_tokens_details)?raw.prompt_tokens_details:{};
  const completion=isRecord(raw.completion_tokens_details)?raw.completion_tokens_details:{};
  const metrics=sanitizeMetrics({input:raw.prompt_tokens,output:raw.completion_tokens,total:raw.total_tokens,
    ...(provider==='openrouter'?{cachedInput:prompt.cached_tokens,cacheWriteInput:prompt.cache_write_tokens,reasoningOutput:completion.reasoning_tokens,costCredits:raw.cost}:{})});
  return {scope:'request',status:Object.keys(metrics).length?'reported':'unavailable',source:provider==='openrouter'?'OpenRouter response.usage (cost in account credits)':'LM Studio response.usage',
    ...(typeof body.model==='string' && /^[A-Za-z0-9._:/@+-]{1,200}$/.test(body.model)?{model:body.model}:{}),metrics};
}
/** Fresh ephemeral exec only: consume the last cumulative snapshot once, never sum JSONL snapshots. */
export function codexUsage(jsonl: string): UsageReport {
  let metrics:UsageMetrics={};
  for(const line of jsonl.split('\n')) {
    let item:unknown;try{item=JSON.parse(line);}catch{continue;}
    if(!isRecord(item)||item.type!=='turn.completed'||!isRecord(item.usage))continue;
    const u=item.usage;
    metrics=sanitizeMetrics({input:u.input_tokens,output:u.output_tokens,cachedInput:u.cached_input_tokens,cacheWriteInput:u.cache_write_input_tokens,reasoningOutput:u.reasoning_output_tokens});
  }
  return {scope:'execution',status:Object.keys(metrics).length?'reported':'unavailable',source:'Codex fresh exec cumulative usage; total not reported',metrics};
}
export function isUsageObservation(raw: unknown): raw is UsageObservation {
  if(!isRecord(raw)||!['reported','unavailable','not-applicable'].includes(String(raw.status))||typeof raw.source!=='string'||typeof raw.id!=='string'||typeof raw.attempt!=='string'||typeof raw.provider!=='string'||!['response','failed'].includes(String(raw.outcome))||count(raw.turnStart)===undefined||amount(raw.latencyMs)===undefined||!isRecord(raw.metrics))return false;
  if(raw.scope!==undefined && !['request','execution'].includes(String(raw.scope)))return false;
  if(raw.observedAt!==undefined && (typeof raw.observedAt!=='string'||!Number.isFinite(Date.parse(raw.observedAt))))return false;
  if(raw.model!==undefined && (typeof raw.model!=='string'||!/^[A-Za-z0-9._:/@+-]{1,200}$/.test(raw.model)))return false;
  const sanitized=sanitizeMetrics(raw.metrics);
  return Object.keys(raw.metrics).every(key=>metricKeys.some(k=>k===key)&&Object.hasOwn(sanitized,key));
}
const caching = 'Prompt caching reuses eligible matching prompt prefixes. Cached reads and cache writes are input details; reasoning is an output detail. Do not add these subsets again. Eligibility, routing, expiry and pricing vary; writes may be charged. Caching can reduce latency/price, but is not durable chat memory, unlimited context, or a retention guarantee.';
function summary(title:string, rows:UsageObservation[]):string[] {
  const lines=[title,`  Calls observed: ${rows.length} (${rows.filter(r=>r.outcome==='failed').length} failed); wall latency sum: ${rows.reduce((n,r)=>n+r.latencyMs,0).toFixed(0)} ms`];
  for(const key of metricKeys){const entries=rows.filter(r=>r.metrics[key]!==undefined);const total=entries.reduce((sum,r)=>sum+(r.metrics[key]??0),0);
    const valid = key === 'costCredits' ? Number.isFinite(total) : Number.isSafeInteger(total);
    lines.push(`  ${key}: ${entries.length && valid ? `${total} reported subtotal (${entries.length}/${rows.length} calls)` : entries.length ? 'unavailable (subtotal overflow)' : 'unavailable'}`);}
  return lines;
}
export function usageText(session:Session, detail=false):string {
  const seen=new Set<string>();const rows=(session.usage||[]).filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true;});
  const lines=['Usage — Staf-observed session only', 'Reported counts only; unavailable is not zero. Cached/reasoning details are subsets.'];
  const covered=new Set(rows.filter(r=>r.outcome==='response').map(r=>r.turnStart));
  const turns=session.messages.filter(m=>m.role==='user').length;
  lines.push(`History coverage: ${covered.size} observed turn starts; ${turns} saved user turns. Failed/rolled-back attempts may be included. Older history can have incomplete coverage.`);
  if(rows.length){const last=rows.at(-1)!;lines.push(...summary(`Last request: ${last.provider} [${last.status}]`,[last]));lines.push(...summary('Last attempt (one user turn, including tool continuations)',rows.filter(r=>r.attempt===last.attempt)));const completed = session.turns?.at(-1);
    const completedRow = completed ? [...rows].reverse().find(r => r.turnStart === completed.start && r.outcome === 'response') : undefined;
    if (completedRow) lines.push(...summary('Last completed turn', rows.filter(r => r.attempt === completedRow.attempt)));
    lines.push(...summary('Session totals',rows));
    const groups=new Map<string,UsageObservation[]>();for(const r of rows){const key=r.model?`${r.provider} | reported model ${r.model}`:r.provider;groups.set(key,[...(groups.get(key)||[]),r]);}
    for(const [name,group] of groups)lines.push(...summary(`Provider/model: ${name}`,group));
    if(detail)for(const row of rows)lines.push(`Call ${row.id}: ${row.provider}; ${row.outcome}; ${row.status}; scope ${row.scope || 'unknown (older record)'}; observed ${row.observedAt || 'time unavailable'}; ${row.source}; ${JSON.stringify(row.metrics)}`);
  }else lines.push('No calls observed yet. Demo is not a model; token/cost usage is not applicable.');
  lines.push('Account quota/remaining subscription allowance: unavailable. Context-window occupancy: unavailable. Dollar estimates: not calculated. Local inference is not a claim of zero operating cost.',`Caching: ${caching}`,'Commands: /usage details (per-call sources) | /usage help');
  return lines.join('\n');
}
export const usageHelp='Usage: /usage [details|help]. No provider or account request is made. Metrics are optional provider reports, not estimates. OpenRouter costCredits is reported account credits, not upstream cost or a dollar estimate. Codex reports fresh-exec totals, not account quota or dollar charges. Demo is not applicable; legacy HTTP and failed calls may be unavailable. '+caching;
