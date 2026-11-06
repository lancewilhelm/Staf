<script setup lang="ts">
import { profileAffectsCache } from '../../src/cache-impact';
import { providerLabel } from '../provider-label';
import { ref, shallowRef, watch } from 'vue';
import type { BotProfile } from '../controller';
import { useWorkspace } from '../workspace';
import AgentEditorFields from './AgentEditorFields.vue';
import AgentImage from './AgentImage.vue';
import ConfirmAction from './ConfirmAction.vue';
import type {ToolMode} from '../../src/tool-mode';
import type {AgentImageInput} from '../../src/agent-image';
const image=ref<AgentImageInput>({kind:'initials'});
const imageValid=ref(true);
const props = defineProps<{id: string; saving: boolean}>();
const emit = defineEmits<{close: []; providers: []; memory: []; 'update:saving': [value: boolean]}>();
const { app } = useWorkspace();
const profile = shallowRef<BotProfile | null>(null);
const name = ref('');
const instructions = ref('');
const toolMode = ref<ToolMode>('direct');
const provider = ref('');
const model = ref('');
const reasoning = ref('default');
const choices = new Map<string,{model:string;reasoning:string}>();
const status = ref('');
const confirmingArchive = ref(false);
const confirmingProvider = ref(false);
const compareAvailable = ref(false);
const latest = shallowRef<BotProfile | null>(null);
watch(() => props.id, (id, _, onCleanup) => {
  let active = true;
  onCleanup(() => { active = false; });
  void app.botProfile(id).then(value => {
    if (active) {
      profile.value = value; name.value = value.name; instructions.value = value.instructions; toolMode.value=value.toolMode; image.value=value.image;
      provider.value=value.provider; model.value=value.model??''; reasoning.value=value.reasoning??'default';
      for(const [key,pair] of Object.entries(value.providerChoices??{})) choices.set(key,{model:pair.model??'',reasoning:pair.reasoning??'default'});
    }
  }).catch(error => { if (active) status.value = 'Could not load agent settings. ' + String(error); });
}, {immediate: true});
async function choice(field:'provider'|'model'|'reasoning',value:string) {
  if(field==='model'){model.value=value;return}
  if(field==='reasoning'){reasoning.value=value;return}
  if(value===provider.value)return;
  choices.set(provider.value,{model:model.value,reasoning:reasoning.value});
  provider.value=value;
  const pair=choices.get(value);
  model.value=pair?.model??''; reasoning.value=pair?.reasoning??'default';
  if(!pair) try {
    const defaults=await app.providerDefaults();
    if(provider.value===value && !model.value && reasoning.value==='default') { model.value=defaults.providers[value]?.model??''; reasoning.value=defaults.providers[value]?.reasoning??'default'; }
  } catch { /* Manual selection remains available. */ }
}
function requestSave() {
  if (!profile.value || !imageValid.value) return;
  if (!name.value.trim()) { status.value = 'Enter a name for this agent.'; return; }
  if(provider.value!==profile.value.provider){confirmingProvider.value=true;return}
  void save();
}
async function save() {
  confirmingProvider.value=false;
  if (!profile.value || !imageValid.value) return;
  emit('update:saving', true); status.value = ''; latest.value = null;
  try {
    const before = profile.value;
    const edit = {name:name.value,provider:provider.value,model:model.value,reasoning:reasoning.value,instructions:instructions.value,toolMode:toolMode.value,image:image.value};
    await app.saveBotProfile(before, edit);
    if (profileAffectsCache(before, {...before, ...edit, model:edit.model.trim() || null, reasoning:edit.reasoning === 'default' ? null : edit.reasoning})) app.notify('Settings saved. This change may reduce provider prompt cache reuse on the next message. Actual cache use depends on the provider.', 'success');
    emit('close');
  } catch (error) {
    compareAvailable.value = true;
    status.value = 'The save failed or its result is uncertain. Your edits are retained. Compare the current settings before retrying. ' + String(error);
  } finally { emit('update:saving', false); }
}
async function compare() {
  emit('update:saving', true);
  try {
    const current = await app.botProfile(props.id);
    profile.value = current; latest.value = current; compareAvailable.value = false;
    status.value = 'Review the current settings below and reconcile your edits before saving. A later change will still cause a conflict.';
  } catch (error) { status.value = 'Could not load the current settings. Your edits are retained. ' + String(error); }
  finally { emit('update:saving', false); }
}
async function archive() {
  confirmingArchive.value = false;
  if (!profile.value) return;
  emit('update:saving', true); status.value = '';
  try { await app.setArchived(profile.value, true); emit('close'); }
  catch (error) { compareAvailable.value = true; status.value = 'Could not archive the agent, or the result is uncertain. Compare the current settings before retrying. ' + String(error); }
  finally { emit('update:saving', false); }
}
</script>
<template>
  <div class="settings-scroll"><div class="setup settings-content agent-settings">
    <span class="eyebrow">AGENT SETTINGS</span><h1 class="page-title">{{ profile?.name || 'Agent settings' }}</h1>
    <template v-if="profile">
      <section class="settings-section"><h2 class="section-title">Memory</h2><p class="section-help">Saved memory available only to {{ profile.name }}.</p><button :disabled="saving" class="quiet agent-memory-link" @click="emit('memory')">View agent memory</button></section>
      <p>Provider connections are shared by the instance. A saved connection does not verify account or model access.</p>
      <AgentEditorFields :name="name" :image="image" :instructions="instructions" :tool-mode="toolMode" :provider="provider" :model="model" :reasoning="reasoning" :disabled="saving" :creating="false" @name="value=>name=value" @instructions="value=>instructions=value" @image="value=>image=value" @tool-mode="value=>{if(value)toolMode=value}" @choice="choice" @valid="value=>imageValid=value" />
      <button :disabled="saving" class="quiet" @click="emit('providers')">Open provider settings</button>
      <p class="meta">Configuration: <code>{{ profile.configDir }}</code></p>
      <div class="row agent-settings-actions"><button :disabled="saving||!imageValid" @click="requestSave">Save settings</button><button :disabled="saving" class="quiet" @click="emit('close')">Cancel</button><button v-if="!profile.archived" :disabled="saving" class="quiet archive-action" @click="confirmingArchive = true">Archive agent</button></div>
      <ConfirmAction v-if="confirmingArchive" title="Archive agent?" message="Its configuration and conversation will be retained." action="Archive agent" @cancel="confirmingArchive = false" @confirm="archive" />
      <ConfirmAction v-if="confirmingProvider" title="Change provider?" message="Changing provider may send this conversation history to the new provider." action="Change provider" @cancel="confirmingProvider = false" @confirm="save" />
    </template>
    <p role="status">{{ saving ? 'Loading or saving…' : status }}</p>
    <button v-if="compareAvailable" :disabled="saving" class="quiet" @click="compare">Compare latest settings</button>
    <section v-if="latest" class="saved-settings" aria-label="Current saved settings">
      <h3>Current saved settings</h3><AgentImage :image="latest.image" :name="latest.name" /><button :disabled="saving||!imageValid" class="quiet" @click="image=latest.image">Use latest image</button><p>Name: {{ latest.name }}</p><p>Provider: {{ providerLabel(latest.provider) }}</p><p>Model: {{ latest.model || '(none)' }}</p><p>Reasoning: {{ latest.reasoning || 'Provider default' }}</p><p>Tool mode: {{ latest.toolMode }}</p><p>Instructions:</p><pre>{{ latest.instructions }}</pre>
    </section>
  </div></div>
</template>
