<script setup lang="ts">
import { ref, watch } from 'vue';
import { useWorkspace } from '../workspace';
import type { Message } from '../controller';
const props=defineProps<{botId:string}>();
const emit=defineEmits<{reference:[value:{kind:'session-message';sessionId:string;messageId:string}]}>();
const {app}=useWorkspace();
const sessions=ref<Array<{id:string;name:string;createdAt:number;active:number}>>([]);
const sessionMore=ref(false);
const current=ref(''), selected=ref(''), messages=ref<Message[]>([]), query=ref(''), name=ref(''), error=ref(''), loading=ref(false), more=ref(false);
const selectedReference=ref('');
const results=ref<Array<{sessionId:string;messageId:string;role:string;content:string}>>([]);
async function refresh(append=false){try{const data=await app.sessionList(props.botId,append?sessions.value.length:0);current.value=data.current.id;sessions.value=append?[...sessions.value,...data.sessions]:data.sessions;sessionMore.value=data.sessions.length===100;error.value='';}catch(e){error.value=String(e)}}
async function open(id:string,append=false){try{const page=await app.sessionRead(props.botId,id,append?messages.value.length:0);selected.value=id;messages.value=append?[...messages.value,...page.messages]:page.messages;more.value=page.messages.length===100;error.value='';}catch(e){error.value=String(e)}}
async function search(){try{results.value=await app.sessionSearch(props.botId,query.value);error.value='';}catch(e){error.value=String(e)}}
async function create(){loading.value=true;try{await app.startSession(props.botId,name.value);name.value='';selected.value='';messages.value=[];await refresh();}catch(e){error.value='Session creation: '+String(e)+' If the result is uncertain, retry the same operation.'}finally{loading.value=false}}
function reference(sessionId:string,messageId:string){const value={kind:'session-message' as const,sessionId,messageId};selectedReference.value=JSON.stringify(value);emit('reference',value);void navigator.clipboard?.writeText(selectedReference.value).catch(()=>{});}
watch(()=>props.botId,()=>{sessions.value=[];selected.value='';messages.value=[];results.value=[];void refresh()},{immediate:true});
</script>
<template>
  <details class="session-history" @toggle="refresh()">
    <summary>Session history</summary>
    <section aria-label="Session history">
      <p>Start a fresh conversation or inspect original messages. Reading history does not change the active session.</p>
      <form @submit.prevent="create"><label>Session name <input v-model="name" maxlength="100" placeholder="New session"></label> <button :disabled="loading">Start fresh session</button></form>
      <form @submit.prevent="search"><label>Search history <input v-model="query" maxlength="200" required></label> <button>Search</button></form>
      <p v-if="error" role="alert">{{ error }}</p><p v-if="selectedReference">Selected reference (copied when clipboard access is available): <code>{{ selectedReference }}</code></p>
      <ul v-if="results.length"><li v-for="result in results" :key="result.messageId"><button @click="open(result.sessionId)">Open {{ result.role }} message</button> {{ result.content }} <button @click="reference(result.sessionId,result.messageId)">Select reference</button></li></ul>
      <ul><li v-for="session in sessions" :key="session.id"><button @click="open(session.id)">{{ session.name }}</button> <span v-if="session.id===current">(current)</span></li></ul>
      <button v-if="sessionMore" @click="refresh(true)">Load more sessions</button>
      <div v-if="selected"><h3>Original messages</h3><p v-if="!messages.length">No messages in this session.</p><article v-for="message in messages" :key="message.id"><strong>{{ message.role }}</strong><p style="white-space:pre-wrap;overflow-wrap:anywhere">{{ message.content }}</p><button @click="reference(selected,message.id)">Select reference</button></article><button v-if="more" @click="open(selected,true)">Load more messages</button></div>
    </section>
  </details>
</template>
<style scoped>
.session-history { padding: 0.4rem 1rem; max-height: 45vh; overflow: auto; border-top: 1px solid var(--border, #ddd); }
.session-history summary { cursor: pointer; }
.session-history form { margin: 0.6rem 0; }
.session-history ul { padding-left: 1.3rem; }
.session-history article { margin: 0.8rem 0; }
</style>
