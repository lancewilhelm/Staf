<script setup lang="ts">
import { useWorkspace } from '../workspace';
import Toast from './Toast.vue';
import '../toasts.css';
const {app, state} = useWorkspace();
</script>

<template>
  <section class="toasts" aria-label="Notifications">
    <Toast v-for="notice in state.notices" :key="notice.id" :notice="notice" @dismiss="app.dismissNotice" />
  </section>
</template>
