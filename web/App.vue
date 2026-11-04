<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { provideWorkspace } from './workspace';
import { readAppearance, applyAppearance } from './appearance';
import AgentSidebar from './components/AgentSidebar.vue';
import AgentLabel from './components/AgentLabel.vue';
import AgentSettings from './components/AgentSettings.vue';
import SettingsView from './components/SettingsView.vue';
import NewAgent from './components/NewAgent.vue';
import ChatView from './components/ChatView.vue';
import Toasts from './components/Toasts.vue';
import PanelToggle from './components/PanelToggle.vue';
import BrandMark from './components/BrandMark.vue';
import MemoryView from './components/MemoryView.vue';
import { design } from './design';

const {app, state: s} = provideWorkspace();
type View = 'chat' | 'settings' | 'agent' | 'agent-memory' | 'user-memory';
const view = ref<View>('chat');
const code = ref('');
const routerForm = reactive({key: '', status: '', busy: false});
const appearance = ref(readAppearance());
applyAppearance(appearance.value);
const settingsAgentId = ref<string | null>(null);
const memoryAgentId = ref<string | null>(null);
const sharedReturn = ref<'settings' | 'agent-memory'>('settings');
const agentSaving = ref(false);
const selected = computed(() => s.value.bots.find(agent => agent.id === s.value.selected));
const headerAgent = computed(() => s.value.bots.find(agent => agent.id === (view.value === 'agent-memory' ? memoryAgentId.value : view.value === 'agent' ? settingsAgentId.value : s.value.selected)));
let firstRun = false;
watch([() => s.value.connection.kind, () => s.value.bots.length, () => s.value.credential], () => {
  if (!firstRun && s.value.connection.kind === 'ready') {
    firstRun = true;
    if (!s.value.bots.length && s.value.credential === 'signed-out' && s.value.setup.kind === 'closed') view.value = 'settings';
  }
});
watch(() => s.value.draft.submission && 'error' in s.value.draft.submission ? s.value.draft.submission.error : null, error => {
  if (error) app.notify(error, 'error', 'submission');
});
watch(() => s.value.connection.kind, () => {
  if (s.value.connection.kind === 'pairing') {
    settingsAgentId.value = null;
    memoryAgentId.value = null;
    view.value = 'chat';
  }
  if (s.value.connection.kind === 'offline') app.notify(s.value.connection.message, 'error', 'connection');
  else if (s.value.connection.kind === 'ready') {
    for (const notice of app.state.notices) if (notice.topic === 'connection') app.dismissNotice(notice.id);
  }
});
function createAgent() { settingsAgentId.value = null; view.value = 'chat'; app.openSetup(); }
function openSettings() { app.closeSetup(); view.value = 'settings'; }
function closeAgentSettings() { settingsAgentId.value = null; view.value = 'chat'; }
function openAgentSettings(id: string) { settingsAgentId.value = id; view.value = 'agent'; }
function openAgentMemory(id: string) { memoryAgentId.value = id; view.value = 'agent-memory'; }
function openUserMemory() { sharedReturn.value = view.value === 'agent-memory' ? 'agent-memory' : 'settings'; view.value = 'user-memory'; }
async function closeAgentMemory() {
  view.value = settingsAgentId.value === memoryAgentId.value ? 'agent' : 'chat';
  await nextTick();
  document.querySelector<HTMLElement>(view.value === 'agent' ? '.agent-memory-link' : '.archived-agents summary')?.focus();
}
async function closeUserMemory() {
  view.value = sharedReturn.value;
  await nextTick();
  document.querySelector<HTMLElement>(view.value === 'agent-memory' ? '.shared-memory-link' : '.user-memory-link')?.focus();
}
function openChat(id: string) { settingsAgentId.value = null; app.closeSetup(); view.value = 'chat'; void app.select(id); }
</script>

