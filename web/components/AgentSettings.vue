<script setup lang="ts">
import { profileAffectsCache } from '../../src/cache-impact';
import { providerLabel } from '../provider-label';
import { ref, shallowRef, watch } from 'vue';
import type { BotProfile } from '../controller';
import { useWorkspace } from '../workspace';
import ProviderPicker from './ProviderPicker.vue';
import InstructionsHelp from './InstructionsHelp.vue';
import AgentImageChooser from './AgentImageChooser.vue';
import AgentImage from './AgentImage.vue';
import ConfirmAction from './ConfirmAction.vue';
import type {ToolMode} from '../../src/tool-mode';
import ToolModeSelect from './ToolModeSelect.vue';
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
const status = ref('');
const confirmingArchive = ref(false);
const compareAvailable = ref(false);
const latest = shallowRef<BotProfile | null>(null);
watch(() => props.id, (id, _, onCleanup) => {
  let active = true;
  onCleanup(() => { active = false; });
  void app.botProfile(id).then(value => {
    if (active) { profile.value = value; name.value = value.name; instructions.value = value.instructions; toolMode.value=value.toolMode; image.value=value.image; }
  }).catch(error => { if (active) status.value = 'Could not load agent settings. ' + String(error); });
}, {immediate: true});
async function save() {
  if (!profile.value || !imageValid.value) return;
  if (!name.value.trim()) { status.value = 'Enter a name for this agent.'; return; }
  emit('update:saving', true);
  status.value = '';
  latest.value = null;
  try {
    await app.saveBotProfile(profile.value, {name: name.value, provider: profile.value.provider, model: profile.value.model ?? '', instructions: instructions.value,toolMode:toolMode.value,image:image.value});
    if (profileAffectsCache(profile.value, {...profile.value, instructions: instructions.value, toolMode: toolMode.value})) app.notify('Settings saved. This change may reduce provider prompt cache reuse on the next message. Actual cache use depends on the provider.', 'success');
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
    profile.value = current;
    latest.value = current;
    compareAvailable.value = false;
    status.value = 'Review the current settings below and reconcile your edits before saving. A later change will still cause a conflict.';
  } catch (error) { status.value = 'Could not load the current settings. Your edits are retained. ' + String(error); }
  finally { emit('update:saving', false); }
}
function providerSaved(value:BotProfile,baseRevision:string|null) {
  if(profile.value?.revision===baseRevision) profile.value=value;
  else {
    compareAvailable.value=true;
    status.value='Settings changed while you were editing. Your draft is retained. Compare latest settings before saving.';
  }
}
async function archive() {
  confirmingArchive.value = false;
  if (!profile.value) return;
  emit('update:saving', true);
  status.value = '';
  try { await app.setArchived(profile.value, true); emit('close'); }
  catch (error) { compareAvailable.value = true; status.value = 'Could not archive the agent, or the result is uncertain. Compare the current settings before retrying. ' + String(error); }
  finally { emit('update:saving', false); }
}
</script>

<template>
  <div class="settings-scroll"><div class="setup settings-content agent-settings">
    <span class="eyebrow">AGENT SETTINGS</span><h1 class="page-title">{{ profile?.name || 'Agent settings' }}</h1><p class="page-intro">Edit this agent’s name, instructions, provider, and model.</p>
    <template v-if="profile">
      <section class="settings-section"><h2 class="section-title">Memory</h2><p class="section-help">Saved memory available only to {{ profile.name }}.</p><button :disabled="saving" class="quiet agent-memory-link" @click="emit('memory')">View agent memory</button></section>
      <p>Provider connections are shared by the instance. A saved connection does not verify account or model access.</p>
      <label>Name<input v-model="name" :disabled="saving" /></label>
      <AgentImageChooser v-model="image" :name="name" :disabled="saving" @valid="value=>imageValid=value" />
      <label>Instructions<textarea v-model="instructions" :disabled="saving" /></label><InstructionsHelp />
      <ToolModeSelect v-model="toolMode" :disabled="saving" />
      <ProviderPicker :id="id" :disabled="saving" @profile="providerSaved" />
      <button :disabled="saving" class="quiet" @click="emit('providers')">Open provider settings</button>
      <p class="meta">Configuration: <code>{{ profile.configDir }}</code></p>
      <div class="row agent-settings-actions"><button :disabled="saving||!imageValid" @click="save">Save settings</button><button :disabled="saving" class="quiet" @click="emit('close')">Cancel</button><button v-if="!profile.archived" :disabled="saving" class="quiet archive-action" @click="confirmingArchive = true">Archive agent</button></div>
      <ConfirmAction v-if="confirmingArchive" title="Archive agent?" message="Its configuration and conversation will be retained." action="Archive agent" @cancel="confirmingArchive = false" @confirm="archive" />
    </template>
    <p role="status">{{ saving ? 'Loading or saving…' : status }}</p>
    <button v-if="compareAvailable" :disabled="saving" class="quiet" @click="compare">Compare latest settings</button>
    <section v-if="latest" class="saved-settings" aria-label="Current saved settings">
      <h3>Current saved settings</h3><AgentImage :image="latest.image" :name="latest.name" /><button :disabled="saving||!imageValid" class="quiet" @click="image=latest.image">Use latest image</button><p>Name: {{ latest.name }}</p><p>Provider: {{ providerLabel(latest.provider) }}</p><p>Model: {{ latest.model || '(none)' }}</p><p>Tool mode: {{ latest.toolMode }}</p><p>Instructions:</p><pre>{{ latest.instructions }}</pre>
    </section>
  </div></div>
</template>
