<script setup lang="ts">
import {onMounted, ref} from 'vue';
import {useWorkspace} from '../workspace';
import ConfirmAction from './ConfirmAction.vue';
import DisclosureSummary from './DisclosureSummary.vue';
import GmailSettings from './GmailSettings.vue';

const {app,state}=useWorkspace();
type Plugin=Awaited<ReturnType<typeof app.plugins>>[number];
const plugins=ref<Plugin[]>([]),busy=ref(false),status=ref(''),confirm=ref<'disconnect'|'delete-config'|null>(null);
const form=ref({appToken:'',botToken:'',teamId:'',userId:'',channelId:'',botId:''});
async function refresh(){plugins.value=await app.plugins();const config=plugins.value.find(plugin=>plugin.id==='slack')?.config;if(config)form.value={...form.value,...config};}
onMounted(()=>{void refresh().catch(()=>{status.value='Could not load plugins.';});});
async function action(name:'connect'|'enable'|'disable'|'disconnect'|'delete-config'|'access',body:object={}) {
 if(busy.value)return;busy.value=true;status.value='';
 try {await app.pluginAction(name,body);if(name==='connect'){form.value.appToken='';form.value.botToken='';}await refresh();status.value='Plugin settings updated.';}
 catch(error){status.value='Could not update plugin. Check its current status before retrying. '+String(error);}
 finally{busy.value=false;confirm.value=null;}
}
function connect(){void action('connect',{...form.value});}
</script>
<template>
 <section class="settings-section" aria-label="Plugins">
  <h2 class="section-title">Plugins</h2>
  <p class="section-help">Connections belong to this instance. Agent access is controlled separately.</p>
  <div v-for="plugin in plugins.filter(item=>item.id==='slack')" :key="plugin.id" class="provider provider-settings provider-card">
   <div class="provider-title"><h3>{{ plugin.name }}</h3><span class="badge">{{ plugin.enabled ? plugin.status : plugin.connected ? 'Disabled' : 'Not connected' }}</span></div>
   <p>{{ plugin.description }}</p>
   <p v-if="plugin.config">Workspace {{ plugin.config.teamId }} · User {{ plugin.config.userId }} · DM {{ plugin.config.channelId }}</p>
   <p v-if="plugin.connected">Agent access: {{ plugin.agentAccess ? 'Allowed' : 'Not allowed' }}</p>
   <details class="saved-settings"><DisclosureSummary>{{ plugin.config ? 'Change connection' : 'Set up Slack' }}</DisclosureSummary>
    <p>Use a Slack app with Socket Mode and a bot token. Enter the IDs of the one workspace, user, and direct message you approve. <a href="https://docs.slack.dev/apis/events-api/using-socket-mode/" target="_blank" rel="noreferrer">Slack Socket Mode setup</a>.</p>
    <form @submit.prevent="connect">
     <label>App-level token<input v-model="form.appToken" type="password" autocomplete="off" required /></label>
     <label>Bot user token<input v-model="form.botToken" type="password" autocomplete="off" required /></label>
     <label>Workspace ID<input v-model.trim="form.teamId" required /></label>
     <label>Approved user ID<input v-model.trim="form.userId" required /></label>
     <label>Direct message channel ID<input v-model.trim="form.channelId" required /></label>
     <label>Agent<select v-model="form.botId" required><option value="" disabled>Choose an agent</option><option v-for="bot in state.bots.filter(item=>!item.archived)" :key="bot.id" :value="bot.id">{{ bot.name }}</option></select></label>
     <button :disabled="busy">Connect</button>
    </form>
   </details>
   <div v-if="plugin.connected && plugin.config" class="row">
    <button class="quiet" :disabled="busy" @click="action('access',{botId:plugin.config.botId,enabled:!plugin.agentAccess})">{{ plugin.agentAccess ? 'Revoke agent access' : 'Allow agent access' }}</button>
    <button :disabled="busy" @click="action(plugin.enabled ? 'disable' : 'enable')">{{ plugin.enabled ? 'Disable' : 'Enable' }}</button>
    <button class="quiet" :disabled="busy" @click="confirm='disconnect'">Disconnect</button>
   </div>
   <button v-if="plugin.config" class="quiet" :disabled="busy" @click="confirm='delete-config'">Delete saved configuration</button>
   <button class="quiet" :disabled="busy" @click="refresh().catch(()=>{status='Could not refresh plugins.'})">Refresh status</button>
   <details v-if="plugin.events.length" class="saved-settings"><DisclosureSummary>Recent message outcomes</DisclosureSummary><ul><li v-for="event in plugin.events" :key="event.commandId">{{ event.state }}<span v-if="event.detail">: {{ event.detail }}</span> <span class="meta">({{ event.commandId }})</span></li></ul></details>
   <details v-if="plugin.deliveries.length" class="saved-settings"><DisclosureSummary>Recent task deliveries</DisclosureSummary><p>Sent means Slack accepted the message, not that it was read. Uncertain sends are not retried automatically.</p><ul><li v-for="delivery in plugin.deliveries" :key="delivery.id">{{ delivery.state }} <span class="meta">({{ delivery.id }})</span></li></ul></details>
  </div>
  <GmailSettings />
  <p role="status">{{ busy ? 'Updating plugin…' : status }}</p>
  <ConfirmAction v-if="confirm" :title="confirm === 'disconnect' ? 'Disconnect Slack?' : 'Delete Slack configuration?'" :message="confirm === 'disconnect' ? 'This stops Slack and removes its saved tokens. The binding and history remain.' : 'This stops Slack, removes its tokens and saved binding. Message history remains.'" :action="confirm === 'disconnect' ? 'Disconnect' : 'Delete configuration'" @cancel="confirm=null" @confirm="action(confirm)" />
 </section>
</template>
