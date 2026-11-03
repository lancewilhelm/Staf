<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue';
import type { BotProfile } from '../controller';
import { useWorkspace } from '../workspace';
import ProviderPicker from './ProviderPicker.vue';
import InstructionsHelp from './InstructionsHelp.vue';
const props = defineProps<{id: string; saving: boolean}>();
const emit = defineEmits<{close: []; providers: []; 'update:saving': [value: boolean]}>();
const { app } = useWorkspace();
const profile = shallowRef<BotProfile | null>(null);
const name = ref('');
const instructions = ref('');
const status = ref('');
const compareAvailable = ref(false);
const latest = shallowRef<BotProfile | null>(null);
watch(() => props.id, (id, _, onCleanup) => {
  let active = true;
  onCleanup(() => { active = false; });
  void app.botProfile(id).then(value => {
    if (active) { profile.value = value; name.value = value.name; instructions.value = value.instructions; }
  }).catch(error => { if (active) status.value = 'Could not load agent settings. ' + String(error); });
}, {immediate: true});
async function save() {
  if (!profile.value) return;
  if (!name.value.trim()) { status.value = 'Enter a name for this agent.'; return; }
  emit('update:saving', true);
  status.value = '';
  latest.value = null;
  try {
    await app.saveBotProfile(profile.value, {name: name.value, provider: profile.value.provider, model: profile.value.model ?? '', instructions: instructions.value});
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
async function archive() {
  if (!profile.value || !window.confirm('Archive this agent? Its configuration and conversation will be retained.')) return;
  emit('update:saving', true);
  status.value = '';
  try { await app.setArchived(profile.value, true); emit('close'); }
  catch (error) { compareAvailable.value = true; status.value = 'Could not archive the agent, or the result is uncertain. Compare the current settings before retrying. ' + String(error); }
  finally { emit('update:saving', false); }
}
</script>

<template>
  <div class="setup">
    <span class="eyebrow">AGENT SETTINGS</span><h2>{{ profile?.name || 'Agent settings' }}</h2>
    <template v-if="profile">
      <p>Provider connections are shared by the instance. A saved connection does not verify account or model access.</p>
      <label>Name<input v-model="name" :disabled="saving" /></label>
      <ProviderPicker :id="id" :disabled="saving" @profile="value => profile = value" />
      <button :disabled="saving" class="quiet" @click="emit('providers')">Open provider settings</button>
      <label>Instructions<textarea v-model="instructions" :disabled="saving" /></label><InstructionsHelp />
      <p class="meta">Configuration: <code>{{ profile.configDir }}</code></p>
      <div class="row"><button :disabled="saving" @click="save">Save settings</button><button :disabled="saving" class="quiet" @click="emit('close')">Cancel</button></div>
      <button v-if="!profile.archived" :disabled="saving" class="quiet" @click="archive">Archive agent</button>
    </template>
    <p role="status">{{ saving ? 'Loading or saving…' : status }}</p>
    <button v-if="compareAvailable" :disabled="saving" class="quiet" @click="compare">Compare latest settings</button>
    <section v-if="latest" class="saved-settings" aria-label="Current saved settings">
      <h3>Current saved settings</h3><p>Name: {{ latest.name }}</p><p>Provider: {{ latest.provider }}</p><p>Model: {{ latest.model || '(none)' }}</p><p>Instructions:</p><pre>{{ latest.instructions }}</pre>
    </section>
  </div>
</template>
