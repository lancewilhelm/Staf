<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkspace } from '../workspace';
import type { ChatWork, InboxItem } from '../controller';
import ApprovalItem from './ApprovalItem.vue';
const { app: controller } = useWorkspace();
const outputs = ref<Record<string,string>>({});
const cursors = ref<Record<string,{next:number;more:boolean}>>({});
const input=ref<Record<string,string>>({}),cols=ref<Record<string,number>>({}),rows=ref<Record<string,number>>({});
async function sendInput(id:string){try{await controller.processInput(id,(input.value[id]??'')+'\n');input.value[id]='';await showOutput(id);}catch{outputs.value[id]='Could not submit input.';}}
async function endInput(id:string){try{await controller.processEof(id);await showOutput(id);}catch{outputs.value[id]='Could not send EOF.';}}
async function resize(id:string){try{await controller.resizeProcess(id,cols.value[id]??80,rows.value[id]??24);}catch{outputs.value[id]='Could not resize terminal.';}}
async function showOutput(id:string,append=false) { try { const page=await controller.processOutput(id,append ? cursors.value[id]?.next ?? 0 : 0);outputs.value[id]=(append ? outputs.value[id] ?? '' : '')+(page.gap?'Earlier output expired.\n':'')+page.chunks.map(chunk=>`[${chunk.stream}] ${chunk.text ?? '[binary or incomplete UTF-8 chunk; see base64 output in API]'} `).join('');cursors.value[id]={next:page.nextCursor,more:page.hasMore}; } catch {outputs.value[id]='Could not load output.';} }
const props = defineProps<{work: ChatWork | undefined; inbox: InboxItem[]}>();
const approvals = computed(() => props.inbox.filter(item => item.kind === 'approval' && item.work.kind === 'command' && item.work.id === props.work?.id));
const calls = computed(() => {
  const rows: Array<{key:string;name:string;start:string|null;result:string|null;success:number|null;done:boolean}> = [];
  const byId = new Map<string,number>();
  for (const event of props.work?.events ?? []) {
    const index = event.callId ? byId.get(event.callId) : undefined;
    if (event.type === 'tool_result' && index !== undefined) {
      const row = rows[index];
      if (row && !row.done) { row.done=true;row.success=event.success;row.result=event.detail;continue; }
    }
    const row={key:event.callId ?? `legacy-${event.id}`,name:event.name,start:event.type==='tool_start'?event.arguments:null,result:event.type==='tool_result'?event.detail:null,success:event.success,done:event.type==='tool_result'};
    if (event.type==='tool_start' && event.callId && !byId.has(event.callId)) byId.set(event.callId,rows.length);
    rows.push(row);
  }
  return rows;
});
</script>

<template>
  <div v-if="work" class="chat-work" aria-label="Agent work">
    <details v-for="call in calls" :key="call.key" class="tool-call">
      <summary>{{ call.name }} · {{ !call.done ? (['accepted','running','stopping'].includes(work.progress.state) ? 'Requested' : 'No result') : call.success ? 'Succeeded' : 'Failed' }}</summary>
      <template v-if="call.start !== null"><p>Arguments</p><pre>{{ call.start }}</pre></template>
      <template v-if="call.result !== null"><p>Result</p><pre>{{ call.result }}</pre></template>
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
      <p v-if="process.retained">Retained {{ process.mode }} process</p>
      <template v-if="['starting','running'].includes(process.state) && !process.inputClosed">
        <label :for="'process-input-'+process.id">Input</label>
        <textarea :id="'process-input-'+process.id" v-model="input[process.id]" rows="2" />
        <button type="button" @click="sendInput(process.id)">Send line</button>
        <button type="button" @click="endInput(process.id)">{{ process.mode==='pty'?'Send Ctrl-D':'Close input' }}</button>
        <template v-if="process.mode==='pty'">
          <label>Columns <input v-model.number="cols[process.id]" type="number" min="1" max="1000" :placeholder="String(process.cols??80)"></label>
          <label>Rows <input v-model.number="rows[process.id]" type="number" min="1" max="1000" :placeholder="String(process.rows??24)"></label>
          <button type="button" @click="resize(process.id)">Resize terminal</button>
        </template>
      </template>
      <button v-if="['starting','running','stopping'].includes(process.state)" type="button" @click="controller.stopProcess(process.id)">Stop process</button>
      <button type="button" @click="showOutput(process.id)">Refresh output</button>
      <button v-if="cursors[process.id]?.more" type="button" @click="showOutput(process.id,true)">More output</button>
    </details>
    <ApprovalItem v-for="item in approvals" :key="item.id" :item="item" />
  </div>
</template>
