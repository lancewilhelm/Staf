import type { WorkspaceReference } from './workspace-reference-types.js';

const isRecord = (value:unknown):value is Record<string,unknown> => typeof value==='object' && value!==null && !Array.isArray(value);
export const referenceLimits = {count: 8, excerptCharacters: 6000, totalCharacters: 24000};

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[\w:.-]{1,200}$/.test(value);
}

export function parseWorkspaceReferences(value: unknown): WorkspaceReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > referenceLimits.count) throw Error('Select at most eight source references.');
  const references = value.map((item: unknown): WorkspaceReference => {
    if (!isRecord(item)) throw Error('Invalid source reference.');
    if (item.kind === 'session-message' && identifier(item.sessionId) && identifier(item.messageId)) {
      if (item.start!==undefined && (typeof item.start!=='number' || !Number.isSafeInteger(item.start) || item.start<0)) throw Error('Invalid source excerpt position.');
      return {kind: item.kind, sessionId: item.sessionId, messageId: item.messageId,...(typeof item.start==='number'&&item.start>0?{start:item.start}:{})};
    }
    if (item.kind === 'document-excerpt' && identifier(item.documentId) && identifier(item.excerptId)) {
      return {kind: item.kind, documentId: item.documentId, excerptId: item.excerptId};
    }
    if (item.kind === 'artifact-revision' && identifier(item.artifactId) && typeof item.revision === 'number' && Number.isSafeInteger(item.revision) && item.revision > 0) {
      return {kind: item.kind, artifactId: item.artifactId, revision: item.revision};
    }
    throw Error('Invalid source reference.');
  });
  if (new Set(references.map(item => JSON.stringify(item))).size !== references.length) throw Error('A source reference was selected more than once.');
  return references;
}

