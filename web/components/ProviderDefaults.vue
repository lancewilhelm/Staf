<script setup lang="ts">
import DisclosureSummary from './DisclosureSummary.vue';
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { Controller } from '../controller';
import { useWorkspace } from '../workspace';
import type {ToolMode} from '../../src/tool-mode';
import ToolModeSelect from './ToolModeSelect.vue';
import ChoiceFields from './ChoiceFields.vue';
const { app } = useWorkspace();
const state = shallowRef<Awaited<ReturnType<Controller['providerDefaults']>> | null>(null);
const provider = ref('codex');
const model = ref('');
const reasoning = ref('default');
const status = ref('');
const creation = shallowRef<Awaited<ReturnType<Controller['creationDefaults']>> | null>(null);
const toolMode = ref<ToolMode>('hybrid');
const modeStatus = ref('');
const creationProvider = ref('');
const creationModel = ref('');
const creationReasoning = ref('default');
const creationStatus = ref('');
let alive=true;const dataset=app.datasetGeneration();
let creationProviderEdited=false,creationModelEdited=false,creationReasoningEdited=false,modeEdited=false;
let providerEdited=false,modelEdited=false,reasoningEdited=false;
onUnmounted(()=>{alive=false});
const current=()=>alive && app.datasetGeneration()===dataset;
onMounted(async()=>{try {const value=await app.creationDefaults();if(!current())return;creation.value=value;if(!modeEdited)toolMode.value=value.toolMode;if(!creationProviderEdited)creationProvider.value=value.provider;if(!creationModelEdited)creationModel.value=value.model??'';if(!creationReasoningEdited)creationReasoning.value=value.reasoning??'default';}catch(error){if(current()){modeStatus.value=String(error);creationStatus.value=String(error)}}});
function changeCreation(field:'provider'|'model'|'reasoning',value:string){if(field==='provider'){creationProviderEdited=creationModelEdited=creationReasoningEdited=true;creationProvider.value=value;creationModel.value='';creationReasoning.value='default';}else if(field==='model'){creationModelEdited=true;creationModel.value=value;}else {creationReasoningEdited=true;creationReasoning.value=value;}}
function changeMode(value:ToolMode|''){if(value){modeEdited=true;toolMode.value=value;}}
async function saveCreation(){if(!creation.value)return;if(!creationProvider.value||!creationModel.value.trim()){creationStatus.value='Choose a real provider and enter a model.';return;}try{await app.saveCreationDefaults(creation.value,creationProvider.value,creationModel.value,creationReasoning.value);creation.value=await app.creationDefaults();creationStatus.value='Creation defaults saved. Existing Demo agents were moved to this provider; other agents are unchanged.';}catch(error){creationStatus.value='Could not finish saving or migration. Your choice is retained. '+String(error)}}
async function compareCreation(){try{creation.value=await app.creationDefaults();creationStatus.value=`Current saved default: ${creation.value.provider || 'unset'} / ${creation.value.model || 'unset'}. Your edits are retained.`}catch(error){creationStatus.value=String(error)}}
async function saveMode(){if(!creation.value)return;try{await app.saveCreationMode(creation.value,toolMode.value);creation.value=await app.creationDefaults();modeStatus.value='Tool mode default saved. Existing agents are unchanged.';}catch(error){modeStatus.value='Could not save. Your choice is retained. '+String(error)}}
async function compareMode(){try{creation.value=await app.creationDefaults();modeStatus.value='Current saved tool mode: '+creation.value.toolMode+'. Your choice is retained.'}catch(error){modeStatus.value=String(error)}}
onMounted(async () => {
  try {
    const value = await app.providerDefaults();
    if(!current())return;
    state.value = value;
    if(!providerEdited && !modelEdited)model.value = value.providers[provider.value]?.model ?? '';
    if(!providerEdited && !reasoningEdited)reasoning.value = value.providers[provider.value]?.reasoning ?? 'default';
  } catch (error) { if(current())status.value = String(error); }
});
watch(provider, () => {
  const pair = state.value?.providers[provider.value];
  model.value = pair?.model ?? '';
  reasoning.value = pair?.reasoning ?? 'default';
});
function change(field: 'provider' | 'model' | 'reasoning', value: string) {
  if (field === 'provider') {providerEdited=true;provider.value = value;}
  else if (field === 'model') {modelEdited=true;model.value = value;}
  else {reasoningEdited=true;reasoning.value = value;}
}
async function save() {
  if (!state.value) return;
  try {
    await app.saveProviderDefault(state.value.revision, provider.value, model.value, reasoning.value);
    state.value = await app.providerDefaults();
    status.value = 'Defaults saved. Existing agent choices are unchanged.';
  } catch (error) { status.value = 'Could not save defaults. Your edits are retained. ' + String(error); }
}
async function compare() {
  try {
    const current = await app.providerDefaults();
    state.value = current;
    status.value = 'Current saved model: ' + (current.providers[provider.value]?.model ?? '(unset)') + '. Your edits are retained; reconcile before saving.';
  } catch (error) { status.value = String(error); }
}
</script>

<template>
  <section aria-label="Provider defaults" class="setting-card">
    <h2 class="section-title">Creation defaults</h2><p>Copied into new agents. Saving a real provider also moves existing Demo agents, including archived agents, to that provider and model. Their next request may send their conversation history to that provider.</p><details class="defaults-editor"><DisclosureSummary>Edit defaults</DisclosureSummary>
    <ChoiceFields real-only :provider="creationProvider" :model="creationModel" :reasoning="creationReasoning" @change="changeCreation" />
    <div class="row"><button :disabled="!creation" @click="saveCreation">Save creation defaults</button><button class="quiet" @click="compareCreation">Compare creation defaults</button></div><p role="status">{{ creationStatus }}</p>
    <ToolModeSelect :model-value="toolMode" @update:model-value="changeMode" /><div class="row"><button :disabled="!creation" @click="saveMode">Save tool mode default</button><button class="quiet" @click="compareMode">Compare latest tool mode</button></div><p role="status">{{ modeStatus }}</p>
    <h3>First-use provider choices</h3><p>These choices apply when an agent switches to a provider for the first time.</p>
    <div class="provider-pair-defaults"><ChoiceFields :provider="provider" :model="model" :reasoning="reasoning" @change="change" /></div>
    <div class="row provider-default-actions"><button :disabled="!state" @click="save">Save provider defaults</button><button class="quiet" @click="compare">Compare latest defaults</button></div>
    <p role="status">{{ status }}</p>
    </details>
  </section>
</template>
