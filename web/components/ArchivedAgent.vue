<script setup lang="ts">
import { ref } from 'vue';
import { useWorkspace } from '../workspace';
import AgentLabel from './AgentLabel.vue';
const props = defineProps<{agent: {id: string; name: string}}>();
const { app } = useWorkspace();
const busy = ref(false);
const status = ref('');
async function restore() {
  busy.value = true;
  status.value = '';
  try {
    const profile = await app.botProfile(props.agent.id);
    await app.setArchived(profile, false);
  } catch (error) {
    status.value = 'Could not restore the agent, or the result is uncertain. Refresh and try again. ' + String(error);
    await app.refresh();
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="provider">
    <strong><AgentLabel :agent="agent" /></strong>
    <button :disabled="busy" :aria-label="`Restore agent ${agent.name}`" @click="restore">Restore agent</button>
    <p role="status">{{ status }}</p>
  </div>
</template>
