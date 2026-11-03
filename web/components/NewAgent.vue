<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import UiIcon from './UiIcon.vue';
import { useWorkspace } from '../workspace';
import ChoiceFields from './ChoiceFields.vue';
import InstructionsHelp from './InstructionsHelp.vue';
const {app, state: s} = useWorkspace();
const dialog = ref<HTMLDialogElement | null>(null);
let previous: Element | null = null;
onMounted(async () => { previous = document.activeElement; dialog.value?.showModal(); await nextTick(); dialog.value?.querySelector<HTMLInputElement>('input')?.focus(); });
onUnmounted(() => { if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) previous.focus(); else document.querySelector<HTMLButtonElement>('.new-agent')?.focus(); });
function close() { app.closeSetup(); }
function change(field: 'provider' | 'model' | 'reasoning', value: string) {
  if (field === 'provider') void app.setupProvider(value);
  else app.setupField(field, value);
}
function input(field: 'name' | 'instructions', event: Event) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) app.setupField(field, event.target.value);
}
</script>

<template>
  <dialog v-if="s.setup.kind === 'create'" ref="dialog" class="modal setup" aria-labelledby="new-agent-title" @cancel.prevent="close">
    <div class="modal-head"><h2 id="new-agent-title">Create your agent</h2><button class="icon-button" aria-label="Close dialog" @click="close"><UiIcon name="close" /></button></div><p>Choose a name and optional instructions.</p>
    <label>Name<input :value="s.setup.name" :disabled="!!s.setup.operationId" @input="input('name', $event)" /></label>
    <label>Instructions<textarea :value="s.setup.instructions" :disabled="!!s.setup.operationId" @input="input('instructions', $event)" /></label><InstructionsHelp />
    <details class="creation-choices"><summary>Provider, model and reasoning</summary><ChoiceFields reset-unsupported :provider="s.setup.provider" :model="s.setup.model" :reasoning="s.setup.reasoning ?? 'default'" :disabled="!!s.setup.operationId" @change="change" />
    </details><p>Creation defaults are copied into this agent.</p>
    <div class="row modal-footer">
      <button class="quiet" @click="app.closeSetup()">Cancel</button>
      <template v-if="s.setup.operationId"><button @click="app.checkCreate()">Check creation</button><button @click="app.create(true)">Retry same creation</button></template>
      <button v-else @click="app.create()">Create agent</button>
    </div>
    <p role="status">{{ s.setup.status }}</p>
  </dialog>
</template>
