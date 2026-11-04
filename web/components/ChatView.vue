<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useWorkspace } from '../workspace';
import ResponseText from './ResponseText.vue';
import ChatWorkItems from './ChatWorkItems.vue';
import SubmissionStatus from './SubmissionStatus.vue';
import ChatComposer from './ChatComposer.vue';
import BrandMark from './BrandMark.vue';
import SessionHistory from './SessionHistory.vue';
import DocumentsView from './DocumentsView.vue';
import ArtifactsView from './ArtifactsView.vue';
import WorkspaceToolbar from './WorkspaceToolbar.vue';
import ReferenceSelection from './ReferenceSelection.vue';
import SourcePreview from './SourcePreview.vue';
import type {WorkspaceReference, ResolvedReference} from '../../src/workspace-reference-types';
import type {Message} from '../controller';
const emit = defineEmits<{create: []; providers: []; settings: [id: string]}>();
const { app, state: s } = useWorkspace();
const pane=ref<'chat'|'documents'|'artifacts'>('chat');
const historyView=ref<InstanceType<typeof SessionHistory>|null>(null);
const documentsView=ref<InstanceType<typeof DocumentsView>|null>(null);
const artifactsView=ref<InstanceType<typeof ArtifactsView>|null>(null);
const sourcePreview=ref<ResolvedReference|null>(null);
let sourceRequest=0;
async function history(){pane.value='chat';await nextTick();historyView.value?.openPanel();}
async function selectSource(reference:WorkspaceReference){try{await app.addReference(reference);pane.value='chat';app.notify('Source added to your next message.');}catch(error){app.notify(String(error),'error');}}
async function inspectSource(reference:WorkspaceReference){const botId=s.value.selected,current=++sourceRequest;if(!botId)return;try{const source=await app.inspectReference(botId,reference);if(current===sourceRequest&&s.value.selected===botId)sourcePreview.value=source;}catch(error){if(current===sourceRequest)app.notify(String(error),'error');}}
async function openOriginal(reference:WorkspaceReference){sourcePreview.value=null;try{if(reference.kind==='session-message'){pane.value='chat';await nextTick();await historyView.value?.openSource(reference.sessionId);}else if(reference.kind==='document-excerpt'){pane.value='documents';await nextTick();await documentsView.value?.openSource(reference.documentId,reference.excerptId);}else{pane.value='artifacts';await nextTick();if(!await artifactsView.value?.openSource(reference.artifactId,reference.revision))app.notify('Finish or cancel the open artifact draft first.');}}catch(error){app.notify(String(error),'error');}}
async function saveArtifact(message:Message){const botId=s.value.selected,sessionId=s.value.sessionId;if(!botId||!sessionId)return;pane.value='artifacts';await nextTick();if(s.value.selected!==botId||s.value.sessionId!==sessionId)return;if(!artifactsView.value?.prefill(message.content,{sessionId,messageId:message.id}))app.notify('Finish or cancel the open artifact draft first.');}
function messageSources(message:Message,index:number){const user=message.role==='user'?message:[...s.value.messages.slice(0,index)].reverse().find(item=>item.role==='user');if(!user)return [];return s.value.work.find(work=>user.id==='command-user-'+work.id)?.references??(submission.value&&user.id==='command-user-'+submission.value.id?submission.value.references??[]:[]);}
const selected = computed(() => s.value.bots.find(agent => agent.id === s.value.selected));
const relevant = computed(() => s.value.inbox.filter(item => item.botId === s.value.selected));
const submission = computed(() => s.value.draft.submission);
const unmatched = computed(() => s.value.work.filter(work => !s.value.messages.some(message => message.id === 'command-user-' + work.id) && (work.events.length || relevant.value.some(item => item.kind === 'approval' && item.work.id === work.id))));
const messages = ref<HTMLDivElement | null>(null);
let followBottom = true;
watch(() => s.value.selected, () => { followBottom = true; pane.value='chat';sourceRequest++;sourcePreview.value=null; });
watch([messages, () => s.value.selected, () => s.value.messages, () => s.value.work, () => s.value.inbox, () => s.value.response?.text, () => s.value.response?.state, () => submission.value?.id, () => submission.value?.kind], () => {
  if (messages.value && followBottom) messages.value.scrollTop = messages.value.scrollHeight;
}, {flush: 'post'});
function scroll(event: Event) {
  if (event.currentTarget instanceof HTMLElement) {
    const node = event.currentTarget;
    followBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
  }
}
</script>

