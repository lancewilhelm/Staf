<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkspace } from '../workspace';
import type { ChatWork, InboxItem } from '../controller';
import ApprovalItem from './ApprovalItem.vue';
const { app: controller } = useWorkspace();
const outputs = ref<Record<string,string>>({});
const cursors = ref<Record<string,{next:number;more:boolean}>>({});
async function showOutput(id:string,append=false) { try { const page=await controller.processOutput(id,append ? cursors.value[id]?.next ?? 0 : 0);outputs.value[id]=(append ? outputs.value[id] ?? '' : '')+(page.gap?'Earlier output expired.\n':'')+page.chunks.map(chunk=>`[${chunk.stream}] ${chunk.text ?? '[binary or incomplete UTF-8 chunk; see base64 output in API]'} `).join('');cursors.value[id]={next:page.nextCursor,more:page.hasMore}; } catch {outputs.value[id]='Could not load output.';} }
const props = defineProps<{work: ChatWork | undefined; inbox: InboxItem[]}>();
const approvals = computed(() => props.inbox.filter(item => item.kind === 'approval' && item.work.kind === 'command' && item.work.id === props.work?.id));
</script>

<template>
  <div v-if="work" class="chat-work" aria-label="Agent work">
    <details v-for="event in work.events" :key="event.id">
      <summary>{{ event.name }} · {{ event.type === 'tool_start' ? 'Requested' : event.success ? 'Succeeded' : 'Failed' }}</summary>
      <pre v-if="event.detail">{{ event.detail }}</pre>
    </details>
    <details v-for="execution in work.codeExecutions" :key="execution.id">
      <summary>Code execution · {{ execution.outcome }}</summary>
      <p>Source</p><pre>{{ execution.source }}</pre>
      <p>Result</p><pre>{{ JSON.stringify(execution.result, null, 2) }}</pre>
      <p v-if="execution.actions.length">Action IDs: {{ execution.actions.join(', ') }}</p>
    </details>
    <details v-for="process in work.processes" :key="process.id" @toggle="showOutput(process.id)">
      <summary>Process · {{ process.state }}<template v-if="process.exitCode !== null"> · exit {{ process.exitCode }}</template><template v-if="process.exitSignal"> · {{ process.exitSignal }}</template></summary>
      <p>{{ process.id }}</p><pre>{{ outputs[process.id] }}</pre>
      <button v-if="['starting','running','stopping'].includes(process.state)" type="button" @click="controller.stopProcess(process.id)">Stop process</button>
      <button type="button" @click="showOutput(process.id)">Refresh output</button>
      <button v-if="cursors[process.id]?.more" type="button" @click="showOutput(process.id,true)">More output</button>
    </details>
    <ApprovalItem v-for="item in approvals" :key="item.id" :item="item" />
    <div v-if="work.events.length" class="meta">{{ approvals.length ? 'Waiting for approval' : work.progress.state === 'running' ? 'Working' : work.progress.state }}</div>
  </div>
</template>
