<script setup lang="ts">
import UiIcon from './UiIcon.vue';
import { providerLabel } from '../provider-label';
import { computed, onMounted, ref, shallowRef, useId, watch } from 'vue';
import type { ModelCatalog } from '../controller';
import { useWorkspace } from '../workspace';
const props = withDefaults(defineProps<{provider: string; model: string; reasoning: string; disabled?: boolean; resetUnsupported?: boolean; menu?: boolean; active?: boolean; realOnly?: boolean}>(), {disabled: false, resetUnsupported: false, active: true});
const emit = defineEmits<{change: [field: 'provider' | 'model' | 'reasoning', value: string]; modelSelect: [value: string]; catalogReady: []}>();
const { app } = useWorkspace();
const providers = ['codex', 'openrouter', 'lmstudio', 'live'];
const catalog = shallowRef<ModelCatalog | null>(null);
const status = ref('');
const failed = ref(false);
const list = useId();
let discovery = 0;
watch(() => props.provider, () => { discovery++; catalog.value = null; status.value = ''; failed.value = false; if (props.active) void discover(); });
watch(() => props.active, active => { if (active) void discover(); else discovery++; });
onMounted(() => { if (props.active) void discover(); });
const menuModels = computed(() => {
  const models = catalog.value?.models.map(item => ({id: item.id, label: item.label})) ?? [];
  return props.model && !models.some(item => item.id === props.model) ? [{id: props.model, label: props.model}, ...models] : models;
});
function selectModel(value: string) {
  emit('change', 'model', value);
  if (props.resetUnsupported) {
    const info = catalog.value?.models.find(item => item.id === value);
    if (info?.reasoningStatus === 'advertised' && props.reasoning && props.reasoning !== 'default' && !info.reasoning?.includes(props.reasoning)) {
      emit('change', 'reasoning', 'default');
      status.value = 'Reasoning changed to Automatic for this model.';
    }
  }
}
function pickModel(value: string) { selectModel(value); emit('modelSelect', value); }
async function discover() {
  if (!props.provider) return;
  const request = ++discovery;
  const provider = props.provider;
  status.value = 'Loading models…'; failed.value = false;
  try {
    const found = await app.models(provider);
    if (request !== discovery || provider !== props.provider) return;
    catalog.value = found;
    status.value = found.models.length ? `${found.models.length} ${found.models.length === 1 ? 'model' : 'models'} loaded. Choose a listed model or enter an ID manually.` : 'No models were returned. Enter a model ID manually.';
    emit('catalogReady');
  } catch (error) { if (request === discovery && provider === props.provider) { catalog.value = null; failed.value = true; status.value = String(error); } }
}
const info = computed(() => catalog.value?.models.find(item => item.id === props.model));
const levels = computed(() => {
  const supported = !['codex', 'openrouter'].includes(props.provider) || info.value?.reasoningStatus === 'unsupported-transport'
    ? [] : info.value?.reasoningStatus === 'advertised' ? info.value.reasoning ?? [] : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  return [...new Set([...supported, ...(props.reasoning && props.reasoning !== 'default' ? [props.reasoning] : [])])];
});
function unavailable(level: string) {
  if (level === 'default') return false;
  if (!['codex', 'openrouter'].includes(props.provider) || info.value?.reasoningStatus === 'unsupported-transport') return true;
  return info.value?.reasoningStatus === 'advertised' && !info.value.reasoning?.includes(level);
}
function change(field: 'provider' | 'model' | 'reasoning', event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  emit('change', field, target.value);
  if (target instanceof HTMLSelectElement) target.value = field === 'provider' ? props.provider : props.reasoning || 'default';
}
function chooseListed(event: Event) {
  if (event.target instanceof HTMLSelectElement && event.target.value) pickModel(event.target.value);
}
function finishModel(event: FocusEvent) {
  if (!props.menu && event.target instanceof HTMLInputElement) selectModel(event.target.value);
}
function modelKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') { event.preventDefault(); if (event.currentTarget instanceof HTMLInputElement) event.currentTarget.blur(); }
}
</script>

