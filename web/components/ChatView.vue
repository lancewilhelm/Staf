<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkspace } from '../workspace';
import ResponseText from './ResponseText.vue';
import ChatWorkItems from './ChatWorkItems.vue';
import SubmissionStatus from './SubmissionStatus.vue';
import ChatComposer from './ChatComposer.vue';
import BrandMark from './BrandMark.vue';
const emit = defineEmits<{create: []; providers: []; settings: [id: string]}>();
const { state: s } = useWorkspace();
const selected = computed(() => s.value.bots.find(agent => agent.id === s.value.selected));
const relevant = computed(() => s.value.inbox.filter(item => item.botId === s.value.selected));
const submission = computed(() => s.value.draft.submission);
const unmatched = computed(() => s.value.work.filter(work => !s.value.messages.some(message => message.id === 'command-user-' + work.id) && (work.events.length || relevant.value.some(item => item.kind === 'approval' && item.work.id === work.id))));
const messages = ref<HTMLDivElement | null>(null);
let followBottom = true;
watch(() => s.value.selected, () => { followBottom = true; });
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
    <div ref="messages" class="messages" @scroll="scroll">
      <template v-if="selected">
        <template v-if="s.messages.length">
          <div v-for="message in s.messages" :key="message.id" class="message" :class="{'user-message': message.role === 'user'}">
            <div v-if="message.role === 'user'" class="user-bubble"><div class="who">YOU</div><div class="bubble">{{ message.content }}</div></div>
            <template v-else><div class="who"><span class="avatar">{{ selected.name[0]?.toUpperCase() }}</span>{{ selected.name }}{{ message.role === 'assistant_stopped' ? ' · stopped' : '' }}</div><ResponseText :text="message.content" /></template>
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
    <ChatComposer v-if="selected" @settings="id => emit('settings', id)" />
  </div></div>
</template>
