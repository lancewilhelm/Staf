<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '../markdown';
const props = defineProps<{text: string}>();
const html = computed(() => renderMarkdown(props.text));
async function copyCode(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('.code-block > button');
  if (!(button instanceof HTMLButtonElement)) return;
  const code = button.parentElement?.querySelector('pre code')?.textContent ?? '';
  try { await navigator.clipboard.writeText(code); button.textContent = 'Copied'; }
  catch { button.textContent = 'Copy failed'; }
}
</script>

<template>
  <div class="bottext markdown" @click="copyCode" v-html="html" />
</template>
