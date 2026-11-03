<script setup lang="ts">
import { computed } from 'vue';
import type { ChatWork, InboxItem } from '../controller';
import ApprovalItem from './ApprovalItem.vue';
const props = defineProps<{work: ChatWork | undefined; inbox: InboxItem[]}>();
const approvals = computed(() => props.inbox.filter(item => item.kind === 'approval' && item.work.kind === 'command' && item.work.id === props.work?.id));
</script>

<template>
  <div v-if="work" class="chat-work" aria-label="Agent work">
    <details v-for="event in work.events" :key="event.id">
      <summary>{{ event.name }} · {{ event.type === 'tool_start' ? 'Requested' : event.success ? 'Succeeded' : 'Failed' }}</summary>
      <pre v-if="event.detail">{{ event.detail }}</pre>
    </details>
    <ApprovalItem v-for="item in approvals" :key="item.id" :item="item" />
    <div v-if="work.events.length" class="meta">{{ approvals.length ? 'Waiting for approval' : work.progress.state === 'running' ? 'Working' : work.progress.state }}</div>
  </div>
</template>
