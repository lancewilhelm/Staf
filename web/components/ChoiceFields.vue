<script setup lang="ts">
import { computed, ref, shallowRef, useId, watch } from 'vue';
import type { ModelCatalog } from '../controller';
import { useWorkspace } from '../workspace';
const props = withDefaults(defineProps<{provider: string; model: string; reasoning: string; disabled?: boolean; resetUnsupported?: boolean}>(), {disabled: false, resetUnsupported: false});
const emit = defineEmits<{change: [field: 'provider' | 'model' | 'reasoning', value: string]; modelSelect: [value: string]}>();
const { app } = useWorkspace();
const providers = ['demo', 'codex', 'openrouter', 'lmstudio', 'live'];
const catalog = shallowRef<ModelCatalog | null>(null);
const status = ref('');
const list = useId();
let discovery = 0;
watch(() => props.provider, () => { discovery++; catalog.value = null; status.value = ''; });
async function discover() {
  const request = ++discovery;
  const provider = props.provider;
  status.value = 'Loading models…';
  try {
    const found = await app.models(provider);
    if (request !== discovery || provider !== props.provider) return;
    catalog.value = found;
    if (!props.model && found.defaultModel) {
      emit('change', 'model', found.defaultModel);
      emit('modelSelect', found.defaultModel);
    }
    status.value = found.models.length ? `${found.models.length} ${found.models.length === 1 ? 'model' : 'models'} loaded. Choose a listed model or enter an ID manually.` : 'No models were returned. Enter a model ID manually or try again.';
  } catch (error) { if (request === discovery) status.value = String(error); }
}
const info = computed(() => catalog.value?.models.find(item => item.id === props.model));
const levels = computed(() => {
  const known = info.value?.reasoningStatus === 'advertised';
  const values = known ? info.value?.reasoning ?? [] : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  return [...new Set([...values, ...(!known && props.reasoning && props.reasoning !== 'default' ? [props.reasoning] : [])])];
});
watch([info, () => props.reasoning], () => {
  if (props.resetUnsupported && info.value?.reasoningStatus === 'advertised' && props.reasoning && props.reasoning !== 'default' && !info.value.reasoning?.includes(props.reasoning)) {
    emit('change', 'reasoning', 'default');
    status.value = 'Reasoning changed to Provider default for this model.';
  }
});
function change(field: 'provider' | 'model' | 'reasoning', event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  emit('change', field, target.value);
  if (field === 'model' && catalog.value?.models.some(model => model.id === target.value)) emit('modelSelect', target.value);
  if (target instanceof HTMLSelectElement) target.value = field === 'provider' ? props.provider : props.reasoning || 'default';
}
function chooseListed(event: Event) {
  if (event.target instanceof HTMLSelectElement && event.target.value) {
    emit('change', 'model', event.target.value);
    emit('modelSelect', event.target.value);
  }
}
function modelKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') { event.preventDefault(); if (event.currentTarget instanceof HTMLInputElement) event.currentTarget.blur(); }
}
</script>

<template>
  <fieldset class="provider-choices" :disabled="disabled">
    <legend>Provider, model and reasoning</legend>
    <label>Provider<select :value="provider" @change="change('provider', $event)">
      <option v-if="!provider" value="">Instance default</option>
      <option v-for="value in providers" :key="value" :value="value">{{ value }}</option>
    </select></label>
    <label>Model<input :list="list" :value="model" placeholder="Choose or enter a model ID" @input="change('model', $event)" @keydown="modelKeydown" />
      <datalist :id="list"><option v-for="item in catalog?.models" :key="item.id" :value="item.id">{{ item.label }}</option></datalist>
    </label>
    <button class="quiet" @click="discover">List models</button>
    <label v-if="catalog && catalog.models.length > 0">Available models
      <select aria-label="Available models" :value="catalog.models.some(item => item.id === model) ? model : ''" @change="chooseListed">
        <option value="">Choose a listed model</option>
        <option v-for="item in catalog.models" :key="item.id" :value="item.id">{{ item.label === item.id ? item.id : `${item.label} (${item.id})` }}</option>
      </select>
    </label>
    <p class="model-discovery-status" role="status">{{ status }}</p>
    <label>Reasoning<select aria-label="Reasoning" :value="reasoning || 'default'" @change="change('reasoning', $event)">
      <option value="default">Provider default</option>
      <template v-if="['codex', 'openrouter'].includes(provider)"><option v-for="level in levels" :key="level" :value="level">{{ level }}</option></template>
    </select></label>
  </fieldset>
</template>
