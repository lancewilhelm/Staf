<script setup lang="ts">
import { design } from '../design';
defineProps<{index?: number}>();
const shapes = [[[58,18],[82,18],[50,50],[18,82],[42,82]],[[50,14],[84.24,38.88],[71.16,79.12],[28.84,79.12],[15.76,38.88]],[[26,26],[74,26],[50,50],[26,74],[74,74]],[[14,74],[32,47],[50,20],[68,47],[86,74]],[[20,24],[20,76],[50,24],[50,76],[80,50]]];
</script>
<template><svg viewBox="0 0 100 100" aria-hidden="true"><circle v-for="([x,y], i) in shapes[index ?? design.logo]" :key="i" :cx="x" :cy="y" :r="[1,2].includes(index ?? design.logo) ? 11 : 10" fill="currentColor" /></svg></template>
