<script setup lang="ts">
const dots = [[50,14],[84.24,38.88],[71.16,79.12],[28.84,79.12],[15.76,38.88]];
</script>
<template><svg viewBox="0 0 100 100" aria-hidden="true"><circle v-for="([x,y], i) in dots" :key="i" :cx="x" :cy="y" r="11" fill="currentColor" /></svg></template>
