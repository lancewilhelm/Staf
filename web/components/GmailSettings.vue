<script setup lang="ts">
import {onMounted,onUnmounted,ref} from 'vue';
import {useWorkspace} from '../workspace';
import ConfirmAction from './ConfirmAction.vue';
import DisclosureSummary from './DisclosureSummary.vue';

const {app,state}=useWorkspace();
const gmail=ref<Awaited<ReturnType<typeof app.gmailPlugin>>|null>(null),busy=ref(false),message=ref(''),authorizationUrl=ref('');
const form=ref({email:'',clientId:'',clientSecret:''});
const confirm=ref<'disconnect'|'delete-config'|'rebaseline'|null>(null),grant=ref<{botId:string;provider:string;model:string}|null>(null);
const workGrant=ref<{botId:string;provider:string;model:string}|null>(null);
const monitorGrant=ref<{botId:string;name:string;provider:string;model:string;accountId:string;gmailRevision:number;slackRevision:number;teamId:string;userId:string;channelId:string}|null>(null),monitorLoaded=ref(false),monitorRevision=ref<number|null>(null),attention=ref(''),sensitiveTerms=ref('');
const inspected=ref<Awaited<ReturnType<typeof app.gmailRead>>|null>(null);let timer:ReturnType<typeof setInterval>|undefined;
const older=ref<Array<{messageId:string;inbox:'unknown'}>>([]),olderBefore=ref<number|null>(null),loadedOlder=ref(false);
async function refresh(fillForm=false){const previous=gmail.value?.accountId,next=await app.gmailPlugin();if(previous!==next.accountId){older.value=[];olderBefore.value=null;loadedOlder.value=false;inspected.value=null;monitorLoaded.value=false;attention.value='';sensitiveTerms.value='';}gmail.value=next;if(!monitorLoaded.value){attention.value=next.inboxPreferences?.attention ?? '';sensitiveTerms.value=next.inboxPreferences?.sensitiveTerms.join('\n') ?? '';monitorRevision.value=next.inboxPreferences?.revision ?? null;monitorLoaded.value=true;}if(fillForm && next.config){form.value.email=next.config.email;form.value.clientId=next.config.clientId;}if(next.authorizationStatus==='Connected')authorizationUrl.value='';}
function onFocus(){void refresh().catch(()=>{message.value='Could not refresh Gmail status.';});}
onMounted(()=>{window.addEventListener('focus',onFocus);void refresh(true).catch(()=>{message.value='Could not load Gmail status.';});timer=setInterval(()=>{if(!busy.value)void refresh().catch(()=>{});},10000);});
onUnmounted(()=>{window.removeEventListener('focus',onFocus);if(timer)clearInterval(timer);});
async function action(name:'start'|'check'|'enable'|'disable'|'disconnect'|'delete-config'|'access'|'model-access'|'work-model-access'|'poll'|'rebaseline'|'inbox-preferences',body:object={}) {
 if(busy.value)return;busy.value=true;message.value='';
 try {const result=await app.gmailAction(name,body);if(name==='start'){authorizationUrl.value=result.url??'';form.value.clientSecret='';message.value='Open Google authorization, then return here.';}else{authorizationUrl.value='';message.value='Gmail settings updated.';if(name==='inbox-preferences')monitorLoaded.value=false;if(name==='disable'||name==='disconnect'||name==='delete-config')inspected.value=null;}await refresh();}
 catch(error){message.value='Gmail could not be updated. '+String(error);await refresh().catch(()=>{});}
 finally{busy.value=false;confirm.value=null;grant.value=null;workGrant.value=null;}
}
function monitorPreferences(enabled:boolean){return {revision:monitorRevision.value,preferences:{enabled,attention:attention.value,sensitiveTerms:sensitiveTerms.value.split('\n').map(term=>term.trim()).filter(Boolean)},confirmModelAccess:enabled};}
function requestMonitoring(){const target=gmail.value?.inboxTarget;if(target?.model)monitorGrant.value={...target,model:target.model};}
function confirmMonitoring(){const target=monitorGrant.value;if(!target)return;monitorGrant.value=null;void action('inbox-preferences',{...monitorPreferences(true),target:{botId:target.botId,provider:target.provider,model:target.model,accountId:target.accountId,gmailRevision:target.gmailRevision,slackRevision:target.slackRevision,teamId:target.teamId,userId:target.userId,channelId:target.channelId}});}
async function inspect(id:string){if(busy.value)return;busy.value=true;message.value='';try{inspected.value=await app.gmailRead(id);}catch(error){inspected.value=null;message.value='Could not inspect this message. '+String(error);}finally{busy.value=false;}}
async function loadOlder(){const before=loadedOlder.value?olderBefore.value:gmail.value?.nextBefore;if(!before || busy.value)return;busy.value=true;try{const page=await app.gmailArrivals(before);older.value.push(...page.arrivals);olderBefore.value=page.nextBefore;loadedOlder.value=true;}catch{message.value='Could not load older candidates.';}finally{busy.value=false;}}
</script>
<template>
 <div class="provider provider-settings provider-card" aria-label="Gmail plugin">
  <div class="provider-title"><h3>Gmail</h3><span class="badge">{{ gmail?.enabled ? 'Enabled' : gmail?.connected ? 'Disabled' : 'Not connected' }}</span></div>
  <p>Monitor new Gmail message candidates and search or read mail with an authorized agent.</p>
  <p v-if="gmail?.accountId">Account {{ gmail.accountId }}</p>
  <p v-if="gmail">Connection status: {{ gmail.status }}</p>
  <p v-if="gmail && gmail.authorizationStatus!=='Connected' && gmail.authorizationStatus!=='Not connected'">Authorization: {{ gmail.authorizationStatus }}</p>
  <p>Email sent to a model provider remains your choice. Agent access alone does not allow Gmail content to be sent to a model.</p>
  <details class="saved-settings"><DisclosureSummary>{{ gmail?.config ? 'Reconnect Gmail' : 'Set up Gmail' }}</DisclosureSummary>
   <p>Create a Google desktop OAuth client and enable the Gmail API first. The requested Gmail read-only scope is restricted. See the Gmail setup documentation for requirements and limitations.</p>
   <form @submit.prevent="action('start',{...form})">
    <label>Gmail account email<input v-model.trim="form.email" type="email" autocomplete="off" required /></label>
    <label>Google OAuth client ID<input v-model.trim="form.clientId" autocomplete="off" required /></label>
    <label>Google OAuth client secret<input v-model="form.clientSecret" type="password" autocomplete="off" required /></label>
    <button :disabled="busy">Begin Google authorization</button>
   </form>
   <p v-if="authorizationUrl"><a :href="authorizationUrl" target="_blank" rel="noreferrer">Open Google authorization</a>. Return here after granting access, then refresh status.</p>
  </details>
  <div v-if="gmail?.connected" class="row">
   <button :disabled="busy" @click="action(gmail.enabled?'disable':'enable')">{{ gmail.enabled?'Disable':'Enable' }}</button>
   <button class="quiet" :disabled="busy" @click="action('check')">Check Gmail connection</button>
   <button class="quiet" :disabled="busy" @click="confirm='disconnect'">Disconnect Gmail</button>
  </div>
  <fieldset v-if="gmail?.config"><legend>Agent access</legend>
   <p>Access is off until allowed. Sending Gmail data to a model needs a separate decision for that agent's current provider and model.</p>
   <div v-for="bot in state.bots.filter(item=>!item.archived)" :key="bot.id">
    <label><input type="checkbox" :checked="gmail.agentAccessIds.includes(bot.id)" :disabled="busy" @change="action('access',{botId:bot.id,enabled:!gmail.agentAccessIds.includes(bot.id)})" /> {{ bot.name }}</label>
    <template v-if="gmail.agentAccessIds.includes(bot.id) && bot.model">
     <button v-if="gmail.modelAccess.some(item=>item.botId===bot.id && item.provider===bot.provider && item.model===bot.model)" class="quiet" :disabled="busy" @click="action('model-access',{botId:bot.id,provider:bot.provider,model:bot.model,enabled:false})">Revoke Gmail model access</button>
     <button v-else class="quiet" :disabled="busy" @click="grant={botId:bot.id,provider:bot.provider,model:bot.model}">Allow Gmail to {{ bot.provider }} / {{ bot.model }}</button>
     <template v-if="gmail.modelAccess.some(item=>item.botId===bot.id && item.provider===bot.provider && item.model===bot.model)">
      <button v-if="gmail.workModelAccess.some(item=>item.botId===bot.id && item.provider===bot.provider && item.model===bot.model)" class="quiet" :disabled="busy" @click="action('work-model-access',{botId:bot.id,provider:bot.provider,model:bot.model,enabled:false})">Revoke task and Slack Gmail access</button>
      <button v-else class="quiet" :disabled="busy" @click="workGrant={botId:bot.id,provider:bot.provider,model:bot.model}">Allow Gmail in tasks and Slack work</button>
     </template>
    </template>
   </div>
  </fieldset>
  <fieldset v-if="gmail?.config"><legend>Inbox assistant</legend>
   <p>Monitoring uses the agent bound to the approved Slack DM and its selected model. Gmail sender, subject, and message text are sent to that model provider for assessment. New history candidates may include sent or draft messages; historical inbox membership is unknown. Changes start from the latest completed scan and do not replay earlier candidates.</p>
   <p v-if="gmail.inboxTarget">Slack agent: {{ gmail.inboxTarget.name }}; model provider: {{ gmail.inboxTarget.provider }} / {{ gmail.inboxTarget.model || 'not selected' }}.</p>
   <p v-else>Connect an approved Slack DM and choose its agent before enabling monitoring.</p>
   <label>What deserves attention?<textarea v-model="attention" maxlength="2000" rows="3" /></label>
   <label>Sensitive topics (one per line)<textarea v-model="sensitiveTerms" rows="3" /></label>
   <p v-if="gmail.inboxPreferences?.enabled">Monitoring is enabled for {{ gmail.inboxPreferences.provider }} / {{ gmail.inboxPreferences.model }}. Changing permissions or agent settings pauses it until you enable it again.</p>
   <p v-if="gmail.inboxStatus.failure">Inbox assistant needs attention: {{ gmail.inboxStatus.failure }}. Check Gmail, Slack, agent, and model permissions.</p>
   <p v-if="gmail.inboxStatus.items.some(item=>['failed','uncertain','stale'].includes(item.state))">Some evaluations or deliveries need review in agent tasks. Uncertain sends are not automatically repeated; pending decisions become stale when monitoring settings change.</p>
   <button class="quiet" :disabled="busy" @click="monitorLoaded=false;refresh().catch(()=>{message='Could not reload monitoring preferences.'})">Reload inbox preferences</button>
   <button :disabled="busy || !gmail.inboxTarget?.model" @click="requestMonitoring">{{ gmail.inboxPreferences?.enabled ? 'Save and restart monitoring' : 'Enable inbox monitoring' }}</button>
   <button v-if="gmail.inboxPreferences?.enabled" class="quiet" :disabled="busy" @click="action('inbox-preferences',monitorPreferences(false))">Disable inbox monitoring</button>
  </fieldset>
  <div v-if="gmail?.config" aria-label="Gmail arrivals">
   <h4>New message candidates</h4>
   <p>Gmail history does not establish whether a message was in the inbox when it arrived. These candidates may include sent or draft mail.</p>
   <p v-if="!gmail.monitor">A baseline is missing. Earlier arrivals cannot be established.</p>
   <p v-else>Monitoring: {{ gmail.monitor.state }}<span v-if="gmail.monitor.detail"> — {{ gmail.monitor.detail }}</span></p>
   <p v-for="(gap,index) in gmail.gaps" :key="index">History gap: {{ gap.reason }}. Arrivals in that interval are unknown.</p>
   <button v-if="gmail.connected && (!gmail.monitor || gmail.monitor.state==='uncertain' || gmail.monitor.state==='failed')" class="quiet" :disabled="busy" @click="confirm='rebaseline'">Start monitoring from now</button>
   <button v-if="gmail.enabled && gmail.monitor" class="quiet" :disabled="busy" @click="action('poll')">Check for new candidates</button>
   <p v-if="!gmail.arrivals.length">No candidates recorded.</p>
   <ul v-else><li v-for="arrival in [...gmail.arrivals,...older.filter(item=>!gmail?.arrivals.some(current=>current.messageId===item.messageId))]" :key="arrival.messageId">{{ arrival.messageId }} — inbox membership unknown <button class="quiet" :disabled="busy || !gmail.enabled" @click="inspect(arrival.messageId)">Inspect</button></li></ul>
   <button v-if="loadedOlder?olderBefore:gmail.nextBefore" class="quiet" :disabled="busy" @click="loadOlder">Load older candidates</button>
   <div v-if="inspected"><h4>{{ inspected.subject || '(No subject)' }}</h4><p>{{ inspected.from }} {{ inspected.date }}</p><pre style="white-space:pre-wrap">{{ inspected.text || inspected.snippet }}</pre><p>{{ inspected.notice }}<span v-if="inspected.truncated"> Text was truncated.</span></p><button class="quiet" @click="inspected=null">Close message</button></div>
  </div>
  <button v-if="gmail?.config" class="quiet" :disabled="busy" @click="confirm='delete-config'">Delete Gmail configuration</button>
  <button class="quiet" :disabled="busy" @click="refresh().catch(()=>{message='Could not refresh Gmail status.'})">Refresh Gmail status</button>
  <p role="status">{{ busy?'Updating Gmail…':message }}</p>
  <ConfirmAction v-if="confirm" :title="confirm==='disconnect'?'Disconnect Gmail?':confirm==='rebaseline'?'Start monitoring from now?':'Delete Gmail configuration?'" :message="confirm==='disconnect'?'This disables Gmail and removes its credentials. Account, agent access, and model permissions remain and can apply again after reconnecting.':confirm==='rebaseline'?'Arrivals in the missing interval cannot be recovered or identified. Staf will record this gap and start from the current Gmail history ID.':'This removes the stored credentials, account configuration, agent access, and model permissions.'" :action="confirm==='disconnect'?'Disconnect':confirm==='rebaseline'?'Start from now':'Delete configuration'" @cancel="confirm=null" @confirm="confirm==='rebaseline'?action('rebaseline',{confirm:true}):action(confirm)" />
  <ConfirmAction v-if="monitorGrant" title="Allow ongoing Gmail assessment?" :message="`New message content from ${monitorGrant.accountId} will be sent to ${monitorGrant.provider} / ${monitorGrant.model} for ${monitorGrant.name}. Staf will send relevant non-sensitive summaries to the approved Slack DM. Sensitive or uncertain messages require your reply in a private thread before details are shared. Earlier candidates are not replayed.`" action="Enable monitoring" @cancel="monitorGrant=null" @confirm="confirmMonitoring" />
  <ConfirmAction v-if="grant" title="Allow Gmail data to this model?" :message="`Gmail search results and message content can be sent to ${grant.provider} / ${grant.model} during this agent's chat. The owner-visible answer may contain email. This grant applies only to that provider and model. Gmail results and generated replies are omitted from later model requests; your request remains.`" action="Allow Gmail data" @cancel="grant=null" @confirm="action('model-access',{...grant,enabled:true})" />
  <ConfirmAction v-if="workGrant" title="Allow Gmail in tasks and Slack work?" :message="`Gmail results and message content can be sent to ${workGrant.provider} / ${workGrant.model} in scoped background tasks and Slack-originated chat or tasks. Ordinary Slack work receives a generic notification; the separately enabled inbox assistant can send approved summaries. This permission applies only to this agent and model.`" action="Allow task and Slack access" @cancel="workGrant=null" @confirm="action('work-model-access',{...workGrant,enabled:true})" />
 </div>
</template>
