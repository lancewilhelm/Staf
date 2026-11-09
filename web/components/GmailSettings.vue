<script setup lang="ts">
import {onMounted,onUnmounted,ref} from 'vue';
import {useWorkspace} from '../workspace';
import ConfirmAction from './ConfirmAction.vue';
import DisclosureSummary from './DisclosureSummary.vue';

const {app,state}=useWorkspace();
const gmail=ref<Awaited<ReturnType<typeof app.gmailPlugin>>|null>(null),busy=ref(false),message=ref(''),authorizationUrl=ref('');
const form=ref({email:'',clientId:'',clientSecret:''});
const confirm=ref<'disconnect'|'delete-config'|null>(null);
async function refresh(){gmail.value=await app.gmailPlugin();if(gmail.value.config){form.value.email=gmail.value.config.email;form.value.clientId=gmail.value.config.clientId;}if(gmail.value.authorizationStatus==='Connected')authorizationUrl.value='';}
function onFocus(){void refresh().catch(()=>{message.value='Could not refresh Gmail status.';});}
onMounted(()=>{window.addEventListener('focus',onFocus);onFocus();});
onUnmounted(()=>window.removeEventListener('focus',onFocus));
async function action(name:'start'|'check'|'enable'|'disable'|'disconnect'|'delete-config'|'access',body:object={}) {
 if(busy.value)return;busy.value=true;message.value='';
 try {const result=await app.gmailAction(name,body);if(name==='start'){authorizationUrl.value=result.url??'';form.value.clientSecret='';message.value='Open Google authorization, then return here.';}else{authorizationUrl.value='';message.value='Gmail settings updated.';}await refresh();}
 catch(error){message.value='Gmail could not be updated. '+String(error);}
 finally{busy.value=false;confirm.value=null;}
}
</script>
<template>
 <div class="provider provider-settings provider-card" aria-label="Gmail plugin">
  <div class="provider-title"><h3>Gmail</h3><span class="badge">{{ gmail?.enabled ? 'Enabled' : gmail?.connected ? 'Disabled' : 'Not connected' }}</span></div>
  <p>Connect one Gmail account. Search and inbox monitoring are not available yet.</p>
  <p v-if="gmail?.accountId">Account {{ gmail.accountId }}</p>
  <p v-if="gmail">Connection status: {{ gmail.status }}</p>
  <p v-if="gmail && gmail.authorizationStatus!=='Connected' && gmail.authorizationStatus!=='Not connected'">Authorization: {{ gmail.authorizationStatus }}</p>
  <p>Email sent to a model provider remains an unresolved owner decision. This connection does not send email content to a model.</p>
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
   <p>Access is off until allowed. No Gmail tools are available yet.</p>
   <label v-for="bot in state.bots.filter(item=>!item.archived)" :key="bot.id"><input type="checkbox" :checked="gmail.agentAccessIds.includes(bot.id)" :disabled="busy" @change="action('access',{botId:bot.id,enabled:!gmail.agentAccessIds.includes(bot.id)})" /> {{ bot.name }}</label>
  </fieldset>
  <button v-if="gmail?.config" class="quiet" :disabled="busy" @click="confirm='delete-config'">Delete Gmail configuration</button>
  <button class="quiet" :disabled="busy" @click="refresh().catch(()=>{message='Could not refresh Gmail status.'})">Refresh Gmail status</button>
  <p role="status">{{ busy?'Updating Gmail…':message }}</p>
  <ConfirmAction v-if="confirm" :title="confirm==='disconnect'?'Disconnect Gmail?':'Delete Gmail configuration?'" :message="confirm==='disconnect'?'This disables Gmail and removes its stored credentials. The account and agent access settings remain.':'This removes the stored credentials, account configuration, and agent access settings.'" :action="confirm==='disconnect'?'Disconnect':'Delete configuration'" @cancel="confirm=null" @confirm="action(confirm)" />
 </div>
</template>
