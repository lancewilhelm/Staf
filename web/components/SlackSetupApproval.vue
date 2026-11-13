<script setup lang="ts">
import {computed,ref} from 'vue';
import type {InboxItem} from '../controller';
import {useWorkspace} from '../workspace';
const props=defineProps<{item:Extract<InboxItem,{kind:'slack-setup'}>}>();
const {app,state}=useWorkspace();
const busy=ref(false),error=ref('');
const agent=computed(()=>state.value.bots.find(bot=>bot.id===props.item.botId)?.name ?? 'Agent');
async function decide(decision:'confirm'|'dismiss') {
 busy.value=true;error.value='';
 try {await app.slackSetupDecision(props.item.id,decision,props.item.approval);}
 catch {error.value='Setup could not be completed. Refresh and review the current request before retrying.';}
 finally {busy.value=false;}
}
</script>
<template>
 <article class="item" aria-label="Slack setup approval">
  <strong>Review Slack setup for {{ agent }}</strong><p class="meta">Agent ID: {{ item.approval.config.botId }}</p>
  <p>Workspace {{ item.approval.config.teamId }} · User {{ item.approval.config.userId }} · DM {{ item.approval.config.channelId }}</p>
  <p>App token: {{ item.approval.app.name }} (version {{ item.approval.app.revision }})<br>Bot token: {{ item.approval.bot.name }} (version {{ item.approval.bot.revision }})</p>
  <p v-if="item.approval.authority.agentAccess!==null">Current access for this agent: {{ item.approval.authority.agentAccess ? 'allowed' : 'not allowed' }}.</p>
  <p>Approval permits these exact saved secret versions to be used for this destination at https://slack.com/api and the Slack-provided Socket Mode address at wss://slack.com or a slack.com subdomain, and permits this agent to use Slack.</p>
  <template v-if="item.state==='interrupted'"><p>Setup was interrupted. Review its status and start a new attempt; it will not reconnect automatically.</p><button type="button" class="quiet" :disabled="busy" @click="decide('dismiss')">Dismiss</button></template>
  <p v-else-if="item.state==='connecting'">Checking Slack connection…</p>
  <div v-else class="row"><button type="button" :disabled="busy" @click="decide('confirm')">Approve and connect</button><button type="button" class="quiet" :disabled="busy" @click="decide('dismiss')">Dismiss</button></div>
  <p v-if="error" role="alert">{{ error }}</p>
 </article>
</template>
