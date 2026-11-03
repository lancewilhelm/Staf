<script setup lang="ts">
defineProps<{name: 'plus' | 'gear' | 'close' | 'check' | 'down' | 'chevron'}>();
const paths = {plus:'M12 5v14M5 12h14',gear:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',close:'m6 6 12 12M6 18 18 6',check:'m5 12 4 4L19 6',down:'m6 9 6 6 6-6',chevron:'m9 6 6 6-6 6'};
</script>
<template><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name]" /></svg></template>
