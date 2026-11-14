<script setup lang="ts">
import {ref} from 'vue';
import {useWorkspace} from '../workspace';
const {app,state}=useWorkspace();
type Review=Awaited<ReturnType<typeof app.outputReview>>;
const selected=ref(''),review=ref<Review|null>(null),reviewedAgent=ref(''),confirming=ref(false),busy=ref(false),status=ref('');
async function inspect(){if(!selected.value)return;busy.value=true;status.value='';review.value=null;confirming.value=false;try{const id=selected.value,result=await app.outputReview(id);if(selected.value===id){reviewedAgent.value=id;review.value=result;}}catch{status.value='Could not verify output status. Refresh and try again.';}finally{busy.value=false;}}
async function startFresh(){const result=review.value,id=reviewedAgent.value;if(!result || !id)return;busy.value=true;try{await app.startFreshAfterOutput(id,result.version);review.value=null;confirming.value=false;status.value='Fresh agent created. Select it in the agent list; its history and permissions are separate.';}catch{review.value=null;confirming.value=false;status.value='The review changed or creation failed. Review the current status again.';}finally{busy.value=false;}}
</script>
<template>
 <section class="settings-section" aria-label="Output safety review">
  <h2 class="section-title">Output safety review</h2>
  <p>Review whether older tool output can be reused after a secret changed. The listed actions may be related; the available record does not identify the exact output. Captured output is not shown.</p>
  <label>Agent <select v-model="selected" @change="review=null;confirming=false"><option value="">Choose an agent</option><option v-for="bot in state.bots" :key="bot.id" :value="bot.id">{{ bot.name }}</option></select></label>
  <button class="quiet" :disabled="!selected || busy" @click="inspect">Review output status</button>
  <div v-if="review">
   <p>Agent output: {{ review.agent }}. Shared output: {{ review.shared }}.</p>
   <p v-if="review.archived">Restore the agent before reviewing a fresh-agent option.</p>
   <p v-if="review.active">The agent has active work or a process. Stop or settle it before starting a fresh agent.</p>
   <p v-if="review.uncertain">An action outcome is pending or uncertain. Inspect and reconcile it before starting a fresh agent; Staf will not replay it.</p>
   <p v-if="review.shared==='stale' || review.shared==='unknown'">Shared output cannot be safely isolated or cleared with the current evidence. Recovery remains unavailable.</p>
   <p v-if="review.agent==='unknown'">The agent's output history cannot be verified. Recovery remains unavailable.</p>
   <p v-if="!review.defaultsAvailable">Set creation defaults before starting a fresh agent.</p>
   <ul v-if="review.actions.length"><li v-for="action in review.actions" :key="action.actionId">{{ action.workKind }} {{ action.workId || '(work ID unavailable)' }} · {{ action.capability }} · {{ action.state }} · {{ action.actionId }}</li></ul>
   <p v-if="review.truncated">Only some recent actions are shown.</p>
   <div v-if="review.sharedActions.length"><p>Recent shared actions may be related; their exact connection to the fence is not known.</p><ul><li v-for="action in review.sharedActions" :key="action.actionId">Agent {{ action.agentId || 'unavailable' }} · {{ action.workKind }} {{ action.workId || '(work ID unavailable)' }} · {{ action.capability }} · {{ action.state }} · {{ action.actionId }}</li></ul></div>
   <p v-if="review.sharedTruncated">Only some recent shared actions are shown.</p>
   <button v-if="review.canStartFresh && !confirming" :disabled="busy" @click="confirming=true">Start a separate fresh agent</button>
   <div v-if="confirming"><p>The new agent uses current creation defaults and starts without this agent's conversation, tasks, or integration permissions. The original agent, its history, and its unresolved actions remain unchanged.</p><button :disabled="busy" @click="startFresh">Confirm fresh agent</button><button class="quiet" :disabled="busy" @click="confirming=false">Cancel</button></div>
  </div>
  <p role="status">{{ status }}</p>
 </section>
</template>
