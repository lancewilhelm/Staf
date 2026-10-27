import {responsesInput} from './codex-direct.js';
import type { Session, Message } from './types.js';
import type { EffectiveSettings } from './settings.js';
import { cachedModelCatalog, type ModelCatalog } from './models.js';
import { chatSystemMessage, codexPrompt, codexResponseSchema } from './prompts.js';
import { tools } from './runtime.js';

interface LastCall {
  input?: number; cachedInput?: number; provider: string; model?: string;
  observedAt?: string; scope: 'request'|'execution'|'unknown';
}
export interface ContextStatus {
  lastCall?: LastCall;
  provider: string; model: string; messages: number; bytes: number; proxyTokens?: number;
  excludedReasoningItems?: number;
  window?: number; windowSource?: string; fetchedAt?: string; stale?: boolean;
  native: boolean; pending: boolean;
}
/** A size proxy, NOT a tokenizer or provider's active context measurement. No content is returned. */
export function contextStatus(session: Session, settings: EffectiveSettings, pending?: string, catalog: (ModelCatalog & {stale?: boolean}) | undefined = cachedModelCatalog(settings)): ContextStatus {
  const messages: Message[] = structuredClone(session.messages);
  if(pending)messages.push({role:'user',content:pending});
  const provider=settings.provider.value;
  const input=provider==='codex'?responsesInput(messages,settings.model.value):[];
  const visibleInput=input.filter(item=>item.type!=='reasoning');
  const excludedReasoningItems=input.length-visibleInput.length;
  const payload=provider==='codex' ? JSON.stringify({instructions:chatSystemMessage.content,input:visibleInput,tools:tools.map(tool=>({type:'function',...tool.function}))})
    : JSON.stringify({messages:[chatSystemMessage,...messages.map(message=>{
      if(message.role!=='assistant')return message;
      const {usage,responseReplay,...visible}=message;
      return visible;
    })],tools});
  const bytes=Buffer.byteLength(payload,'utf8');
  const model = catalog?.models.find(model=>model.id===settings.model.value);
  const last = session.usage?.at(-1);
  // Older ledgers have verified normalizer source labels but no explicit scope/time.
  const scope = last?.scope || (last?.source === 'OpenRouter response.usage (cost in account credits)' || last?.source === 'LM Studio response.usage' ? 'request' : last?.source === 'Codex fresh exec cumulative usage; total not reported' ? 'execution' : 'unknown');
  return {...(last ? {lastCall: {input: last.metrics.input, cachedInput: last.metrics.cachedInput, provider: last.provider, model: last.model, observedAt: last.observedAt, scope}} : {}),provider,model:settings.model.value,messages:messages.length,bytes,
    ...(excludedReasoningItems?{excludedReasoningItems}:{}),
    ...(provider!=='demo'?{proxyTokens:Math.ceil(bytes/4)}:{}),
    ...(model?.contextWindow?{window:model.contextWindow,windowSource:catalog?.source,fetchedAt:catalog?.fetchedAt,stale:catalog?.stale || false}:{}),
    native:false,pending:!!pending};
}
function measurementLine(status:ContextStatus): string {
  const last = status.lastCall;
  if(!last)return status.provider === 'demo' ? 'Measured: not applicable (offline demo has no model call).' : 'Measured: last request input unavailable (no call report yet).';
  if(last.provider === 'demo')return 'Measured: last call was offline demo; model token usage is not applicable.';
  const origin = `${last.provider}${last.model ? ` / reported model ${last.model}` : ''}; ${last.observedAt || 'time unavailable (older record)'}`;
  if(last.scope === 'execution')return `Measured: last exec input ${last.input ?? 'unavailable'} tokens (cumulative aggregate, NOT native context) [${origin}]`;
  if(last.scope !== 'request' || last.input === undefined)return `Measured: last request input unavailable (not reported or scope unknown) [${origin}]`;
  return `Measured: last HTTP request input ${last.input} tokens${last.cachedInput === undefined ? '' : ` (${last.cachedInput} cached, already included)`} [historical: ${origin}]`;
}
export function contextLine(status:ContextStatus):string {
  return measurementLine(status) + '\n' + payloadLine(status);
}
/** Recurring UI status only. Historical measurements and caveats belong to /context. */
export function contextFooter(status: ContextStatus): string {
  if (status.provider === 'demo') return 'Context: demo';
  if (status.native) return 'Context: unavailable';
  const compact = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value).toLowerCase();
  const estimate = compact(status.proxyTokens || 0);
  const label = status.excludedReasoningItems ? 'visible est.' : 'est.';
  return status.window && !status.stale
    ? `Context: ~${estimate} / ${compact(status.window)} (${label})`
    : `Context: ~${estimate} tokens (${label})`;
}
function payloadLine(status:ContextStatus):string {
  if(status.provider==='demo')return `Context: demo (no model tokens/window); ${status.messages} saved/submitted messages | Compaction: not implemented`;
  const limit=status.window?`${status.window} advertised${status.stale?' [stale]':''}`:'unknown window';
  if(status.native)return `Context: native occupancy unknown / ${limit} | Staf payload ~${status.proxyTokens} tokens (bytes/4 proxy) | Compaction: Staf none; native unknown`;
  const fraction=status.window?` (~${((status.proxyTokens||0)/status.window*100).toFixed(1)}% proxy)`:'';
  return `Context: next ${status.excludedReasoningItems?'visible ':''}payload ~${status.proxyTokens} tokens (bytes/4 proxy) / ${limit}${fraction} | Compaction: not implemented`;
}
export function contextDetails(session:Session,settings:EffectiveSettings,pending?:string,catalog?:ModelCatalog):string {
  const status=contextStatus(session,settings,pending,catalog);
  const lines=[contextLine(status),`Selected: ${status.provider} / ${status.model||'(provider default)'}; size computed now from ${status.messages} messages${status.pending?' including submitted user input':''}.`,
    `Visible Staf payload: ${status.bytes} UTF-8 bytes. Proxy recipe: ceil(bytes/4), not a tokenizer. JSON/history, Staf instructions and clock schema are included; direct Codex uses Responses item boundaries.`,
    'This rough text-size heuristic can be badly wrong for code, non-English text and tokenizers. Native instructions, hidden provider wrappers and native tool state are unknown. Unsubmitted prompt edits are excluded.',
    'Measured input above belongs to the labeled historical request, not the next context. No measured-plus-delta baseline is inferred: the ledger has no exact request/template fingerprint to prove unchanged payload lineage.',
    'Output reserve: not configured or subtracted by Staf; advertised window is not guaranteed usable input capacity. This display is not a safety limit.',
    `Window source: ${status.windowSource||'unavailable; use /context refresh for an explicit metadata read'}${status.fetchedAt?`; fetched ${status.fetchedAt}`:''}. LM Studio/legacy compatible catalogs have no verified window mapping here.`,
    'Staf does not compact, summarize or truncate history and has no compaction trigger. Direct Codex does not invoke a native CLI compactor. Historical CLI execution usage remains an aggregate.'];
  if(status.excludedReasoningItems)lines.push(`${status.excludedReasoningItems} opaque reasoning replay items excluded from this visible estimate; their token occupancy is unknown. They remain in the direct request.`);
  if(status.native)lines.push('Codex cumulative exec consumption is NOT active context occupancy.');
  lines.push('Cumulative session consumption remains in /usage and survives resume. Compaction would not reset consumption. No account quota query is made.');
  return lines.join('\n');
}
