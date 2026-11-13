<script setup lang="ts">
import AgentImage from './AgentImage.vue';
import { computed, ref, watch } from 'vue';
import { useWorkspace } from '../workspace';
import ResponseText from './ResponseText.vue';
import ChatWorkItems from './ChatWorkItems.vue';
import SubmissionStatus from './SubmissionStatus.vue';
import ChatComposer from './ChatComposer.vue';
import BrandMark from './BrandMark.vue';
import TaskConversation from './TaskConversation.vue';
import QuestionSet from './QuestionSet.vue';
import { nextChatMessage, type ChatEvent, type ChatWork, type ConversationTask, type Message, type ResponseProgress } from '../controller';
const emit = defineEmits<{create: []; providers: []; settings: [id: string]}>();
const { state: s } = useWorkspace();
const selected = computed(() => s.value.bots.find(agent => agent.id === s.value.selected));
const relevant = computed(() => s.value.inbox.filter(item => item.botId === s.value.selected));
const submission = computed(() => s.value.draft.submission);
const unmatched = computed(() => s.value.work.filter(work => submission.value?.id !== work.id && !s.value.messages.some(message => message.id === 'command-user-' + work.id) && (work.events.length || relevant.value.some(item => item.kind === 'approval' && item.work.kind === 'command' && item.work.id === work.id))));
type Row = {kind:'task';key:string;task:ConversationTask} | {kind:'user';key:string;text:string;commandId:string|null} | {kind:'response';key:string;commandId:string|null;message:Message|null;work:ChatWork|undefined;progress:ResponseProgress|null;optimistic:boolean};
type ResponseRow=Extract<Row,{kind:'response'}>;
function responseWork(row:ResponseRow):ChatWork|undefined {
  return row.work ?? (row.progress?{id:row.progress.id,progress:row.progress,events:row.progress.events??[],processes:[],codeExecutions:[]}:undefined);
}
function responseParts(row:ResponseRow) {
  const parts:Array<{key:string;events:ChatEvent[];text:string;live:boolean}>=[];
  let key='start',events:ChatEvent[]=[];
  const streamed=row.progress?.events,stored=row.work?.events??[];
  const streamCurrent=streamed && (streamed.at(-1)?.id??0)>=(stored.at(-1)?.id??0);
  const ordered=streamCurrent?streamed:stored;
  for(const event of ordered) {
    if(event.type==='assistant_message') {
      parts.push({key,events,text:event.detail??'',live:false});key='after-'+event.id;events=[];
    } else events.push(event);
  }
  const progress=streamCurrent?row.progress:row.work?.progress??row.progress;
  parts.push({key,events,text:row.message?.content??progress?.text??'',live:true});
  return parts;
}
const timeline = computed(() => {
  const rows: Row[] = [];
  const items=s.value.messages;
  const consumed=new Set<number>();
  for (let i=0;i<items.length;i++) {
    const message=items[i];if(!message || consumed.has(i))continue;
    if(message.role==='task') {const task=s.value.tasks.find(item=>item.id===message.taskAttemptId);if(task)rows.push({kind:'task',key:'task-'+task.id,task});continue;}
    if(message.role!=='user') {rows.push({kind:'response',key:'message-'+message.id,commandId:null,message,work:undefined,progress:null,optimistic:false});continue;}
    const id=message.id.startsWith('command-user-') ? message.id.slice('command-user-'.length) : null;
    rows.push({kind:'user',key:'user-'+message.id,text:message.content,commandId:id});
    if(!id)continue;
    const work=s.value.work.find(item=>item.id===id);
    const next=nextChatMessage(items,i);
    const answer=next && ['assistant','assistant_stopped'].includes(next.role) && (work?.progress.state==='completed'||work?.progress.state==='stopped') ? next : null;
    if(answer)consumed.add(items.indexOf(answer));
    const progress=s.value.response?.id===id ? s.value.response : work?.progress ?? null;
    const optimistic=submission.value?.id===id && ['submitting','submitting-uncertain','pending','unknown'].includes(submission.value.kind);
    if(work||progress||answer||optimistic)rows.push({kind:'response',key:'response-'+id,commandId:id,message:answer,work,progress,optimistic});
  }
  for(const task of s.value.tasks.filter(item=>!item.anchorMessageId))rows.push({kind:'task',key:'task-'+task.id,task});
  const current=submission.value;
  if(current && !items.some(message=>message.id==='command-user-'+current.id)) {
    rows.push({kind:'user',key:'user-command-user-'+current.id,text:current.text,commandId:current.id});
    const work=s.value.work.find(item=>item.id===current.id);
    const progress=s.value.response?.id===current.id?s.value.response:work?.progress ?? null;
    if(work||progress||['submitting','submitting-uncertain','pending','unknown'].includes(current.kind))rows.push({kind:'response',key:'response-'+current.id,commandId:current.id,message:null,work,progress,optimistic:true});
  }
  return rows;
});
const messages = ref<HTMLDivElement | null>(null);
let followBottom = true;
watch(() => s.value.selected, () => { followBottom = true; });
watch([messages, () => s.value.selected, () => s.value.messages, () => s.value.work, () => s.value.tasks, () => s.value.inbox, () => s.value.response?.text, () => s.value.response?.state, () => submission.value?.id, () => submission.value?.kind], () => {
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
    <div ref="messages" class="messages" @scroll="scroll">
      <template v-if="selected">
        <template v-if="timeline.length">
          <div v-for="row in timeline" :key="row.key" class="message" :class="{'user-message': row.kind === 'user', provisional: row.kind === 'response' && !!row.progress && ['accepted','running','stopping'].includes(row.progress.state)}">
            <TaskConversation v-if="row.kind === 'task'" :task="row.task" :inbox="relevant" />
            <template v-else-if="row.kind === 'user'"><div class="user-bubble"><div class="bubble">{{ row.text }}</div></div><SubmissionStatus v-if="submission && row.commandId === submission.id" /></template>
            <template v-else>
              <div v-for="part in responseParts(row)" :key="part.key" class="response-part">
                <ChatWorkItems :work="responseWork(row)" :inbox="relevant" :events="part.events" :controls="part.live" />
                <div class="who"><AgentImage :image="selected.image" :name="selected.name" />{{ selected.name }}{{ part.live && (row.message?.role === 'assistant_stopped' || row.progress?.state === 'stopped') ? ' · stopped' : '' }}<span v-if="part.live && ((!row.progress && row.optimistic) || (row.progress && ['accepted','running','stopping'].includes(row.progress.state)))" class="working-indicator" role="status" aria-label="Response in progress" /></div>
                <ResponseText v-if="part.text" :text="part.text" />
              </div>
              <QuestionSet v-for="request in s.questionSets.filter(item => item.workKind === 'command' && item.workId === row.commandId)" :key="request.id" :request="request" />
              <div v-if="row.progress && ['failed','interrupted'].includes(row.progress.state)" class="meta">Response {{ row.progress.state }}. {{ row.progress.error }}</div>
            </template>
          </div>
        </template>
        <div v-else class="empty empty-state"><div class="logo-large"><BrandMark /></div><h2>Message {{ selected.name }}</h2><p>Send a message to start the conversation.</p></div>
        <div v-for="work in unmatched" :key="'unmatched-' + work.id" class="message">
          <ChatWorkItems :work="work" :inbox="relevant" /><div class="who">{{ selected.name }} · request {{ work.id }}</div>
        </div>
        <div v-if="s.responseConnection === 'reconnecting'" class="message meta">Live response updates disconnected. Reconnecting…</div>
        <div v-if="selected.provider === 'codex' && s.credential === 'signed-out'" class="provider">
          <strong>Connect ChatGPT to chat</strong><p>Provider connections are shared by this Staf instance.</p><button class="quiet" @click="emit('providers')">Open provider settings</button>
        </div>
        <div v-if="selected.provider === 'openrouter' && s.openrouter === 'missing'" class="provider">
          <strong>Connect OpenRouter to chat</strong><p>Provider connections are shared by this Staf instance.</p><button class="quiet" @click="emit('providers')">Open provider settings</button>
        </div>
      </template>
      <div v-else class="empty"><strong>Let's set up your first agent.</strong><p>Create an agent now, even if your provider is not connected.</p><button @click="emit('create')">Create an agent</button></div>
    </div>
    <ChatComposer v-if="selected" @settings="id => emit('settings', id)" />
  </div></div>
</template>
