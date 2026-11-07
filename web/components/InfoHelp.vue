<script setup lang="ts">
import { ref, useId } from 'vue';
import { Info } from '@lucide/vue';
defineProps<{label:string; text:string; disabled?:boolean}>();
const open=ref(false), id=useId();
</script>
<template>
  <span class="info-help" :data-open="open"><button type="button" :disabled="disabled" :aria-label="label" :aria-describedby="id" :aria-expanded="open" @click="open=!open" @keydown.esc="open=false"><Info :size="16" :stroke-width="2" aria-hidden="true" focusable="false" /></button><span :id="id" role="note">{{ text }}</span></span>
</template>
