<script setup lang="ts">
import { useWorkspace } from '../workspace';
import AgentLabel from './AgentLabel.vue';
import ArchivedAgent from './ArchivedAgent.vue';
defineProps<{view: string; saving: boolean}>();
const emit = defineEmits<{create: []; select: [id: string]; settings: []}>();
const { state: s } = useWorkspace();
</script>

<template>
  <aside class="side">
    <div class="brand">✳ <span>STAF</span></div>
    <div id="agents-label" class="caption">Agents</div>
    <button :disabled="saving" @click="emit('create')">＋ &nbsp; New agent</button>
    <nav aria-labelledby="agents-label">
      <button v-for="agent in s.bots.filter(b => !b.archived)" :key="agent.id" :disabled="saving"
        :aria-current="agent.id === s.selected && view === 'chat' && s.setup.kind === 'closed' ? 'page' : undefined"
        :class="{active: agent.id === s.selected && view === 'chat' && s.setup.kind === 'closed'}" @click="emit('select', agent.id)">
        ◉ &nbsp; <AgentLabel :agent="agent" /> <span class="dots">{{ s.inbox.filter(i => i.botId === agent.id).length || '' }}</span>
      </button>
    </nav>
    <details v-if="s.bots.some(agent => agent.archived)" class="archived-agents">
      <summary>Archived agents</summary>
      <ArchivedAgent v-for="agent in s.bots.filter(b => b.archived)" :key="agent.id" :agent="agent" />
    </details>
    <div class="minor"><button :disabled="saving" :class="{active: view === 'settings'}" @click="emit('settings')">⚙ &nbsp; Settings</button></div>
  </aside>
</template>
