<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspace } from '../workspace';
const {app, state: s} = useWorkspace();
const submission = computed(() => s.value.draft.submission);
const responding = computed(() => !!s.value.response && ['accepted', 'running', 'stopping'].includes(s.value.response.state));
</script>

<template>
  <div v-if="submission && !['submitting','pending'].includes(submission.kind)" class="submission" role="status">
    Message {{ submission.kind === 'uncertain-busy' ? 'busy' : submission.kind === 'submitting-uncertain' ? 'submitting' : submission.kind }}.
    {{ 'error' in submission ? submission.error : '' }} {{ submission.kind === 'unknown' ? 'Reconnecting to the original request.' : '' }}
    <div v-if="['busy', 'uncertain-busy', 'rejected', 'failed', 'interrupted'].includes(submission.kind)" class="row">
      <button class="quiet" :disabled="responding" @click="app.send(true)">Retry</button>
      <button v-if="submission.kind !== 'uncertain-busy'" class="quiet" @click="app.dismissSubmission()">Dismiss</button>
    </div>
  </div>
</template>
