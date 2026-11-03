<script setup lang="ts">
import { useWorkspace } from '../workspace';
import ChoiceFields from './ChoiceFields.vue';
import InstructionsHelp from './InstructionsHelp.vue';
const {app, state: s} = useWorkspace();
function change(field: 'provider' | 'model' | 'reasoning', value: string) {
  if (field === 'provider') void app.setupProvider(value);
  else app.setupField(field, value);
}
function input(field: 'name' | 'instructions', event: Event) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) app.setupField(field, event.target.value);
}
</script>

<template>
  <div v-if="s.setup.kind === 'create'" class="setup">
    <span class="eyebrow">YOUR AGENT</span><h2>Create your agent</h2><p>Give your agent a name. Instructions and provider settings are optional.</p>
    <label>Name<input :value="s.setup.name" :disabled="!!s.setup.operationId" @input="input('name', $event)" /></label>
    <label>Instructions<textarea :value="s.setup.instructions" :disabled="!!s.setup.operationId" @input="input('instructions', $event)" /></label><InstructionsHelp />
    <ChoiceFields reset-unsupported :provider="s.setup.provider" :model="s.setup.model" :reasoning="s.setup.reasoning ?? 'default'" :disabled="!!s.setup.operationId" @change="change" />
    <p>Provider connections are shared. Defaults are copied when the agent is created.</p>
    <div class="row">
      <template v-if="s.setup.operationId"><button @click="app.checkCreate()">Check creation</button><button @click="app.create(true)">Retry same creation</button></template>
      <button v-else @click="app.create()">Create agent</button>
      <button class="quiet" @click="app.closeSetup()">Close</button>
    </div>
    <p role="status">{{ s.setup.status }}</p>
  </div>
</template>
