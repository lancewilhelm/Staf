<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkspace } from '../workspace';
import { renderArtifactMarkdown } from '../markdown';
import type { ArtifactCreateInput, ArtifactFormat, ArtifactRevision, ArtifactRevisionInfo, ArtifactSource, ArtifactSummary } from '../controller';
import type {WorkspaceReference} from '../../src/workspace-reference-types';

const props=defineProps<{botId:string;initialText?:string;initialProvenance?:ArtifactSource}>();
const emit=defineEmits<{reference:[value:{kind:'artifact-revision';artifactId:string;revision:number}];inspect:[reference:WorkspaceReference];back:[]}>();
const {app}=useWorkspace();
const items=ref<ArtifactSummary[]>([]), revisions=ref<ArtifactRevisionInfo[]>([]), selected=ref<ArtifactRevision|null>(null);
const name=ref(''),format=ref<ArtifactFormat>('text'),draft=ref(props.initialText ?? ''),creating=ref(true),editing=ref(true),busy=ref(false),error=ref('');
let pending:{fingerprint:string;operationId:string}|undefined;
const initialSource=ref<ArtifactSource|undefined>(props.initialProvenance);
let generation=0;
const dirty=computed(()=>editing.value && (creating.value ? !!name.value || !!draft.value : draft.value!==selected.value?.content));
const markdown=computed(()=>renderArtifactMarkdown(selected.value?.content ?? ''));
function operation(input:unknown){const fingerprint=JSON.stringify(input);if(!pending || pending.fingerprint!==fingerprint)pending={fingerprint,operationId:crypto.randomUUID()};return pending.operationId;}
async function load(){const current=++generation;try{const result=await app.artifactList(props.botId);if(current===generation)items.value=result;}catch(e){if(current===generation)error.value=String(e);}}
async function open(id:string,revision:number){if(dirty.value)return;busy.value=true;error.value='';const current=++generation;try{const [item,history]=await Promise.all([app.artifactRead(props.botId,id,revision),app.artifactRevisions(props.botId,id)]);if(current!==generation)return;selected.value=item;revisions.value=history;draft.value=item.content;creating.value=false;editing.value=false;pending=undefined;}catch(e){if(current===generation)error.value=String(e);}finally{busy.value=false;}}
function newArtifact(){if(dirty.value)return;creating.value=true;editing.value=true;selected.value=null;name.value='';format.value='text';draft.value='';initialSource.value=undefined;pending=undefined;error.value='';}
async function save(){if(busy.value)return;busy.value=true;error.value='';try{let saved:ArtifactRevision;if(creating.value){const fields={name:name.value,format:format.value,content:draft.value,...(initialSource.value ? {source:initialSource.value} : {})};const input:ArtifactCreateInput={...fields,operationId:operation(fields)};saved=await app.artifactCreate(props.botId,input);}else{if(!selected.value)throw Error('Choose an artifact');const fields={expectedRevision:selected.value.revision,content:draft.value};saved=await app.artifactRevise(props.botId,selected.value.id,{...fields,operationId:operation(fields)});}pending=undefined;initialSource.value=undefined;selected.value=saved;creating.value=false;editing.value=false;draft.value=saved.content;revisions.value=await app.artifactRevisions(props.botId,saved.id);await load();}catch(e){error.value=String(e);}finally{busy.value=false;}}
function cancel(){if(creating.value){name.value='';draft.value='';initialSource.value=undefined;}else draft.value=selected.value?.content ?? '';editing.value=false;pending=undefined;error.value='';}
async function download(){if(!selected.value)return;try{const blob=await app.artifactDownload(props.botId,selected.value.id,selected.value.revision);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;const base=selected.value.name.replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'artifact';a.download=base+'.'+({text:'txt',markdown:'md',csv:'csv'}[selected.value.format]);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){error.value=String(e);}}
watch(()=>props.botId,()=>{generation++;selected.value=null;revisions.value=[];items.value=[];name.value='';format.value='text';draft.value=props.initialText ?? '';initialSource.value=props.initialProvenance;creating.value=true;editing.value=true;pending=undefined;error.value='';void load();},{immediate:true});
function prefill(text:string,source:ArtifactSource){if(dirty.value||busy.value)return false;newArtifact();draft.value=text;initialSource.value=source;format.value='markdown';return true;}
async function openSource(id:string,revision:number){if(dirty.value||busy.value)return false;await open(id,revision);return true;}
defineExpose({prefill,openSource});
</script>
<template>
  <div class="settings-scroll"><div class="setup settings-content artifact-view">
    <h1 class="page-title">Artifacts</h1>
    <p class="page-intro">Save text, Markdown, or CSV. Every save keeps the previous revision.</p>
    <div class="row"><button class="quiet" :disabled="dirty || busy" @click="emit('back')">Back</button><button class="quiet" :disabled="dirty || busy" @click="newArtifact">New artifact</button><button class="quiet" :disabled="busy" @click="load">Refresh list</button></div>
    <p v-if="error" role="alert">{{ error }}. Your draft remains available.</p>
    <p v-if="dirty" class="meta">Finish or cancel your draft before opening another artifact.</p>
    <ul aria-label="Artifacts"><li v-for="item in items" :key="item.id"><button class="quiet" :disabled="dirty || busy" @click="open(item.id,item.revision)">{{ item.name }} · revision {{ item.revision }}</button></li></ul>
    <form v-if="editing" @submit.prevent="save">
      <template v-if="creating"><label>Name <input v-model="name" required maxlength="200"></label><label>Format <select v-model="format"><option value="text">Plain text</option><option value="markdown">Markdown</option><option value="csv">CSV</option></select></label><p v-if="initialSource" class="meta">Based on a completed message in this agent's conversation history.</p></template>
      <h2 v-else>Edit {{ selected?.name }}</h2>
      <label>Content <textarea v-model="draft" rows="14" style="width:100%;max-width:100%"></textarea></label>
      <p class="meta">Maximum 1 MiB of UTF-8 text per revision.</p>
      <div class="row"><button type="submit" :disabled="busy">Save</button><button type="button" class="quiet" :disabled="busy" @click="cancel">Cancel draft</button></div>
    </form>
    <section v-if="selected && !editing"><h2>{{ selected.name }}</h2><p class="meta">Revision {{ selected.revision }} · {{ selected.format }} · {{ selected.createdAt }}</p><button v-if="selected.sourceSessionId && selected.sourceMessageId" class="quiet" @click="emit('inspect',{kind:'session-message',sessionId:selected.sourceSessionId,messageId:selected.sourceMessageId})">View source message</button><details class="meta"><summary>Revision details</summary><p>SHA-256 {{ selected.digest }}</p></details>
      <label>Revision <select :value="selected.revision" :disabled="busy" @change="open(selected.id,Number(($event.target as HTMLSelectElement).value))"><option v-for="version in revisions" :key="version.revision" :value="version.revision">{{ version.revision }}</option></select></label>
      <div class="row"><button @click="editing=true">Edit this revision</button><button class="quiet" @click="download">Download</button><button class="quiet" @click="emit('reference',{kind:'artifact-revision',artifactId:selected.id,revision:selected.revision})">Reference revision</button></div>
      <div v-if="selected.format==='markdown'" class="markdown" v-html="markdown"></div><pre v-else style="white-space:pre-wrap;overflow-wrap:anywhere">{{ selected.content }}</pre>
    </section>
  </div></div>
</template>
