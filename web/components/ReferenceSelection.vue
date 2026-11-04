<script setup lang="ts">
import type { WorkspaceReference } from '../../src/workspace-references';

defineProps<{sources: Array<{reference: WorkspaceReference; title: string; location: string}>; disabled?: boolean}>();
const emit = defineEmits<{remove: [index: number]}>();
</script>

<template>
  <section v-if="sources.length" class="reference-selection" aria-label="Selected sources">
    <p>Sources for your next message</p>
    <ul>
      <li v-for="(source, index) in sources" :key="JSON.stringify(source.reference)">
        <span><strong>{{ source.title }}</strong><small>{{ source.location }}</small></span>
        <button class="quiet" :disabled="disabled" :aria-label="'Remove source ' + source.title" @click="emit('remove', index)">Remove</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.reference-selection { margin: 0 1rem; padding: .65rem .85rem; border: 1px solid var(--line, #8883); border-radius: .75rem; font-size: .8rem; }
.reference-selection p { margin: 0 0 .4rem; }
.reference-selection ul { list-style: none; margin: 0; padding: 0; }
.reference-selection li { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .3rem 0; }
.reference-selection span { min-width: 0; overflow-wrap: anywhere; }
.reference-selection small { display: block; opacity: .7; }
.reference-selection button { font-size: .75rem; flex-shrink: 0; }
</style>
