<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspace } from '../workspace';
const props = defineProps<{agent: {id: string; name: string}}>();
const { state } = useWorkspace();
const duplicate = computed(() => state.value.bots.filter(other => other.name === props.agent.name).length > 1);
</script>

<template>
  {{ agent.name }}<span v-if="duplicate" class="agent-id"> · {{ agent.id.slice(-4) }}</span>
</template>
