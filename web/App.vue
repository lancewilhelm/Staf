<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { provideWorkspace } from './workspace';
import { readAppearance, applyAppearance } from './appearance';
import AgentSidebar from './components/AgentSidebar.vue';
import AgentLabel from './components/AgentLabel.vue';
import AgentSettings from './components/AgentSettings.vue';
import SettingsView from './components/SettingsView.vue';
import NewAgent from './components/NewAgent.vue';
import ChatView from './components/ChatView.vue';
import Toasts from './components/Toasts.vue';

const {app, state: s} = provideWorkspace();
type View = 'chat' | 'settings' | 'agent';
const view = ref<View>('chat');
const code = ref('');
const appearance = ref(readAppearance());
applyAppearance(appearance.value);
const settingsAgentId = ref<string | null>(null);
const agentSaving = ref(false);
const selected = computed(() => s.value.bots.find(agent => agent.id === s.value.selected));
let firstRun = false;
watch([() => s.value.connection.kind, () => s.value.bots.length, () => s.value.credential], () => {
  if (!firstRun && s.value.connection.kind === 'ready') {
    firstRun = true;
    if (!s.value.bots.length && s.value.credential === 'signed-out') view.value = 'settings';
  }
});
watch(() => s.value.draft.submission && 'error' in s.value.draft.submission ? s.value.draft.submission.error : null, error => {
  if (error) app.notify(error, 'error', 'submission');
});
watch(() => s.value.connection.kind, () => {
  if (s.value.connection.kind === 'offline') app.notify(s.value.connection.message, 'error', 'connection');
  else if (s.value.connection.kind === 'ready') {
    for (const notice of app.state.notices) if (notice.topic === 'connection') app.dismissNotice(notice.id);
  }
});
function createAgent() { settingsAgentId.value = null; view.value = 'chat'; app.openSetup(); }
function openSettings() { app.closeSetup(); view.value = 'settings'; }
function closeAgentSettings() { settingsAgentId.value = null; view.value = 'chat'; }
function openAgentSettings(id: string) { settingsAgentId.value = id; view.value = 'agent'; }
function openChat(id: string) { settingsAgentId.value = null; app.closeSetup(); view.value = 'chat'; void app.select(id); }
</script>

<template>
  <div class="shell">
    <AgentSidebar :view="view" :saving="agentSaving" @create="createAgent" @select="openChat" @settings="openSettings" />
    <main class="main">
      <header class="top">
        <button v-if="selected && view === 'chat' && s.setup.kind === 'closed'" class="avatar" aria-label="Open agent settings" title="Open agent settings" :disabled="agentSaving" @click="openAgentSettings(selected.id)">{{ selected.name[0]?.toUpperCase() || '✳' }}</button>
        <div v-else class="avatar">{{ selected?.name[0]?.toUpperCase() || '✳' }}</div>
        <div>
          <div class="title"><template v-if="view === 'settings'">Settings</template><AgentLabel v-else-if="selected" :agent="selected" /><template v-else>Welcome to Staf</template></div>
          <div class="sub">{{ s.connection.kind === 'ready' ? view === 'settings' ? 'Provider connections' : view === 'agent' ? 'Agent settings' : 'Your ongoing conversation' : s.connection.kind }}</div>
        </div>
        <div class="spacer" />
      </header>
      <Toasts />
      <div v-if="s.connection.kind === 'offline'" class="connection-recovery" role="alert">{{ s.connection.message }} {{ s.freshness }}</div>
      <div v-if="settingsAgentId" :style="{display: view === 'agent' ? 'contents' : 'none'}">
        <AgentSettings :key="settingsAgentId" :id="settingsAgentId" v-model:saving="agentSaving" @providers="openSettings" @close="closeAgentSettings" />
      </div>
      <template v-if="!(view === 'agent' && settingsAgentId)">
        <div v-if="s.connection.kind === 'pairing'" class="setup">
          <span class="eyebrow">WELCOME TO STAF</span><h2>Pair this browser</h2><p>Enter the one-time code shown on the host.</p>
          <label>Pairing code<input v-model="code" /></label><button @click="app.pair(code)">Pair</button><p role="alert">{{ s.connection.message }}</p>
        </div>
        <NewAgent v-else-if="s.setup.kind === 'create'" />
        <SettingsView v-else-if="view === 'settings'" v-model:appearance="appearance" :has-agent-settings="!!settingsAgentId" @agent-settings="view = 'agent'" @chat="closeAgentSettings" />
        <ChatView v-else @create="createAgent" @providers="openSettings" @settings="openAgentSettings" />
      </template>
    </main>
  </div>
</template>
