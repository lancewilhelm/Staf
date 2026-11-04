export type WorkspaceReference =
  | {kind: 'session-message'; sessionId: string; messageId: string}
  | {kind: 'document-excerpt'; documentId: string; excerptId: string}
  | {kind: 'artifact-revision'; artifactId: string; revision: number};

export type ResolvedReference = {
  reference: WorkspaceReference;
  title: string;
  location: string;
  sourceDigest: string;
  contentDigest: string;
  content: string;
};
