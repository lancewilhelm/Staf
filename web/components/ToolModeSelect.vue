<script setup lang="ts">
import type {ToolMode} from '../../src/tool-mode';
defineProps<{modelValue:ToolMode|'';disabled?:boolean;allowDefault?:boolean}>();
const emit=defineEmits<{'update:modelValue':[value:ToolMode|'']}>();
function change(event:Event){if(event.target instanceof HTMLSelectElement){const value=event.target.value;if(value===''||value==='direct'||value==='hybrid'||value==='code')emit('update:modelValue',value)}}
</script>
<template>
  <label>Tool mode<select :value="modelValue" :disabled="disabled" @change="change"><option v-if="allowDefault" value="">Use creation default</option><option value="direct">Direct</option><option value="hybrid">Hybrid</option><option value="code">Code Mode</option></select></label>
  <p class="meta">Chat offers clock directly in Direct, both clock and code in Hybrid, and code in Code Mode. Code currently calls clock; other existing tools and background tasks are not yet adapted.</p>
</template>
