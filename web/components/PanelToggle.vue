<script setup lang="ts">
import { nextTick } from 'vue';
import { design } from '../design';
async function toggle() { design.sidebar = design.sidebar === 'expanded' ? 'focus' : 'expanded'; await nextTick(); document.querySelector<HTMLButtonElement>('.panel-toggle')?.focus(); }
</script>
<template><button class="panel-toggle" :aria-expanded="design.sidebar === 'expanded'" aria-controls="agent-sidebar" :aria-label="design.sidebar === 'expanded' ? 'Collapse sidebar into Focus' : 'Expand sidebar'" @click="toggle"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg></button></template>
