<script setup lang="ts">
import { useWorkspace } from '../workspace';
import AgentLabel from './AgentLabel.vue';
import UiIcon from './UiIcon.vue';
import { providerLabel } from '../provider-label';
import ArchivedAgent from './ArchivedAgent.vue';
import BrandMark from './BrandMark.vue';
import PanelToggle from './PanelToggle.vue';
import { design } from '../design';
defineProps<{view: string; saving: boolean}>();
const emit = defineEmits<{create: []; select: [id: string]; settings: []; memory: [id: string]}>();
const { state: s } = useWorkspace();
function agentName(agent: {name: string; id: string}) {
  return agent.name + (s.value.bots.filter(other => other.name === agent.name).length > 1 ? ' · ' + agent.id.slice(-4) : '');
}
</script>

<template>
  <aside class="side" id="agent-sidebar">
    <div class="sidebar-head"><button class="brand" :disabled="saving" aria-label="Staf, return to chat" @click="s.selected && emit('select', s.selected)"><BrandMark /><span>staf</span></button><PanelToggle :disabled="saving" v-if="design.sidebar === 'expanded'" /></div>
    <div id="agents-label" class="caption">Agents</div>
    <button :disabled="saving" @click="emit('create')" class="new-agent" aria-label="New agent" title="New agent"><UiIcon name="plus" /><span>New agent</span></button>
    <nav aria-labelledby="agents-label">
      <button v-for="agent in s.bots.filter(b => !b.archived)" class="agent-nav" :key="agent.id" :disabled="saving" :title="agentName(agent)" :aria-label="agentName(agent)"
        :aria-current="agent.id === s.selected && view === 'chat' && s.setup.kind === 'closed' ? 'page' : undefined"
        :class="{active: agent.id === s.selected && view === 'chat' && s.setup.kind === 'closed'}" @click="emit('select', agent.id)">
        <span class="avatar">{{ agent.name[0]?.toUpperCase() }}</span><span class="identity"><strong><AgentLabel :agent="agent" /></strong><small>{{ providerLabel(agent.provider) }}</small></span> <span class="dots">{{ s.inbox.filter(i => i.botId === agent.id).length || '' }}</span>
      </button>
    </nav>
    <details v-if="s.bots.some(agent => agent.archived)" class="archived-agents">
      <summary>Archived agents</summary>
      <ArchivedAgent v-for="agent in s.bots.filter(b => b.archived)" :key="agent.id" :agent="agent" :saving="saving" @memory="emit('memory', agent.id)" />
    </details>
    <div class="minor"><button :disabled="saving" :class="{active: view === 'settings'}" @click="emit('settings')" aria-label="Settings" title="Settings"><UiIcon name="gear" /><span>Settings</span></button><div class="workspace-caption">Personal workspace</div></div>
  </aside>
</template>
