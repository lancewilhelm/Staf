<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue';
import type { DocumentSummary, DocumentExcerpt, DocumentReference } from '../../src/document-types';
import { useWorkspace } from '../workspace';
const props=defineProps<{botId:string}>();
const emit=defineEmits<{reference:[value:DocumentReference]}>();
const {app}=useWorkspace();
const documents=ref<DocumentSummary[]>([]),excerpts=ref<DocumentExcerpt[]>([]),query=ref(''),file=ref<File|null>(null),error=ref(''),status=ref(''),busy=ref(false),selected=ref<DocumentSummary|null>(null);
const fileInput=ref<HTMLInputElement|null>(null);const offset=ref(0),libraryOffset=ref(0);
let operationId=crypto.randomUUID();let controller=new AbortController();let generation=0;
async function load(next=libraryOffset.value) {const current=++generation;try{const result=await app.documents(props.botId,controller.signal,next);if(current===generation){documents.value=result;libraryOffset.value=next;}}catch(e){if(current===generation && !controller.signal.aborted)error.value=String(e);}}
watch(()=>props.botId,()=>{controller.abort();controller=new AbortController();file.value=null;if(fileInput.value)fileInput.value.value='';selected.value=null;excerpts.value=[];error.value='';status.value='';libraryOffset.value=0;operationId=crypto.randomUUID();void load();},{immediate:true});
onScopeDispose(()=>controller.abort());
function choose(event:Event){const target=event.target;if(target instanceof HTMLInputElement){file.value=target.files?.[0]??null;operationId=crypto.randomUUID();}}
async function upload(){if(!file.value)return;busy.value=true;error.value='';const bot=props.botId;try{await app.uploadDocument(bot,operationId,file.value,controller.signal);if(bot!==props.botId)return;file.value=null;if(fileInput.value)fileInput.value.value='';operationId=crypto.randomUUID();status.value='Document imported.';await load();}catch(e){if(bot===props.botId)error.value=String(e);}finally{busy.value=false;}}
async function search(){error.value='';selected.value=null;const bot=props.botId,signal=controller.signal;try{const result=await app.searchDocuments(bot,query.value,signal);if(bot===props.botId && !signal.aborted)excerpts.value=result;}catch(e){if(bot===props.botId && !signal.aborted)error.value=String(e);}}
async function inspect(doc:DocumentSummary,next=0){error.value='';const bot=props.botId;try{const result=await app.readDocument(bot,doc.id,controller.signal,next);if(bot!==props.botId)return;selected.value=result.document;excerpts.value=result.excerpts;offset.value=next;}catch(e){if(bot===props.botId)error.value=String(e);}}
async function retire(doc:DocumentSummary){error.value='';try{await app.retireDocument(props.botId,doc.id);if(selected.value?.id===doc.id){selected.value=null;excerpts.value=[];}await load();status.value='Document retired.';}catch(e){error.value=String(e);}}
async function download(doc:DocumentSummary){try{await app.downloadDocument(props.botId,doc.id,doc.name);}catch(e){error.value=String(e);}}
</script>
<template>
  <div class="settings-scroll"><section class="setup settings-content">
    <h1 class="page-title">Documents</h1>
    <p class="page-intro">Import a text file or text-based PDF for this agent. Search returns original passages, not summaries.</p>
    <form @submit.prevent="upload"><label for="document-file">Choose a document (.txt, .md, .csv, .pdf; up to 10 MiB)</label><input id="document-file" ref="fileInput" type="file" :disabled="busy" accept=".txt,.md,.csv,.pdf" @change="choose"><button :disabled="!file || busy">{{ busy ? 'Importing…' : 'Import document' }}</button></form>
    <p v-if="status" role="status">{{ status }}</p><p v-if="error" role="alert">{{ error }}</p>
    <form @submit.prevent="search"><label for="document-search">Search documents</label><input id="document-search" v-model="query" maxlength="200"><button :disabled="!query.trim()">Search</button></form>
    <h2>Library</h2><p v-if="!documents.length">No documents imported.</p>
    <nav class="row" aria-label="Document library pages"><button class="quiet" :disabled="libraryOffset===0" @click="load(Math.max(0,libraryOffset-500))">Previous documents</button><button class="quiet" :disabled="documents.length !== 500" @click="load(libraryOffset+500)">Next documents</button></nav>
    <ul class="memory-list"><li v-for="doc in documents" :key="doc.id" class="memory-entry"><strong>{{ doc.name }}</strong><span v-if="doc.retired"> — Retired</span><div class="row"><button class="quiet" @click="inspect(doc)">Inspect</button><button class="quiet" @click="download(doc)">Download original</button><button v-if="!doc.retired" class="quiet" @click="retire(doc)">Retire</button></div></li></ul>
    <h2>{{ selected ? selected.name : 'Passages' }}</h2><p v-if="selected" class="meta">SHA-256: {{ selected.digest }}</p><p v-if="!excerpts.length">No passages to show.</p>
    <nav v-if="selected" class="row" aria-label="Document passages"><button class="quiet" :disabled="offset===0" @click="inspect(selected,Math.max(0,offset-50))">Previous passages</button><button class="quiet" :disabled="excerpts.length !== 50" @click="inspect(selected,offset+50)">Next passages</button></nav>
    <ul class="memory-list"><li v-for="excerpt in excerpts" :key="excerpt.documentId + ':' + excerpt.excerptId" class="memory-entry"><p class="meta">{{ excerpt.name }} · {{ excerpt.page ? `Page ${excerpt.page}` : `Line ${excerpt.line}` }} · SHA-256 {{ excerpt.digest }}</p><p class="memory-text">{{ excerpt.text }}</p><button v-if="!selected?.retired" class="quiet" @click="emit('reference',{kind:'document-excerpt',documentId:excerpt.documentId,excerptId:excerpt.excerptId})">Select passage</button></li></ul>
  </section></div>
</template>
