<script setup lang="ts">
import { ChevronDown } from '@lucide/vue';
</script>

<template>
  <span class="select-control"><slot /><ChevronDown class="select-chevron" :size="16" aria-hidden="true" focusable="false" /></span>
</template>
