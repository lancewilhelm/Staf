<script setup lang="ts">
import {onMounted, ref} from 'vue';
import type {ResolvedReference, WorkspaceReference} from '../../src/workspace-reference-types';
const props=defineProps<{source:ResolvedReference}>();
const emit=defineEmits<{close:[];original:[reference:WorkspaceReference]}>();
const dialog=ref<HTMLDialogElement|null>(null);
onMounted(()=>dialog.value?.showModal());
</script>

<template>
  <dialog ref="dialog" class="source-preview" aria-labelledby="source-preview-title" @cancel.prevent="emit('close')">
    <div class="row"><h2 id="source-preview-title">{{ props.source.title }}</h2><button class="quiet" aria-label="Close source" @click="emit('close')">Close</button></div>
    <p>{{ props.source.location }}</p>
    <pre>{{ props.source.content }}</pre>
    <button @click="emit('original', props.source.reference)">Open original</button>
  </dialog>
</template>

<style scoped>
.source-preview { color: var(--ink); background: var(--surface); border: 1px solid var(--line, #8885); border-radius: 1rem; width: min(48rem, calc(100vw - 2rem)); max-height: 80vh; padding: 1.25rem; }
.source-preview::backdrop { background: #0007; }
.source-preview .row { justify-content: space-between; }
.source-preview h2 { margin: 0; }
.source-preview pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.6; }
</style>
