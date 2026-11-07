<script setup lang="ts">
import { nextTick } from 'vue';
import { PanelLeftClose, PanelLeftOpen } from '@lucide/vue';
import { design } from '../design';
defineProps<{disabled?: boolean}>();
async function toggle() { design.sidebar = design.sidebar === 'expanded' ? 'focus' : 'expanded'; await nextTick(); document.querySelector<HTMLButtonElement>('.panel-toggle')?.focus(); }
</script>
<template><button class="panel-toggle" :disabled="disabled" :aria-expanded="design.sidebar === 'expanded'" aria-controls="agent-sidebar" :aria-label="design.sidebar === 'expanded' ? 'Collapse sidebar into Focus' : 'Expand sidebar'" @click="toggle"><PanelLeftClose v-if="design.sidebar === 'expanded'" :size="18" aria-hidden="true" focusable="false" /><PanelLeftOpen v-else :size="18" aria-hidden="true" focusable="false" /></button></template>
