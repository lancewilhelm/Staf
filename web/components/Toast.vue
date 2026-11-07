<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { X } from '@lucide/vue';
import type { ToastNotice } from '../toast-notice';
const props = defineProps<{notice: ToastNotice}>();
const emit = defineEmits<{dismiss: [id: string]}>();
const duration = 6000;
let remaining = duration;
const progress = ref(100);
const hovered = ref(false);
const focused = ref(false);
watchEffect(onCleanup => {
  if (props.notice.kind === 'error' || hovered.value || focused.value) return;
  let last = performance.now();
  const timer = window.setInterval(() => {
    const now = performance.now();
    remaining = Math.max(0, remaining - (now - last));
    last = now;
    progress.value = remaining / duration * 100;
    if (remaining === 0) emit('dismiss', props.notice.id);
  }, 50);
  onCleanup(() => window.clearInterval(timer));
});
function blur(event: FocusEvent) {
  if (event.currentTarget instanceof HTMLElement && !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) focused.value = false;
}
</script>

<template>
  <div class="toast" :data-kind="notice.kind" :data-paused="hovered || focused"
    @mouseenter="hovered = true" @mouseleave="hovered = false" @focusin="focused = true" @focusout="blur">
    <p :role="notice.kind === 'error' ? 'alert' : 'status'">{{ notice.message }}</p>
    <button class="quiet toast-dismiss" aria-label="Dismiss notification" @click="emit('dismiss', notice.id)"><X :size="16" aria-hidden="true" focusable="false" /></button>
    <div v-if="notice.kind !== 'error'" class="toast-progress" role="progressbar" aria-label="Time remaining" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="Math.round(progress)">
      <span :style="{width: progress + '%'}" />
    </div>
  </div>
</template>
