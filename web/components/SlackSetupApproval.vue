<script setup lang="ts">
import {computed,ref} from 'vue';
import type {InboxItem} from '../controller';
import {useWorkspace} from '../workspace';
const props=defineProps<{item:Extract<InboxItem,{kind:'slack-setup'}>}>();
const {app,state}=useWorkspace();
const busy=ref(false),error=ref(''),confirmDisplacements=ref(false);
const agent=computed(()=>state.value.bots.find(bot=>bot.id===props.item.botId)?.name ?? 'Agent');
async function decide(decision:'confirm'|'dismiss') {
 busy.value=true;error.value='';
 try {await app.slackSetupDecision(props.item.id,decision,props.item.approval,confirmDisplacements.value);}
 catch {error.value='Setup could not be completed. Check Slack and Named secrets in Settings. If permissions, approvals, or a selected secret changed, dismiss this request and ask the agent to start setup again.';}
 finally {busy.value=false;}
}
</script>
<template>
 <article class="item" aria-label="Slack setup approval">
  <strong>Review Slack setup for {{ agent }}</strong><p class="meta">Agent ID: {{ item.approval.config.botId }}</p>
  <p>Workspace {{ item.approval.config.teamId }} · User {{ item.approval.config.userId }} · DM {{ item.approval.config.channelId }}</p>
  <p>App token: {{ item.approval.app.name }} (version {{ item.approval.app.revision }})<br>Bot token: {{ item.approval.bot.name }} (version {{ item.approval.bot.revision }})</p>
  <p v-if="item.approval.authority.agentAccess!==null">Current access for this agent: {{ item.approval.authority.agentAccess ? 'allowed' : 'not allowed' }}.</p>
  <p v-if="item.approval.authority.existingConfig">Current binding: workspace {{ item.approval.authority.existingConfig.teamId }}, user {{ item.approval.authority.existingConfig.userId }}, DM {{ item.approval.authority.existingConfig.channelId }}, agent {{ item.approval.authority.existingConfig.botId }} ({{ item.approval.authority.existingEnabled ? 'enabled' : 'disabled' }}).</p>
  <template v-if="item.approval.grantReview.grants.length"><p>Connecting will replace these current Slack secret approvals:</p><ul><li v-for="grant in item.approval.grantReview.grants" :key="grant.integration+grant.destination">{{ grant.integration }} · {{ grant.name }} · version {{ grant.revision }} · {{ grant.destination }}</li></ul><label><input v-model="confirmDisplacements" type="checkbox"> Replace these approvals</label></template>
  <p>Approval permits these exact saved secret versions to be used for this destination at https://slack.com/api and the Slack-provided Socket Mode address at wss://slack.com or a slack.com subdomain, and permits this agent to use Slack.</p>
  <p>The bot needs <code>im:write</code> so Staf can verify the selected user's existing DM before sending.</p>
  <template v-if="item.state==='interrupted'"><p>Setup was interrupted. Review its status and start a new attempt; it will not reconnect automatically.</p><button type="button" class="quiet" :disabled="busy" @click="decide('dismiss')">Dismiss</button></template>
  <p v-else-if="item.state==='connecting'">Checking Slack connection…</p>
  <div v-else class="row"><button type="button" :disabled="busy || (item.approval.grantReview.grants.length>0 && !confirmDisplacements)" @click="decide('confirm')">Approve and connect</button><button type="button" class="quiet" :disabled="busy" @click="decide('dismiss')">Dismiss</button></div>
  <p v-if="error" role="alert">{{ error }}</p>
 </article>
</template>
