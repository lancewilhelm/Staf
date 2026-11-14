<script setup lang="ts">
import {ref,watch} from 'vue';
import {useWorkspace} from '../workspace';
import type {SlackOutcomeReview} from '../controller';
const props=defineProps<{taskId:string;review:SlackOutcomeReview}>();
const {app}=useWorkspace();
const text=ref(props.review.text ?? props.review.outcome),confirmed=ref(false),busy=ref(false),error=ref('');
watch(()=>props.taskId,()=>{text.value=props.review.text ?? props.review.outcome;confirmed.value=false;error.value='';});
watch(text,()=>{confirmed.value=false;},{flush:'sync'});
watch(()=>[props.review.revision,props.review.available,props.review.teamId,props.review.userId,props.review.channelId,props.review.threadTs],()=>{confirmed.value=false;});
async function send(){if(props.review.revision===null || !confirmed.value)return;busy.value=true;error.value='';try{await app.sendSlackOutcome(props.taskId,text.value,props.review.revision);confirmed.value=false;}catch(e){error.value=String(e);}finally{busy.value=false;}}
</script>
<template>
 <section aria-label="Review Slack outcome" class="slack-outcome-review">
  <template v-if="review.state==='review' || review.state==='blocked'">
   <h3>Review outcome for Slack</h3>
   <p v-if="review.state==='blocked'" role="status">Slack access or the destination changed before sending. Review the current destination and text again.</p>
   <p>Slack destination: workspace {{ review.teamId }}, user {{ review.userId }}, channel {{ review.channelId }}<template v-if="review.threadTs">, original thread {{ review.threadTs }}</template>.</p>
   <p>Review the exact text below. Remove the task's questions and answers, including paraphrases and encoded details. Staf cannot reliably detect them.</p>
   <label :for="taskId+'-slack-outcome'">Text to send to Slack</label><textarea :id="taskId+'-slack-outcome'" v-model="text" :disabled="busy" />
   <label><input v-model="confirmed" type="checkbox" :disabled="busy"> I reviewed this exact text and destination and it contains no background questions or answers.</label>
   <p v-if="!review.gmailAvailable" role="status">Gmail task access changed. This outcome cannot be sent under the original task authority.</p>
   <p v-else-if="!review.available" role="status">Slack is unavailable or the original destination no longer matches. Restore access before sending.</p>
   <button type="button" :disabled="busy || !confirmed || !text.trim() || !review.available" @click="send">Send reviewed outcome</button>
   <p v-if="error" role="alert">{{ error }}</p>
  </template>
  <template v-else>
   <p v-if="review.state==='pending' || review.state==='sending'" role="status">The reviewed outcome is waiting for Slack delivery.</p>
   <p v-else-if="review.state==='sent'" role="status">The reviewed outcome was sent to Slack.</p>
   <p v-else-if="review.state==='uncertain'" role="status">Slack delivery is uncertain. Check the original thread; Staf will not resend automatically.</p>
   <p v-else role="status">Slack outcome: {{ review.state }}.</p>
   <p v-if="review.text">Reviewed text: {{ review.text }}</p>
  </template>
 </section>
</template>
