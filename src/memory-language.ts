/** A descriptive request is a lookup only. Mutation remains a separate explicit command. */
export type MemoryLanguageResult =
  | { kind: 'none' }
  | { kind: 'clarify'; reason: 'scope' | 'target' | 'replacement' }
  | { kind: 'preview'; operation: 'find' | 'edit' | 'delete'; scope: 'bot' | 'shared'; query: string; replacement?: string };

export function parseMemoryLanguage(input: string): MemoryLanguageResult {
  if (typeof input !== 'string') throw Error('Invalid memory message');
  const message = input.trim();
  // The existing exact-operation and shared-proposal parser owns these commands.
  if (/^(?:confirm|cancel) shared memory\b/i.test(message) ||
      /^(?:please\s+)?(?:show|list|forget|delete|edit|correct) (?:my )?memor(?:y|ies)(?:\s+[\w-]+)?(?:\s+version\s+\d+)?\s+in\s+(?:this bot|shared|user) memory(?:\s|$)/i.test(message)) return {kind:'none'};
  const match = message.match(/^(?:please\s+)?(?:(what do you remember|what have you saved) about\s+|(show|find|list) (?:my )?memor(?:y|ies) about\s+|(forget|delete) (?:my |the )?memor(?:y|ies) about\s+|(change|edit|correct) (?:my |the )?memor(?:y|ies) about\s+)(.+)$/is);
  if (!match) {
    if (/^(?:please\s+)?(?:(?:what do you remember|what have you saved) about|(?:show|find|list|forget|delete|change|edit|correct) (?:my |the )?memor(?:y|ies) about)\s*$/i.test(message)) return {kind:'clarify',reason:'target'};
    return {kind:'none'};
  }
  const operation = match[3] ? 'delete' : match[4] ? 'edit' : 'find';
  let body = (match[5] ?? '').trim();
  if (match[1] && body.endsWith('?')) body = body.slice(0,-1).trimEnd();
  let scope: 'bot' | 'shared' = 'bot';
  const suffix = body.match(/\s+in\s+(this bot|shared|user) memory\s*$/i);
  if (suffix) { scope = suffix[1]?.toLowerCase() === 'this bot' ? 'bot' : 'shared'; body = body.slice(0, suffix.index).trimEnd(); }
  // Never guess exclusions, partial sharing, or a named/other bot scope.
  if (/\b(?:except|excluding|exclude|but not|other than|without|only|just|not|for|(?:do not|don't|never) (?:share|tell|send|give)|(?:another|other|all|both|any|each) bots?|for (?:a |the |my )?bots?|for [\p{L}\p{N}_-]+(?:'s|’s)? bot|(?:shared|user|bot) memory|in [\p{L}\p{N}_-]+(?:'s|’s) memory)\b/iu.test(body)) return {kind:'clarify',reason:'scope'};
  let query = body;
  let replacement: string | undefined;
  if (operation === 'edit') {
    const parts = body.split(/\s+to\s+/i);
    if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) return {kind:'clarify',reason:'replacement'};
    query = parts[0].trim(); replacement = parts[1].trim();
    if (replacement.length > 4000) return {kind:'clarify',reason:'replacement'};
  }
  if (!query.trim() || query.length > 256) return {kind:'clarify',reason:'target'};
  return {kind:'preview',operation,scope,query,...(replacement ? {replacement} : {})};
}
