<script setup lang="ts">
import {onScopeDispose, ref, watch} from 'vue';
import {useWorkspace} from '../workspace';
const props=defineProps<{botId:string}>();
const {app}=useWorkspace();
type Proposal=Awaited<ReturnType<typeof app.memoryProposals>>[number];
const proposals=ref<Proposal[]>([]),status=ref(''),busy=ref(false),loading=ref(true);
let request:AbortController|undefined;
async function load(){
  request?.abort();const current=new AbortController();request=current;loading.value=true;
  try{const items=await app.memoryProposals(props.botId,current.signal);if(!current.signal.aborted){proposals.value=items;loading.value=false;}}
  catch{if(!current.signal.aborted){proposals.value=[];loading.value=false;status.value='Could not load memory proposals.';}}
}
async function decide(item:Proposal,decision:'confirm'|'deny'){
  busy.value=true;status.value='';
  try{const result=await app.decideMemoryProposal(item.id,item.fingerprint,decision);await load();status.value=result.sharedConfirmationRequired?`Sensitive detail approved. Shared memory still requires confirmation in this agent chat: Confirm shared memory ${item.id}`:decision==='confirm'?'Memory proposal confirmed. Refresh the saved memory list to see the change.':'Memory proposal denied.';}
  catch{await load();status.value='Decision failed or is no longer current. Review the refreshed proposals before retrying.';}
  finally{busy.value=false;}
}
watch(()=>props.botId,()=>{proposals.value=[];status.value='';void load();},{immediate:true});
onScopeDispose(()=>request?.abort());
</script>
<template>
  <section aria-label="Memory proposals">
    <h2>Memory proposals</h2>
    <p>Review the exact text and audience before confirming. Proposals are stored in this instance until decided.</p>
    <button class="quiet" :disabled="busy || loading" @click="load">Refresh proposals</button>
    <p v-if="loading">Loading proposals…</p>
    <p v-else-if="!proposals.length">No pending proposals.</p>
    <ul v-else>
      <li v-for="item in proposals" :key="item.id">
        <p>{{ item.operation === 'create' ? 'Save' : 'Update' }} in {{ item.scope === 'user' ? 'shared user memory (all agents)' : 'this agent’s memory' }}</p>
        <p v-if="item.operation === 'update'">Entry {{ item.targetId }}, version {{ item.targetVersion }}</p>
        <p class="memory-text">{{ item.text }}</p>
        <button :disabled="busy" @click="decide(item,'confirm')">Confirm memory</button>
        <button class="quiet" :disabled="busy" @click="decide(item,'deny')">Deny memory</button>
      </li>
    </ul>
    <p v-if="status" role="status">{{ status }}</p>
  </section>
</template>
