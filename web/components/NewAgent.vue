<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import UiIcon from './UiIcon.vue';
import { useWorkspace } from '../workspace';
import ChoiceFields from './ChoiceFields.vue';
import InstructionsHelp from './InstructionsHelp.vue';
import AgentImageChooser from './AgentImageChooser.vue';
const imageValid=ref(true);
const {app, state: s} = useWorkspace();
const dialog = ref<HTMLDialogElement | null>(null);
let previous: Element | null = null;
onMounted(async () => { previous = document.activeElement; dialog.value?.showModal(); await nextTick(); dialog.value?.querySelector<HTMLInputElement>('input')?.focus(); });
onUnmounted(() => { if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) previous.focus(); else document.querySelector<HTMLButtonElement>('.new-agent')?.focus(); });
function close() { app.closeSetup(); }
function submit() { if (s.value.setup.kind === 'create' && !s.value.setup.operationId && imageValid.value) void app.create(); }
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
    <form @submit.prevent="submit"><div class="modal-head"><h2 id="new-agent-title">Create agent</h2><button type="button" class="icon-button" aria-label="Close dialog" @click="close"><UiIcon name="close" /></button></div><p>Choose a name and optional instructions.</p>
    <label>Name<input placeholder="e.g. Robin" :value="s.setup.name" :disabled="!!s.setup.operationId" @input="input('name', $event)" /></label>
    <AgentImageChooser :model-value="s.setup.image??{kind:'initials'}" :name="s.setup.name" :disabled="!!s.setup.operationId" @update:model-value="value=>app.setupImage(value)" @valid="value=>imageValid=value" />
    <label>Instructions<textarea :value="s.setup.instructions" :disabled="!!s.setup.operationId" @input="input('instructions', $event)" /></label><InstructionsHelp />
    <details class="creation-choices"><summary>Provider, model and reasoning</summary><ChoiceFields reset-unsupported :provider="s.setup.provider" :model="s.setup.model" :reasoning="s.setup.reasoning ?? 'default'" :disabled="!!s.setup.operationId" @change="change" />
    </details><p>Creation defaults are copied into this agent.</p>
    <div class="row modal-footer">
      <button type="button" class="quiet" @click="app.closeSetup()">Cancel</button>
      <template v-if="s.setup.operationId"><button type="button" @click="app.checkCreate()">Check creation</button><button type="button" @click="app.create(true)">Retry same creation</button></template>
      <button type="submit" v-else :disabled="!imageValid">Create agent</button>
    </div>
    <p role="status">{{ s.setup.status }}</p>
    </form>
  </dialog>
</template>
