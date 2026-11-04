<script setup lang="ts">
defineProps<{sessionTitle?: string}>();
const emit = defineEmits<{history: []; documents: []; artifacts: []}>();
</script>

<template>
  <nav class="workspace-toolbar" aria-label="Conversation workspace">
    <span v-if="sessionTitle" class="workspace-session-title">{{ sessionTitle }}</span>
    <div class="workspace-toolbar-actions">
      <button class="quiet" @click="emit('history')">History</button>
      <button class="quiet" @click="emit('documents')">Documents</button>
      <button class="quiet" @click="emit('artifacts')">Artifacts</button>
    </div>
  </nav>
</template>

<style scoped>
.workspace-toolbar { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: .65rem 1rem; border-bottom: 1px solid var(--line, #8883); flex-shrink: 0; }
.workspace-toolbar-actions { display: flex; flex-wrap: wrap; gap: .35rem; margin-left: auto; }
.workspace-toolbar button { font-size: .8rem; padding: .35rem .6rem; }
.workspace-session-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8rem; opacity: .7; }
@media (max-width: 600px) { .workspace-toolbar { padding: .5rem; gap: .35rem; } .workspace-session-title { max-width: 9rem; } }
</style>
