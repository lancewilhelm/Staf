import {parseWorkspaceReferences, referenceLimits} from '../src/workspace-reference-input';
import type {ResolvedReference, SelectedReference} from '../src/workspace-reference-types';

const record = (value:unknown):value is Record<string,unknown> => typeof value==='object' && value!==null && !Array.isArray(value);

export function parseSelectedReferences(value:unknown):SelectedReference[] {
  if (value===undefined) return [];
  if (!Array.isArray(value) || value.length>referenceLimits.count) throw Error('Invalid selected sources.');
  return value.map((item:unknown) => {
    if (!record(item) || typeof item.title!=='string' || item.title.length>300 || typeof item.location!=='string' || item.location.length>300) throw Error('Invalid source information.');
    const reference=parseWorkspaceReferences([item.reference])[0];
    if (!reference) throw Error('Invalid source reference.');
    return {reference,title:item.title,location:item.location};
  });
}

export function parseResolvedReference(value:unknown):ResolvedReference {
  if (!record(value) || typeof value.content!=='string' || value.content.length>referenceLimits.excerptCharacters || typeof value.contentDigest!=='string' || !/^[a-f0-9]{64}$/.test(value.contentDigest) || typeof value.sourceDigest!=='string' || !/^[a-f0-9]{64}$/.test(value.sourceDigest)) throw Error('Invalid source excerpt.');
  const source=parseSelectedReferences([value])[0];
  if (!source) throw Error('Invalid source excerpt.');
  return {...source,content:value.content,contentDigest:value.contentDigest,sourceDigest:value.sourceDigest};
}
