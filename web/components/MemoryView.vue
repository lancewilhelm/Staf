<script setup lang="ts">
import DisclosureSummary from './DisclosureSummary.vue';
import { computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { Memory, MemoryScope } from '../../src/memory-types';
import { useWorkspace } from '../workspace';

const props = defineProps<{scope: MemoryScope; backLabel: string}>();
const emit = defineEmits<{back: []; shared: []}>();
const { app, state: workspace } = useWorkspace();
type MemoryState = {kind: 'loading'} | {kind: 'loaded'; entries: Memory[]} | {kind: 'error'};
const state = shallowRef<MemoryState>({kind: 'loading'});
const page = ref(0);
const pageSize = 20;
const heading = ref<HTMLHeadingElement | null>(null);
const pageStatus = ref<HTMLParagraphElement | null>(null);
const agent = computed(() => {
  const scope = props.scope;
  return scope.kind === 'bot' ? workspace.value.bots.find(agent => agent.id === scope.botId) : undefined;
});
const title = computed(() => props.scope.kind === 'user' ? 'User memory' : `${agent.value?.name ?? 'Agent'}’s memory`);
const entries = computed(() => state.value.kind === 'loaded' ? state.value.entries : []);
const pageCount = computed(() => Math.ceil(entries.value.length / pageSize));
const visible = computed(() => entries.value.slice(page.value * pageSize, (page.value + 1) * pageSize));
let request: AbortController | undefined;
async function load() {
  request?.abort();
  const current = new AbortController();
  request = current;
  state.value = {kind: 'loading'};
  page.value = 0;
  try {
    const entries = await app.memories(props.scope, current.signal);
    if (!current.signal.aborted) state.value = {kind: 'loaded', entries};
  } catch {
    if (!current.signal.aborted) state.value = {kind: 'error'};
  }
}
async function changePage(delta: number) {
  page.value = Math.max(0, Math.min(pageCount.value - 1, page.value + delta));
  await nextTick();
  pageStatus.value?.focus();
}
watch(() => props.scope.kind === 'user' ? 'user' : 'bot/' + props.scope.botId, () => { void load(); }, {immediate: true});
onScopeDispose(() => { request?.abort(); });
onMounted(() => { heading.value?.focus(); });
</script>

<template>
  <div class="settings-scroll"><div class="setup settings-content memory-view">
    <span class="eyebrow">{{ scope.kind === 'user' ? 'USER SETTINGS' : 'AGENT SETTINGS' }}</span>
    <h1 ref="heading" class="page-title" tabindex="-1">{{ title }}</h1>
    <p class="memory-audience badge">{{ scope.kind === 'user' ? 'Available to all your agents' : `Available only to ${agent?.name ?? 'this agent'}` }}</p>
    <p v-if="agent?.archived" class="meta">This agent is archived. Its memory is retained for inspection.</p>
    <p class="page-intro">Inspect saved memory. Retrieval is selective: relevant entries may be sent to the selected provider.</p>
    <p class="meta">Staf does not classify sensitive memories or require approval for agent-memory saves and updates. Review what the agent saves. Deleting a memory does not erase conversation or action history, backups, in-flight work, or information already sent to a provider.</p>
    <div class="row memory-actions">
      <button class="quiet" @click="emit('back')">{{ backLabel }}</button>
      <button v-if="scope.kind === 'bot'" class="quiet shared-memory-link" @click="emit('shared')">View shared user memory</button>
      <button class="quiet" :disabled="state.kind === 'loading'" @click="load">Refresh memory</button>
    </div>
    <p v-if="state.kind === 'loading'" role="status">Loading memory…</p>
    <div v-else-if="state.kind === 'error'" role="alert">
      <p>Could not load memory. Check your connection and access, then try again.</p>
      <button @click="load">Retry loading memory</button>
    </div>
    <template v-else>
      <p v-if="!entries.length" role="status">{{ scope.kind === 'user' ? 'No shared user memories saved yet. Memories saved here are available to all your agents.' : 'No memories saved for this agent yet. This list contains only this agent’s memory.' }}</p>
      <template v-else>
        <p ref="pageStatus" class="meta memory-page-status" role="status" tabindex="-1">Showing {{ page * pageSize + 1 }}–{{ Math.min((page + 1) * pageSize, entries.length) }} of {{ entries.length }} memories. Page {{ page + 1 }} of {{ pageCount }}.</p>
        <ul class="memory-list" aria-label="Saved memories">
          <li v-for="entry in visible" :key="entry.id" class="memory-entry">
            <p class="memory-text">{{ entry.text }}</p>
            <p class="meta">Updated <time :datetime="entry.updatedAt" :title="entry.updatedAt">{{ new Date(entry.updatedAt).toLocaleString() }}</time></p>
            <details><DisclosureSummary>Entry details</DisclosureSummary><dl>
              <dt>ID</dt><dd><code>{{ entry.id }}</code></dd>
              <dt>Version</dt><dd>{{ entry.version }}</dd>
              <dt>Created</dt><dd><time :datetime="entry.createdAt">{{ new Date(entry.createdAt).toLocaleString() }}</time></dd>
              <dt>Origin</dt><dd>Not recorded</dd>
            </dl></details>
          </li>
        </ul>
        <nav v-if="pageCount > 1" class="row" aria-label="Memory pages">
          <button class="quiet" :disabled="page === 0" @click="changePage(-1)">Previous page</button>
          <button class="quiet" :disabled="page + 1 >= pageCount" @click="changePage(1)">Next page</button>
        </nav>
      </template>
    </template>
  </div></div>
</template>
