<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useWorkspace } from '../workspace';
import AgentEditorFields from './AgentEditorFields.vue';
const imageValid=ref(true);
const {app, state: s} = useWorkspace();
const emit=defineEmits<{cancel:[]}>();
onMounted(async()=>{await nextTick();document.querySelector<HTMLInputElement>('.agent-settings input')?.focus()});
function change(field: 'provider' | 'model' | 'reasoning', value: string) {
  if (field === 'provider') void app.setupProvider(value);
  else app.setupField(field, value);
}
</script>
<template>
  <div v-if="s.setup.kind === 'create'" class="settings-scroll"><form class="setup settings-content agent-settings" @submit.prevent="imageValid && app.create()">
    <span class="eyebrow">AGENT SETTINGS</span><h1 class="page-title">Create agent</h1>
    <AgentEditorFields :name="s.setup.name" :image="s.setup.image??{kind:'initials'}" :instructions="s.setup.instructions" :tool-mode="s.setup.toolMode??''" :provider="s.setup.provider" :model="s.setup.model" :reasoning="s.setup.reasoning??'default'" :disabled="!!s.setup.operationId" creating @name="value=>app.setupField('name',value)" @instructions="value=>app.setupField('instructions',value)" @image="value=>app.setupImage(value)" @tool-mode="value=>app.setupToolMode(value)" @choice="change" @valid="value=>imageValid=value" />
    <div class="row agent-settings-actions"><button v-if="!s.setup.operationId" type="submit" :disabled="!imageValid">Create agent</button><button type="button" class="quiet" @click="emit('cancel')">Cancel</button><template v-if="s.setup.operationId"><button type="button" @click="app.checkCreate()">Check creation</button><button type="button" @click="app.create(true)">Retry same creation</button></template></div>
    <p role="status">{{ s.setup.status }}</p>
  </form></div>
</template>
