<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { BotProfile } from '../controller';
import { useWorkspace } from '../workspace';
import ChoiceFields from './ChoiceFields.vue';
const props = withDefaults(defineProps<{id: string; disabled?: boolean; compact?: boolean}>(), {disabled: false});
const emit = defineEmits<{profile: [profile: BotProfile]; selected: []; ready: []}>();
const { app, state } = useWorkspace();
const profile = shallowRef<BotProfile | null>(null);
const model = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const sharedRevision = computed(() => state.value.bots.find(agent => agent.id === props.id)?.revision);
watch(() => props.id, (id, _, onCleanup) => {
  let active = true;
  onCleanup(() => { active = false; });
  profile.value = null;
  void app.botProfile(id).then(value => {
    if (active) { profile.value = value; model.value = value.model ?? ''; emit('ready'); }
  }).catch(reason => { if (active) error.value = String(reason); });
}, {immediate: true});
watch([sharedRevision, busy, profile, model], (_, __, onCleanup) => {
  if (!profile.value || busy.value || !sharedRevision.value || sharedRevision.value === profile.value.revision) return;
  if (model.value !== (profile.value.model ?? '')) {
    error.value = 'Choices changed in another client. Compare latest choices; your model text is retained.';
    return;
  }
  let active = true;
  onCleanup(() => { active = false; });
  void app.botProfile(props.id).then(value => {
    if (active) { profile.value = value; model.value = value.model ?? ''; emit('ready'); }
  }).catch(reason => { if (active) error.value = String(reason); });
});
async function save(field: 'provider' | 'model' | 'reasoning', value: string) {
  if (!profile.value) return;
  if (field === 'model') { model.value = value; return; }
  if (field === 'provider' && value !== profile.value.provider && !window.confirm('Changing provider may send this conversation history to the new provider. Continue?')) return;
  await commit(field, value);
}
async function commit(field: 'provider' | 'model' | 'reasoning', value: string) {
  if (!profile.value || busy.value) return;
  busy.value = true;
  error.value = '';
  const previous = profile.value;
  try {
    const saved = await app.selectProvider(previous, field === 'provider' ? value : previous.provider, field === 'provider' ? {} : {[field]: value === 'default' || !value ? null : value});
    profile.value = saved;
    model.value = saved.model ?? '';
    emit('profile', saved);
    notice.value = field === 'model' && previous.reasoning && previous.reasoning !== saved.reasoning ? 'Reasoning changed to Provider default for this model.' : 'Saved. Applies to the next message.';
    if (props.compact) { app.notify(notice.value, 'success'); if (field === 'model') emit('selected'); }
  } catch (reason) { error.value = 'Save failed or is uncertain. Your edits are retained. ' + String(reason); }
  finally { busy.value = false; }
}
function blur(event: FocusEvent) {
  if (event.target instanceof HTMLInputElement && profile.value && model.value !== (profile.value.model ?? '')) void commit('model', model.value);
}
async function compare() {
  try {
    const current = await app.botProfile(props.id);
    profile.value = current;
    error.value = 'Current saved model: ' + (current.model ?? '(unset)') + '. Review retained model text before retrying.';
    emit('profile', current);
  } catch (reason) { error.value = String(reason); }
}
</script>

<template>
  <fieldset class="provider-picker" :disabled="disabled" aria-label="Provider picker">
    <div v-if="profile" @focusout="blur">
      <ChoiceFields :menu="compact" :provider="profile.provider" :model="model" :reasoning="profile.reasoning ?? 'default'" :disabled="busy" @model-select="value => commit('model', value)" @change="save" />
    </div>
    <p role="status">{{ busy ? 'Saving…' : notice }}</p>
    <template v-if="error"><p role="alert">{{ error }}</p><button @click="compare">Compare latest choices</button></template>
  </fieldset>
</template>
