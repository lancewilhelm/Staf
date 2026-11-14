<script setup lang="ts">
import type { InboxItem } from '../controller';
import { useWorkspace } from '../workspace';
defineProps<{item: Extract<InboxItem,{kind:'approval'|'question'}>}>();
const { app } = useWorkspace();
const descriptions = {
  shell: 'Commands, output, and unknown secrets may be retained in chat and backups. The Docker daemon and image must be trusted.',
  search: 'The configured search backend may retain and forward this exact query. Queries and results may be retained in chat and backups.',
  web: 'This allows the exact public URL shown. Each redirect requires a separate approval. URLs and source text may be retained in chat and backups.',
  disclosure: 'Review the exact sender, recipient, and message before allowing disclosure.',
  clock: 'This allows one UTC clock read.',
};
</script>

<template>
  <article class="item">
    <strong>{{ item.kind === 'question' ? 'Owner input needed' : item.approvalKind + ' approval' }}</strong>
    <template v-if="item.kind === 'question'">
      <p>{{ item.text }}</p><p class="meta">Task {{ item.attemptId }} · Question {{ item.id }}</p>
      <p class="meta">Replying to task questions in the workspace is not available yet.</p>
    </template>
    <template v-else>
      <p class="meta">{{ item.work.kind }} {{ item.work.id }}</p>
      <p>{{ descriptions[item.approvalKind] }}</p>
      <pre>{{ typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail, null, 2) }}</pre>
      <div class="row"><button @click="app.decide(item, 'approve')">Approve once</button><button class="quiet" @click="app.decide(item, 'deny')">Deny</button></div>
    </template>
  </article>
</template>