<template>
  <fieldset class="provider-choices" :class="{'menu-choices': menu}" :disabled="disabled">
    <template v-if="menu">
      <div class="model-menu-group" role="group" aria-label="Provider"><div class="menu-caption">Provider</div>
        <button type="button" v-for="value in providers" :key="value" class="model-option" tabindex="-1" role="menuitemradio" :aria-checked="provider === value" :data-provider="value" @click="emit('change', 'provider', value)"><span>{{ providerLabel(value) }}</span><UiIcon v-if="provider === value" name="check" /></button>
      </div>
      <div class="model-menu-group" role="group" aria-label="Model"><div class="menu-caption">Model</div>
        <label class="menu-manual">Model ID<input :list="list" :value="model" placeholder="Choose or enter a model ID" @input="change('model', $event)" @keydown="modelKeydown" /><datalist :id="list"><option v-for="item in catalog?.models" :key="item.id" :value="item.id">{{ item.label }}</option></datalist></label>
        <button type="button" v-for="item in menuModels" :key="item.id" class="model-option" tabindex="-1" role="menuitemradio" :aria-checked="model === item.id" :data-model="item.id" @click="pickModel(item.id)"><span>{{ item.label }}</span><UiIcon v-if="model === item.id" name="check" /></button>
        <p class="model-discovery-status menu-note" role="status">{{ status }}</p><button v-if="failed" type="button" class="text-action" @click="discover">Retry model discovery</button>
      </div>
      <div class="model-menu-group" role="group" aria-label="Reasoning"><div class="menu-caption">Reasoning <span role="img" title="Automatic lets the provider choose its reasoning behavior." aria-label="Automatic lets the provider choose its reasoning behavior.">ⓘ</span></div>
        <button type="button" v-for="level in ['default', ...levels]" :key="level" class="model-option" tabindex="-1" role="menuitemradio" :aria-checked="(reasoning || 'default') === level" :data-reasoning="level" :disabled="unavailable(level)" @click="emit('change', 'reasoning', level)"><span>{{ level === 'default' ? 'Automatic' : level }}{{ unavailable(level) ? ' (not supported)' : '' }}</span><UiIcon v-if="(reasoning || 'default') === level" name="check" /></button>
      </div>
    </template>
    <template v-else>
    <legend>Provider, model and reasoning</legend>
    <label>Provider<select :value="provider" @change="change('provider', $event)">
      <option v-if="!provider" value="">Instance default</option>
      <option v-for="value in providers" :key="value" :value="value">{{ providerLabel(value) }}</option>
    </select></label>
    <label>Model<input :list="list" :value="model" placeholder="Choose or enter a model ID" @input="change('model', $event)" @blur="finishModel" @keydown="modelKeydown" />
      <datalist :id="list"><option v-for="item in catalog?.models" :key="item.id" :value="item.id">{{ item.label }}</option></datalist>
    </label>
    <label v-if="catalog && catalog.models.length > 0">Available models
      <select aria-label="Available models" :value="catalog.models.some(item => item.id === model) ? model : ''" @change="chooseListed">
        <option value="">Choose a listed model</option>
        <option v-for="item in catalog.models" :key="item.id" :value="item.id">{{ item.label === item.id ? item.id : `${item.label} (${item.id})` }}</option>
      </select>
    </label>
    <p class="model-discovery-status" role="status">{{ status }}</p><button v-if="failed" type="button" class="quiet" @click="discover">Retry model discovery</button>
    <label>Reasoning <span role="img" title="Automatic lets the provider choose its reasoning behavior." aria-label="Automatic lets the provider choose its reasoning behavior.">ⓘ</span><select aria-label="Reasoning" :value="reasoning || 'default'" @change="change('reasoning', $event)">
      <option value="default">Automatic</option>
      <option v-for="level in levels" :key="level" :value="level" :disabled="unavailable(level)">{{ level }}{{ unavailable(level) ? ' (not supported)' : '' }}</option>
    </select></label>
    </template>
  </fieldset>
</template>
