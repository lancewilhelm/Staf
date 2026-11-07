<script setup lang="ts">
import { ChevronRight } from '@lucide/vue';
</script>

<template>
  <summary class="disclosure-summary"><ChevronRight class="disclosure-chevron" :size="14" aria-hidden="true" focusable="false" /><span class="disclosure-label"><slot /></span></summary>
</template>