<template>
  <div class="workspace"><div class="chat">
    <WorkspaceToolbar v-if="selected" @history="history" @documents="pane='documents'" @artifacts="pane='artifacts'" />
    <div v-show="pane==='chat'" ref="messages" class="messages" @scroll="scroll">
      <template v-if="selected">
        <template v-if="s.messages.length">
          <div v-for="(message,index) in s.messages" :key="message.id" class="message" :class="{'user-message': message.role === 'user'}">
            <div v-if="message.role === 'user'" class="user-bubble"><div class="who">YOU</div><div class="bubble">{{ message.content }}</div></div>
            <template v-else><div class="who"><span class="avatar">{{ selected.name[0]?.toUpperCase() }}</span>{{ selected.name }}{{ message.role === 'assistant_stopped' ? ' · stopped' : '' }}</div><ResponseText :text="message.content" /></template>
            <button v-if="message.role==='assistant'" class="quiet save-artifact" @click="saveArtifact(message)">Save artifact</button>
            <details v-if="messageSources(message,index).length" class="message-sources"><summary>Selected sources</summary><button v-for="source in messageSources(message,index)" :key="JSON.stringify(source.reference)" class="quiet" @click="inspectSource(source.reference)">{{ source.title }} · {{ source.location }}</button></details>
            <SubmissionStatus v-if="submission && message.id === 'command-user-' + submission.id" />
            <ChatWorkItems v-if="message.role === 'user'" :work="s.work.find(work => message.id === 'command-user-' + work.id)" :inbox="relevant" />
          </div>
        </template>
        <div v-else class="empty empty-state"><div class="logo-large"><BrandMark /></div><h2>Message {{ selected.name }}</h2><p>Send a message to start the conversation.</p></div>
        <div v-for="work in unmatched" :key="'unmatched-' + work.id" class="message">
          <div class="who">{{ selected.name.toUpperCase() }} · request {{ work.id }}</div><ChatWorkItems :work="work" :inbox="relevant" />
        </div>
        <div v-if="submission && !s.messages.some(message => message.id === 'command-user-' + submission?.id)" class="message user-message">
          <div class="user-bubble"><div class="who">YOU</div><div class="bubble">{{ submission.text }}</div></div><SubmissionStatus />
        </div>
        <div v-if="s.responseConnection === 'reconnecting'" class="message meta">Live response updates disconnected. Reconnecting…</div>
        <div v-if="s.response && !['completed', 'stopped'].includes(s.response.state)" class="message provisional">
          <div class="who">{{ selected.name.toUpperCase() }} · {{ s.response.state }}</div>
          <ResponseText v-if="s.response.text" :text="s.response.text" />
          <div class="meta">{{ s.response.state === 'failed' || s.response.state === 'interrupted' ? 'Response did not complete. ' : 'Response in progress. ' }}{{ s.response.error }}</div>
        </div>
        <div v-if="selected.provider === 'codex' && s.credential === 'signed-out'" class="provider">
          <strong>Connect ChatGPT to chat</strong><p>Provider connections are shared by this Staf instance.</p><button class="quiet" @click="emit('providers')">Open provider settings</button>
        </div>
        <div v-if="selected.provider === 'openrouter' && s.openrouter === 'missing'" class="provider">
          <strong>Connect OpenRouter to chat</strong><p>Provider connections are shared by this Staf instance.</p><button class="quiet" @click="emit('providers')">Open provider settings</button>
        </div>
      </template>
      <div v-else class="empty"><strong>Let's set up your first agent.</strong><p>Create an agent now, even if your provider is not connected.</p><button @click="emit('create')">Create an agent</button></div>
    </div>
    <SessionHistory v-if="selected" v-show="pane==='chat'" ref="historyView" :key="selected.id" :bot-id="selected.id" @reference="selectSource" />
    <ReferenceSelection v-if="selected && pane==='chat'" :sources="s.draft.references??[]" @remove="index=>app.removeReference(index)" />
    <ChatComposer v-if="selected" v-show="pane==='chat'" @settings="id => emit('settings', id)" />
    <div v-if="pane!=='chat'" class="workspace-return"><button class="quiet" @click="pane='chat'">Back to chat</button></div>
    <KeepAlive><DocumentsView v-if="selected && pane==='documents'" ref="documentsView" :key="selected.id" :bot-id="selected.id" @reference="selectSource" /></KeepAlive>
    <KeepAlive><ArtifactsView v-if="selected && pane==='artifacts'" ref="artifactsView" :key="selected.id" :bot-id="selected.id" @reference="selectSource" @inspect="inspectSource" @back="pane='chat'" /></KeepAlive>
    <SourcePreview v-if="sourcePreview" :source="sourcePreview" @close="sourcePreview=null" @original="openOriginal" />
  </div></div>
</template>

<style scoped>
.workspace-return { padding: .5rem 1rem; }
.save-artifact { font-size: .75rem; margin-top: .5rem; }
.message-sources { font-size: .8rem; margin-top: .5rem; }
.message-sources button { display: block; text-align: left; font-size: .8rem; margin-top: .25rem; }
</style>
