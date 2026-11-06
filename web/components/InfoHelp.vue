<script setup lang="ts">
import { ref, useId } from 'vue';
defineProps<{label:string; text:string; disabled?:boolean}>();
const open=ref(false), id=useId();
</script>
<template>
  <span class="info-help" :data-open="open"><button type="button" :disabled="disabled" :aria-label="label" :aria-describedby="id" :aria-expanded="open" @click="open=!open" @keydown.esc="open=false">i</button><span :id="id" role="note">{{ text }}</span></span>
</template>
