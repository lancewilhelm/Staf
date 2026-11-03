<script setup lang="ts">
import { onMounted, ref, shallowRef, watch } from 'vue';
import type { Controller } from '../controller';
import { useWorkspace } from '../workspace';
import ChoiceFields from './ChoiceFields.vue';
const { app } = useWorkspace();
const state = shallowRef<Awaited<ReturnType<Controller['providerDefaults']>> | null>(null);
const provider = ref('codex');
const model = ref('');
const reasoning = ref('default');
const status = ref('');
onMounted(async () => {
  try {
    const value = await app.providerDefaults();
    state.value = value;
    model.value = value.providers[provider.value]?.model ?? '';
    reasoning.value = value.providers[provider.value]?.reasoning ?? 'default';
  } catch (error) { status.value = String(error); }
});
watch(provider, () => {
  const pair = state.value?.providers[provider.value];
  model.value = pair?.model ?? '';
  reasoning.value = pair?.reasoning ?? 'default';
});
function change(field: 'provider' | 'model' | 'reasoning', value: string) {
  if (field === 'provider') provider.value = value;
  else if (field === 'model') model.value = value;
  else reasoning.value = value;
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
  <section aria-label="Provider defaults">
    <h2>Provider defaults</h2><p>Used on first selection. Existing agents keep their choices.</p>
    <ChoiceFields :provider="provider" :model="model" :reasoning="reasoning" @change="change" />
    <div class="row provider-default-actions"><button :disabled="!state" @click="save">Save provider defaults</button><button class="quiet" @click="compare">Compare latest defaults</button></div>
    <p role="status">{{ status }}</p>
  </section>
</template>