<template>
  <div class="shell" :data-sidebar="design.sidebar">
    <AgentSidebar :view="view" :saving="agentSaving" @create="createAgent" @select="openChat" @settings="openSettings" @memory="openAgentMemory" />
    <main class="main">
      <header class="top">
        <PanelToggle :disabled="agentSaving" v-if="design.sidebar === 'focus'" />
        <button v-if="selected && view === 'chat' && s.setup.kind === 'closed'" class="avatar" aria-label="Open agent settings" title="Open agent settings" :disabled="agentSaving" @click="openAgentSettings(selected.id)">{{ selected.name[0]?.toUpperCase() || '✳' }}</button>
        <div v-else class="avatar"><template v-if="headerAgent && view !== 'user-memory'">{{ headerAgent.name[0]?.toUpperCase() }}</template><BrandMark v-else /></div>
        <div>
          <div class="title"><template v-if="view === 'settings'">Settings</template><template v-else-if="view === 'user-memory'">User memory</template><AgentLabel v-else-if="headerAgent" :agent="headerAgent" /><template v-else>Welcome to Staf</template></div>
        </div>
        <div class="spacer" />
        <button v-if="selected && view === 'chat'" class="header-action" aria-label="Agent settings" :disabled="agentSaving" @click="openAgentSettings(selected.id)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <button v-else-if="view !== 'chat'" class="header-action" :disabled="agentSaving" aria-label="Back to chat" @click="closeAgentSettings"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
      </header>
      <Toasts />
      <details v-if="s.connection.kind === 'ready' && s.legacyRecords.length" class="connection-recovery">
        <summary>Earlier browser records</summary>
        <p>These saved records have no dataset identity. Their origin cannot be verified; copy any needed text or operation details before continuing. They will not be submitted automatically.</p>
        <div v-for="record in s.legacyRecords" :key="record.key"><p>{{ record.key }}</p><pre style="white-space: pre-wrap; overflow-wrap: anywhere">{{ record.value }}</pre></div>
      </details>
      <div v-if="s.connection.kind === 'offline'" class="connection-recovery" role="alert">{{ s.connection.message }} {{ s.freshness }}</div>
      <div v-if="settingsAgentId && s.connection.kind !== 'pairing'" :style="{display: view === 'agent' ? 'contents' : 'none'}">
        <AgentSettings :key="settingsAgentId" :id="settingsAgentId" v-model:saving="agentSaving" @providers="openSettings" @memory="openAgentMemory(settingsAgentId)" @close="closeAgentSettings" />
      </div>
      <div v-if="s.connection.kind !== 'pairing' && (view === 'settings' || view === 'user-memory' && sharedReturn === 'settings')" :style="{display: view === 'settings' ? 'contents' : 'none'}">
        <SettingsView v-model:appearance="appearance" :router-form="routerForm" :has-agent-settings="!!settingsAgentId" @agent-settings="view = 'agent'" @chat="closeAgentSettings" @memory="openUserMemory" />
      </div>
      <template v-if="s.connection.kind === 'pairing' || !(view === 'agent' && settingsAgentId)">
        <div v-if="s.connection.kind === 'pairing'" class="setup">
          <span class="eyebrow">WELCOME TO STAF</span><h2>Pair this browser</h2><p>Enter the one-time code shown on the host.</p>
          <label>Pairing code<input v-model="code" /></label><button @click="app.pair(code)">Pair</button><p role="alert">{{ s.connection.message }}</p>
        </div>
        <MemoryView v-else-if="view === 'agent-memory' && memoryAgentId" :key="memoryAgentId" :scope="{kind: 'bot', botId: memoryAgentId}" :back-label="settingsAgentId === memoryAgentId ? 'Back to agent settings' : 'Back to chat'" @back="closeAgentMemory" @shared="openUserMemory" />
        <MemoryView v-else-if="view === 'user-memory'" key="user-memory" :scope="{kind: 'user'}" :back-label="sharedReturn === 'agent-memory' ? 'Back to agent memory' : 'Back to settings'" @back="closeUserMemory" />
        <ChatView v-else-if="view === 'chat'" @create="createAgent" @providers="openSettings" @settings="openAgentSettings" />
      </template>
    </main>
    <NewAgent v-if="s.setup.kind === 'create'" />
  </div>
</template>
