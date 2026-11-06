<script setup lang="ts">
import { profileAffectsCache } from '../../src/cache-impact';
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import type { BotProfile } from '../controller';
import { useWorkspace } from '../workspace';
import ChoiceFields from './ChoiceFields.vue';
const props = withDefaults(defineProps<{id: string; disabled?: boolean; compact?: boolean; active?: boolean}>(), {disabled: false, active: true});
const emit = defineEmits<{profile: [profile: BotProfile, baseRevision: string | null]; ready: []; catalogReady: []}>();
const { app, state } = useWorkspace();
const profile = shallowRef<BotProfile | null>(null);
const model = ref('');
const busy = ref(false);
const error = ref('');
const pendingProvider = ref('');
const root = ref<HTMLElement | null>(null);
const sharedRevision = computed(() => state.value.bots.find(agent => agent.id === props.id)?.revision);
watch(() => props.active, active => { if (!active) pendingProvider.value = ''; });
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
  if (field === 'provider' && value !== profile.value.provider) { pendingProvider.value = value; await nextTick(); root.value?.querySelector<HTMLButtonElement>('[data-cancel-provider]')?.focus(); return; }
  await commit(field, value);
}
async function cancelProvider() {
  const value = pendingProvider.value; pendingProvider.value = ''; await nextTick();
  root.value?.querySelector<HTMLButtonElement>(`[data-provider="${CSS.escape(value)}"]`)?.focus();
}
async function confirmProvider() {
  const value = pendingProvider.value; pendingProvider.value = ''; await commit('provider', value);
  if (props.active) root.value?.querySelector<HTMLButtonElement>(`[data-provider="${CSS.escape(value)}"]`)?.focus();
}
async function commit(field: 'provider' | 'model' | 'reasoning', value: string) {
  if (!profile.value || busy.value) return;
  if ((field === 'provider' && value === profile.value.provider) || (field === 'model' && value === (profile.value.model ?? '')) || (field === 'reasoning' && (value === 'default' ? null : value) === profile.value.reasoning)) return;
  const focused = document.activeElement instanceof HTMLElement && root.value?.contains(document.activeElement) ? document.activeElement : null;
  busy.value = true;
  error.value = '';
  const previous = profile.value;
  try {
    const saved = await app.selectProvider(previous, field === 'provider' ? value : previous.provider, field === 'provider' ? {} : {[field]: value === 'default' || !value ? null : value});
    profile.value = saved;
    model.value = saved.model ?? '';
    emit('profile', saved, previous.revision);
    let notice = field === 'model' && previous.reasoning && previous.reasoning !== saved.reasoning ? 'Reasoning changed to Automatic for this model.' : 'Saved. Applies to the next message.';
    if (profileAffectsCache(previous, saved)) notice += ' This change may reduce provider prompt cache reuse on the next message. Actual cache use depends on the provider.';
    app.notify(notice, 'success');
  } catch (reason) { error.value = 'Save failed or is uncertain. Your edits are retained. ' + String(reason); }
  finally { busy.value = false; await nextTick(); if (props.active && focused?.isConnected) focused.focus(); }
}
function blur(event: FocusEvent) {
  if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.hasAttribute('data-model')) return;
  if (event.target instanceof HTMLInputElement && profile.value && model.value !== (profile.value.model ?? '')) void commit('model', model.value);
}
async function compare() {
  try {
    const current = await app.botProfile(props.id);
    profile.value = current;
    error.value = 'Current saved model: ' + (current.model ?? '(unset)') + '. Review retained model text before retrying.';
    emit('profile', current, null);
  } catch (reason) { error.value = String(reason); }
}
</script>

<template>
  <fieldset ref="root" class="provider-picker" :disabled="disabled" aria-label="Provider picker">
    <div v-if="profile" @focusout="blur">
      <ChoiceFields :menu="compact" :provider="profile.provider" :model="model" :reasoning="profile.reasoning ?? 'default'" :disabled="busy" :active="active" @catalog-ready="emit('catalogReady')" @model-select="value => commit('model', value)" @change="save" />
    </div>
    <div v-if="pendingProvider" class="picker-confirm" role="group" aria-label="Confirm provider change">
      <p>Changing provider may send this conversation history to {{ pendingProvider }}. Continue?</p>
      <button type="button" data-cancel-provider @click="cancelProvider">Cancel</button>
      <button type="button" @click="confirmProvider">Change provider</button>
    </div>
    <p v-if="busy" role="status">Saving…</p>
    <template v-if="error"><p role="alert">{{ error }}</p><button @click="compare">Compare latest choices</button></template>
  </fieldset>
</template>
