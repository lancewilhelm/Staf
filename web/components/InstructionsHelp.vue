<script setup lang="ts">
import InfoHelp from './InfoHelp.vue';
defineProps<{disabled?:boolean}>();
</script>
<template><InfoHelp :disabled="disabled" class="instructions-help" label="About Instructions" text="Instructions are standing guidance for the agent's personality, role, and behavior. They populate the agent's soul.md document and are optional." /></template>
