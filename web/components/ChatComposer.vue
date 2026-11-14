<script setup lang="ts">
import { providerLabel } from '../provider-label';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { BotProfile } from '../controller';
import { useWorkspace } from '../workspace';
import ProviderPicker from './ProviderPicker.vue';
import { ArrowUp, ChevronDown, Square } from '@lucide/vue';
import {containsCredential} from '../credential-warning';
const emit = defineEmits<{settings: [id: string]}>();
const {app, state: s} = useWorkspace();
const selected = computed(() => s.value.bots.find(agent => agent.id === s.value.selected));
const profile = ref<BotProfile | null>(null);
watch(() => [selected.value?.id, selected.value?.revision], ([id], _, onCleanup) => {
  let active = true; onCleanup(() => { active = false; });
  if (typeof id !== 'string') { profile.value = null; return; }
  void app.botProfile(id).then(value => { if (active) profile.value = value; }).catch(() => { if (active) profile.value = null; });
}, {immediate: true});
const textarea = ref<HTMLTextAreaElement | null>(null);
const picker = ref(false);
const pickerOpened = ref(false);
const popup = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
function closePicker(restore = false) {
  if (document.activeElement instanceof HTMLElement && popup.value?.contains(document.activeElement)) document.activeElement.blur();
  picker.value = false;
  if (restore) trigger.value?.focus();
}
const pickerEdge = ref<'selected' | 'first' | 'last'>('selected');
async function focusPicker() {
  await nextTick();
  if (!picker.value) return;
  const items = popup.value?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]:not(:disabled)');
  const target = pickerEdge.value === 'first' ? items?.[0] : pickerEdge.value === 'last' ? items?.[items.length - 1] : popup.value?.querySelector<HTMLButtonElement>('[data-model][aria-checked=true]');
  (target ?? popup.value)?.focus();
}
async function openPicker(edge: 'selected' | 'first' | 'last' = 'selected') {
  pickerEdge.value = edge;
  pickerOpened.value = true;
  picker.value = true;
  await focusPicker();
}
function catalogReady() { if (document.activeElement === popup.value) void focusPicker(); }
function togglePicker() { if (picker.value) closePicker(true); else void openPicker(); }
function outside(event: MouseEvent) { if (event.target instanceof Node && !popup.value?.contains(event.target) && !trigger.value?.contains(event.target)) closePicker(); }
function popupKey(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); closePicker(true); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const items = [...(popup.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])];
  if (!items.length) return;
  event.preventDefault();
  const current = items.findIndex(item => item === document.activeElement);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
  items[index]?.focus();
}
function leavePopup(event: FocusEvent) { if (event.relatedTarget instanceof Node && !popup.value?.contains(event.relatedTarget) && !trigger.value?.contains(event.relatedTarget)) closePicker(); }
onMounted(() => document.addEventListener('click', outside));
onUnmounted(() => document.removeEventListener('click', outside));
watch(() => s.value.selected, () => { closePicker(); pickerOpened.value = false; });
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
</script>

<template>
  <div v-if="selected" class="composer-area"><div class="composer">
    <textarea ref="textarea" :rows="2" :disabled="!s.draftReady" aria-label="Message" :placeholder="'Message ' + selected.name + '…'" :value="s.draft.text" @input="edit" @keydown="keydown" />
    <div class="actions"><div class="model-control">
    <div v-if="pickerOpened" :hidden="!picker" id="composer-picker" ref="popup" class="composer-picker model-menu" role="menu" aria-label="Provider, model and reasoning" tabindex="-1" @keydown="popupKey" @focusout="leavePopup">
      <ProviderPicker compact :active="picker" @ready="focusPicker" @catalog-ready="catalogReady" @profile="value => profile = value" :key="selected.id" :id="selected.id" />
    </div>

      <button ref="trigger" class="model-button" aria-haspopup="menu" aria-controls="composer-picker" @keydown.down.prevent="openPicker('first')" @keydown.up.prevent="openPicker('last')" :aria-expanded="picker" aria-label="Choose provider, model and reasoning" @click="togglePicker"><span class="provider-name">{{ providerLabel(selected.provider) }}</span><span> / </span><span class="model-name">{{ selected.model || 'Choose model' }}</span><span> / </span><span>{{ profile?.id === selected.id ? profile.reasoning || 'Automatic' : '…' }}</span><ChevronDown :size="16" aria-hidden="true" focusable="false" /></button>
      </div><button class="composer-control" :aria-label="responding ? stopping ? 'Stopping response' : 'Stop' : 'Send'"
        :title="responding ? stopping ? 'Stopping response' : 'Stop response' : 'Send (Enter)'"
        :disabled="responding ? stopping : !s.draftReady || !!s.draft.submission" @click="responding ? app.stopResponse() : app.send()">
        <Square v-if="responding" :size="16" fill="currentColor" aria-hidden="true" focusable="false" />
        <ArrowUp v-else :size="20" aria-hidden="true" focusable="false" />
        <span class="sr-only">{{ responding ? stopping ? 'Stopping…' : 'Stop' : 'Send' }}</span>
      </button>
    </div>
    <p v-if="stopping" class="composer-status" role="status">Stopping…</p>
    <p v-if="containsCredential(s.draft.text)" role="alert">This message looks like it contains a credential and will not be sent. Remove it, then ask the agent to request it through protected secret entry, or use the relevant connection in Settings. Detection is incomplete.</p>
    <p v-if="!s.draftReady" role="status">{{ s.actionError.includes('Browser storage or locking is unavailable') ? 'Draft unavailable. Check browser storage and locking.' : 'Loading saved draft…' }}</p>
    <p v-if="s.actionError" role="alert">{{ s.actionError }}</p>
  </div><p class="composer-hint">Enter to send · Shift + Enter for a new line</p></div>
</template>
