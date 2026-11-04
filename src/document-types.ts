export type DocumentReference = {kind:'document-excerpt'; documentId:string; excerptId:string};
export type DocumentSummary = {id:string; name:string; mediaType:string; digest:string; retired:boolean; createdAt:string};
export type DocumentExcerpt = {documentId:string; excerptId:string; name:string; digest:string; page:number|null; line:number|null; text:string};
