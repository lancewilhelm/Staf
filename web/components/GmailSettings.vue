<script setup lang="ts">
import {onMounted,onUnmounted,ref} from 'vue';
import {useWorkspace} from '../workspace';
import ConfirmAction from './ConfirmAction.vue';
import DisclosureSummary from './DisclosureSummary.vue';

const {app,state}=useWorkspace();
const gmail=ref<Awaited<ReturnType<typeof app.gmailPlugin>>|null>(null),busy=ref(false),message=ref(''),authorizationUrl=ref('');
const form=ref({email:'',clientId:'',clientSecret:'',sendEnabled:false,modifyEnabled:false});
const confirm=ref<'disconnect'|'delete-config'|'rebaseline'|null>(null),grant=ref<{botId:string;provider:string;model:string}|null>(null);
const workGrant=ref<{botId:string;provider:string;model:string}|null>(null);
const uncertain=ref<Awaited<ReturnType<typeof app.gmailUncertain>>>([]);
const resolution=ref<{item:(typeof uncertain.value)[number];outcome:'sent'|'not-sent'|'applied'|'not-applied'}|null>(null);
const inspected=ref<Awaited<ReturnType<typeof app.gmailRead>>|null>(null);let timer:ReturnType<typeof setInterval>|undefined;
const older=ref<Array<{messageId:string;inbox:'unknown'}>>([]),olderBefore=ref<number|null>(null),loadedOlder=ref(false);
async function refresh(fillForm=false){const previous=gmail.value?.accountId,[next,unknown]=await Promise.all([app.gmailPlugin(),app.gmailUncertain()]);if(previous!==next.accountId){older.value=[];olderBefore.value=null;loadedOlder.value=false;inspected.value=null;}gmail.value=next;uncertain.value=unknown;if(fillForm && next.config){form.value.email=next.config.email;form.value.clientId=next.config.clientId;}if(next.authorizationStatus==='Connected')authorizationUrl.value='';}
async function reconcile(){const selected=resolution.value;if(!selected || busy.value)return;busy.value=true;message.value='';try{await app.gmailReconcile({actionId:selected.item.actionId,fingerprint:selected.item.fingerprint,kind:selected.item.effect.kind==='modify'?'modify':'reply',outcome:selected.outcome});message.value='Your finding was recorded. No Gmail action was sent.';await refresh();}catch(error){message.value='Could not record the finding. '+String(error);await refresh().catch(()=>{});}finally{busy.value=false;resolution.value=null;}}
function onFocus(){void refresh().catch(()=>{message.value='Could not refresh Gmail status.';});}
onMounted(()=>{window.addEventListener('focus',onFocus);void refresh(true).catch(()=>{message.value='Could not load Gmail status.';});timer=setInterval(()=>{if(!busy.value)void refresh().catch(()=>{});},10000);});
onUnmounted(()=>{window.removeEventListener('focus',onFocus);if(timer)clearInterval(timer);});
async function action(name:'start'|'check'|'enable'|'disable'|'disconnect'|'delete-config'|'access'|'model-access'|'work-model-access'|'poll'|'rebaseline',body:object={}) {
 if(busy.value)return;busy.value=true;message.value='';
 try {const result=await app.gmailAction(name,body);if(name==='start'){authorizationUrl.value=result.url??'';form.value.clientSecret='';message.value='Open Google authorization, then return here.';}else{authorizationUrl.value='';message.value='Gmail settings updated.';if(name==='disable'||name==='disconnect'||name==='delete-config')inspected.value=null;}await refresh();}
 catch(error){message.value='Gmail could not be updated. '+String(error);await refresh().catch(()=>{});}
 finally{busy.value=false;confirm.value=null;grant.value=null;workGrant.value=null;}
}
async function inspect(id:string){if(busy.value)return;busy.value=true;message.value='';try{inspected.value=await app.gmailRead(id);}catch(error){inspected.value=null;message.value='Could not inspect this message. '+String(error);}finally{busy.value=false;}}
async function loadOlder(){const before=loadedOlder.value?olderBefore.value:gmail.value?.nextBefore;if(!before || busy.value)return;busy.value=true;try{const page=await app.gmailArrivals(before);older.value.push(...page.arrivals);olderBefore.value=page.nextBefore;loadedOlder.value=true;}catch{message.value='Could not load older candidates.';}finally{busy.value=false;}}
</script>
<template>
 <div class="provider provider-settings provider-card" aria-label="Gmail plugin">
  <div class="provider-title"><h3>Gmail</h3><span class="badge">{{ gmail?.enabled ? 'Enabled' : gmail?.connected ? 'Disabled' : 'Not connected' }}</span></div>
  <p>Monitor new Gmail message candidates and search or read mail with an authorized agent.</p>
  <p v-if="gmail?.accountId">Account {{ gmail.accountId }}</p>
  <p v-if="gmail?.connected">Approved reply sending: {{ gmail.sendEnabled ? 'Authorized with Google' : 'Not authorized' }}</p>
  <p v-if="gmail?.connected">Approved inbox changes: {{ gmail.modifyEnabled ? 'Authorized with Google' : 'Not authorized' }}</p>
  <p v-if="gmail">Connection status: {{ gmail.status }}</p>
  <p v-if="gmail && gmail.authorizationStatus!=='Connected' && gmail.authorizationStatus!=='Not connected'">Authorization: {{ gmail.authorizationStatus }}</p>
  <p>Email sent to a model provider remains your choice. Agent access alone does not allow Gmail content to be sent to a model.</p>
  <section v-if="uncertain.length" aria-label="Gmail outcomes needing review">
   <h4>Gmail outcomes needing review</h4>
   <p>Staf cannot determine whether these actions finished. Check Gmail before recording your finding. Recording a finding never sends or changes mail. Showing up to 100.</p>
   <article v-for="item in uncertain" :key="item.actionId">
    <p><strong>Account:</strong> {{ item.accountId }} · <strong>Outcome:</strong> Unknown</p>
    <template v-if="item.intact">
     <template v-if="item.effect.kind==='modify'"><p><strong>Message:</strong> {{ item.effect.subject || '(No subject)' }} · {{ item.effect.from }} · {{ item.effect.messageId }}</p><p><strong>Proposed change:</strong> {{ item.effect.action==='label' ? 'Add label '+item.effect.labelName : item.effect.action==='archive' ? 'Archive' : 'Mark read' }}</p></template>
     <template v-else><p><strong>To:</strong> {{ item.effect.to }}<br /><strong>Subject:</strong> {{ item.effect.subject }}</p><pre style="white-space:pre-wrap">{{ item.effect.body }}</pre></template>
     <p>{{ item.detail }}</p>
     <div class="row"><button :disabled="busy" @click="resolution={item,outcome:item.effect.kind==='modify'?'applied':'sent'}">{{ item.effect.kind==='modify'?'I found it applied':'I found it sent' }}</button><button class="quiet" :disabled="busy" @click="resolution={item,outcome:item.effect.kind==='modify'?'not-applied':'not-sent'}">{{ item.effect.kind==='modify'?'I found it not applied':'I found it not sent' }}</button></div>
    </template>
    <p v-else>The recorded proposal changed and cannot be reconciled here. Inspect the database and Gmail before taking further action.</p>
   </article>
  </section>
  <details class="saved-settings"><DisclosureSummary>{{ gmail?.config ? 'Reconnect Gmail' : 'Set up Gmail' }}</DisclosureSummary>
   <p>Create a Google desktop OAuth client and enable the Gmail API first. The Gmail read-only scope is restricted. Google's modify permission also permits sending; Staf still requires the separate send option and approval for replies. See the Gmail setup documentation for requirements and limitations.</p>
   <form @submit.prevent="action('start',{...form})">
    <label>Gmail account email<input v-model.trim="form.email" type="email" autocomplete="off" required /></label>
    <label>Google OAuth client ID<input v-model.trim="form.clientId" autocomplete="off" required /></label>
    <label>Google OAuth client secret<input v-model="form.clientSecret" type="password" autocomplete="off" required /></label>
    <label><input v-model="form.sendEnabled" type="checkbox" /> Allow Gmail to send replies after explicit approval in Slack</label>
    <label><input v-model="form.modifyEnabled" type="checkbox" /> Allow Gmail inbox changes after explicit approval in Slack</label>
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
  <ConfirmAction v-if="grant" title="Allow Gmail data to this model?" :message="`Gmail search results and message content can be sent to ${grant.provider} / ${grant.model} during this agent's chat. The owner-visible answer may contain email. This grant applies only to that provider and model. Gmail results and generated replies are omitted from later model requests; your request remains.`" action="Allow Gmail data" @cancel="grant=null" @confirm="action('model-access',{...grant,enabled:true})" />
  <ConfirmAction v-if="workGrant" title="Allow Gmail in tasks and Slack work?" :message="`Gmail results and message content can be sent to ${workGrant.provider} / ${workGrant.model} in scoped background tasks and Slack-originated chat or tasks. Slack receives generic updates unless you separately choose to reveal a Gmail action proposal. This permission applies only to this agent and model.`" action="Allow task and Slack access" @cancel="workGrant=null" @confirm="action('work-model-access',{...workGrant,enabled:true})" />
  <ConfirmAction v-if="resolution" title="Record your Gmail finding?" :message="`You are recording that the action ${resolution.outcome.replace('-', ' ')} after checking Gmail. This does not perform or retry the action. If you are unsure, cancel and leave it unresolved.`" action="Record finding" @cancel="resolution=null" @confirm="reconcile()" />
 </div>
</template>
