export type WorkspaceReference =
  | {kind: 'session-message'; sessionId: string; messageId: string; start?:number}
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

export type SelectedReference = Pick<ResolvedReference, 'reference' | 'title' | 'location'>;
