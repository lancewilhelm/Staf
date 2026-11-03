<script setup lang="ts">
import { providerLabel } from '../../src/provider-label';
import { computed, ref, watch } from 'vue';
import { useWorkspace } from '../workspace';
import ProviderPicker from './ProviderPicker.vue';
const emit = defineEmits<{settings: [id: string]}>();
const {app, state: s} = useWorkspace();
const selected = computed(() => s.value.bots.find(agent => agent.id === s.value.selected));
const textarea = ref<HTMLTextAreaElement | null>(null);
const picker = ref(false);
const responding = computed(() => !!s.value.response && ['accepted', 'running', 'stopping'].includes(s.value.response.state));
const stopping = computed(() => s.value.response?.state === 'stopping');
watch([() => s.value.draft.text, () => s.value.selected, textarea], () => {
  const node = textarea.value;
  if (node) { node.style.height = 'auto'; node.style.height = Math.min(node.scrollHeight, 180) + 'px'; }
}, {flush: 'post'});
function edit(event: Event) { if (event.target instanceof HTMLTextAreaElement) app.edit(event.target.value); }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void app.send(); }
}
function openSettings() {
  if (!selected.value) return;
  picker.value = false;
  emit('settings', selected.value.id);
}
</script>

<template>
  <div v-if="selected" class="composer">
    <textarea ref="textarea" :rows="2" :disabled="!s.draftReady" aria-label="Message" :placeholder="'Message ' + selected.name + '…'" :value="s.draft.text" @input="edit" @keydown="keydown" />
    <div v-if="picker" class="composer-picker">
      <ProviderPicker :key="selected.id" :id="selected.id" />
      <button class="quiet" @click="openSettings">Agent settings</button><button class="quiet" @click="picker = false">Close picker</button>
    </div>
    <div class="actions">
      <button class="model-button" :aria-expanded="picker" aria-label="Choose provider, model and reasoning" @click="picker = !picker">{{ providerLabel(selected.provider) }} · {{ selected.model || 'Choose model' }}</button>
      <button class="composer-control" :aria-label="responding ? stopping ? 'Stopping response' : 'Stop' : 'Send'"
        :title="responding ? stopping ? 'Stopping response' : 'Stop response' : 'Send (Enter)'"
        :disabled="responding ? stopping : !s.draftReady || !!s.draft.submission" @click="responding ? app.stopResponse() : app.send()">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
          <rect v-if="responding" x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          <path v-else d="M12 19V5m-6 6 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="sr-only">{{ responding ? stopping ? 'Stopping…' : 'Stop' : 'Send' }}</span>
      </button>
    </div>
    <p v-if="stopping" class="composer-status" role="status">Stopping…</p>
    <p v-if="!s.draftReady" role="status">{{ s.actionError.includes('Browser storage or locking is unavailable') ? 'Draft unavailable. Check browser storage and locking.' : 'Loading saved draft…' }}</p>
    <p v-if="s.actionError" role="alert">{{ s.actionError }}</p>
  </div>
</template>
