<script setup lang="ts">
import { useId } from 'vue';
import type { AgentImageInput } from '../../src/agent-image';
import type { ToolMode } from '../../src/tool-mode';
import AgentImageChooser from './AgentImageChooser.vue';
import ChoiceFields from './ChoiceFields.vue';
import InstructionsHelp from './InstructionsHelp.vue';
import ToolModeSelect from './ToolModeSelect.vue';

defineProps<{name:string; image:AgentImageInput; instructions:string; toolMode:ToolMode|''; provider:string; model:string; reasoning:string; disabled:boolean; creating:boolean}>();
const instructionsId=useId();
const emit=defineEmits<{name:[value:string]; image:[value:AgentImageInput]; instructions:[value:string]; toolMode:[value:ToolMode|'']; choice:[field:'provider'|'model'|'reasoning',value:string]; valid:[value:boolean]}>();
function input(field:'name'|'instructions',event:Event){if(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)field==='name'?emit('name',event.target.value):emit('instructions',event.target.value)}
</script>
<template>
  <label>Name<input :value="name" :disabled="disabled" @input="input('name',$event)" /></label>
  <AgentImageChooser :model-value="image" :name="name" :disabled="disabled" @update:model-value="value=>emit('image',value)" @valid="value=>emit('valid',value)" />
  <div class="editor-label"><label :for="instructionsId">Instructions</label><InstructionsHelp :disabled="disabled" /></div>
  <textarea :id="instructionsId" :value="instructions" :disabled="disabled" @input="input('instructions',$event)" />
  <ToolModeSelect :model-value="toolMode" :allow-default="creating" :disabled="disabled" @update:model-value="value=>emit('toolMode',value)" />
  <ChoiceFields :reset-unsupported="creating" :provider="provider" :model="model" :reasoning="reasoning" :disabled="disabled" @change="(field,value)=>emit('choice',field,value)" />
</template>
