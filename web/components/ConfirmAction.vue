<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
defineProps<{title: string; message: string; action: string}>();
const emit = defineEmits<{cancel: []; confirm: []}>();
const dialog = ref<HTMLDialogElement | null>(null);
let previous: Element | null = null;
onMounted(async () => {
  previous = document.activeElement;
  dialog.value?.showModal();
  await nextTick();
  dialog.value?.querySelector<HTMLButtonElement>('.quiet')?.focus();
});
onUnmounted(() => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); });
</script>

<template>
  <dialog ref="dialog" class="modal setup" aria-labelledby="confirm-title" aria-describedby="confirm-message" @cancel.prevent="emit('cancel')">
    <div class="modal-head"><h2 id="confirm-title">{{ title }}</h2></div>
    <p id="confirm-message">{{ message }}</p>
    <div class="row modal-footer"><button class="quiet" @click="emit('cancel')">Cancel</button><button @click="emit('confirm')">{{ action }}</button></div>
  </dialog>
</template>
