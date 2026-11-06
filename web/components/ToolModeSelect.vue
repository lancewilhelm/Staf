<script setup lang="ts">
import { useId } from 'vue';
import type {ToolMode} from '../../src/tool-mode';
import InfoHelp from './InfoHelp.vue';
defineProps<{modelValue:ToolMode|'';disabled?:boolean;allowDefault?:boolean}>();
const modeId=useId();
const emit=defineEmits<{'update:modelValue':[value:ToolMode|'']}>();
function change(event:Event){if(event.target instanceof HTMLSelectElement){const value=event.target.value;if(value===''||value==='direct'||value==='hybrid'||value==='code')emit('update:modelValue',value)}}
</script>
<template>
  <div class="editor-label"><label :for="modeId">Tool mode</label><InfoHelp :disabled="disabled" label="About Tool mode" text="Direct calls tools individually. Hybrid also offers code execution. Code Mode calls available tools through JavaScript. All three use the same capabilities and permissions." /></div>
  <select :id="modeId" :value="modelValue" :disabled="disabled" @change="change"><option v-if="allowDefault" value="">Use creation default</option><option value="direct">Direct</option><option value="hybrid">Hybrid</option><option value="code">Code Mode</option></select>
</template>
