<script setup lang="ts">
import {onMounted,ref} from 'vue';
import {useWorkspace} from '../workspace';
const {app}=useWorkspace();
type Secret=Awaited<ReturnType<typeof app.secrets>>[number];
type Grant=Awaited<ReturnType<typeof app.secretGrants>>[number];
const names=ref<Secret[]>([]),target=ref<Secret|null>(null),mode=ref<'add'|'replace'|'delete'|null>(null);
const grants=ref<Grant[]>([]),targets=ref<Awaited<ReturnType<typeof app.secretGrantTargets>>>([]),grantChoice=ref(''),grantSecret=ref<Secret|null>(null),revokeTarget=ref<Grant|null>(null);
const reviewedGrant=ref<{secret:Secret;target:Awaited<ReturnType<typeof app.secretGrantTargets>>[number]}|null>(null);
const name=ref(''),purpose=ref(''),value=ref(''),reveal=ref(false),busy=ref(false),status=ref('');
async function reload(){try{[names.value,grants.value,targets.value]=await Promise.all([app.secrets(),app.secretGrants(),app.secretGrantTargets()]);}catch{status.value='Could not load named secrets.';}}
function uses(item:Secret){return grants.value.filter(grant=>grant.name===item.name);}
function reviewGrant(){const selected=targets.value[Number(grantChoice.value)];if(selected && grantSecret.value && grantChoice.value!=='')reviewedGrant.value={secret:{...grantSecret.value},target:{...selected,current:selected.current?{...selected.current}:null}};}
async function grant(){const reviewed=reviewedGrant.value;if(!reviewed)return;const {secret,target}=reviewed;busy.value=true;try{await app.approveSecretGrant({name:secret.name,revision:secret.revision,integration:target.integration,destination:target.destination,version:target.version,previous:target.current,confirmDisplacement:!!target.current && (target.current.name!==secret.name || target.current.revision!==secret.revision)});reviewedGrant.value=null;grantSecret.value=null;grantChoice.value='';await reload();status.value='Use approved.';}catch{status.value='Approval failed or the integration changed. Refresh before trying again.';}finally{busy.value=false;}}
async function revoke(){if(!revokeTarget.value)return;busy.value=true;try{await app.revokeSecretGrant(revokeTarget.value);revokeTarget.value=null;await reload();status.value='Use revoked.';}catch{status.value='Revocation failed or the grant changed. Refresh before trying again.';}finally{busy.value=false;}}
function cancel(){mode.value=null;target.value=null;name.value='';purpose.value='';value.value='';reveal.value=false;}
async function save(){busy.value=true;status.value='';try{if(mode.value==='add')await app.addSecret(name.value,purpose.value,value.value);else if(mode.value==='replace' && target.value)await app.replaceSecret(target.value.name,target.value.revision,value.value);else return;cancel();await reload();status.value='Secret saved.';}catch{status.value='Save failed or the secret changed. Refresh before trying again.';}finally{busy.value=false;}}
async function remove(){if(!target.value)return;busy.value=true;try{await app.deleteSecret(target.value.name,target.value.revision);cancel();await reload();status.value='Secret deleted from this instance.';}catch{status.value='Deletion failed or is uncertain. Refresh before retrying.';}finally{busy.value=false;}}
onMounted(reload);
</script>
<template>
 <section class="settings-section" aria-label="Named secrets">
  <h2 class="section-title">Named secrets</h2>
  <p>Values cannot be displayed. Saving or selecting a secret does not authorize its use. Approvals apply to the named integration and destination.</p>
  <p v-if="!names.length">No named secrets saved.</p>
  <div v-for="item in names" :key="item.name"><strong>{{ item.name }}</strong><p>{{ item.purpose }}</p><p v-if="item.destination">Intended destination: {{ item.destination }}</p><ul v-if="uses(item).length"><li v-for="grant in uses(item)" :key="grant.integration+grant.destination">{{ grant.integration }}: {{ grant.destination }} <button class="quiet" @click="revokeTarget=grant">Revoke use</button></li></ul><button class="quiet" @click="grantSecret=item;grantChoice=''">Approve use</button><button class="quiet" @click="cancel();target=item;mode='replace'">Replace</button><button class="quiet" @click="cancel();target=item;mode='delete'">Delete</button></div>
  <button v-if="!mode" @click="mode='add'">Add secret</button>
  <form v-if="mode==='add' || mode==='replace'" @submit.prevent="save">
   <h3>{{ mode==='add'?'Add secret':`Replace ${target?.name}` }}</h3>
   <p v-if="mode==='replace'">Confirming replaces the saved value and revokes its use approvals. The current value stays in place until you confirm.</p>
   <p v-if="mode==='replace' && target && uses(target).length">Affected integrations: {{ uses(target).map(use=>use.integration).join(', ') }}. They need a new approval or reconnection.</p>
   <template v-if="mode==='add'"><label>Name <input v-model="name" maxlength="120" required /></label><label>Purpose <input v-model="purpose" maxlength="500" required /></label></template>
   <label>Secret <input v-model="value" :type="reveal?'text':'password'" autocomplete="off" required /></label>
   <button type="button" class="quiet" @click="reveal=!reveal">{{ reveal?'Hide':'Reveal' }}</button>
   <button :disabled="busy || !value">{{ mode==='replace'?'Confirm replacement':'Save secret' }}</button><button type="button" class="quiet" @click="cancel">Cancel</button>
  </form>
  <div v-if="mode==='delete' && target"><p>Delete {{ target.name }}? This revokes its use approvals. This does not revoke it at the provider, recall a request, or erase backups.</p><p v-if="uses(target).length">Affected integrations: {{ uses(target).map(use=>use.integration).join(', ') }}. They need a new approval or reconnection.</p><button :disabled="busy" @click="remove">Confirm delete</button><button class="quiet" @click="cancel">Cancel</button></div>
  <div v-if="grantSecret && !reviewedGrant"><h3>Approve use of {{ grantSecret.name }}</h3><p>Select a configured integration and its exact destination. Agent access remains separate.</p><label>Use <select v-model="grantChoice"><option value="">Choose use</option><option v-for="(entry,index) in targets" :key="entry.integration+entry.destination" :value="String(index)">{{ entry.integration }}: {{ entry.destination }}</option></select></label><button :disabled="busy || grantChoice===''" @click="reviewGrant">Review approval</button><button class="quiet" @click="grantSecret=null">Cancel</button></div>
  <div v-if="reviewedGrant"><p>Approve {{ reviewedGrant.secret.name }} for {{ reviewedGrant.target.integration }} at {{ reviewedGrant.target.destination }}?</p><p v-if="reviewedGrant.target.current && (reviewedGrant.target.current.name!==reviewedGrant.secret.name || reviewedGrant.target.current.revision!==reviewedGrant.secret.revision)">This replaces the current approval for {{ reviewedGrant.target.current.name }}. That secret will no longer be used for this destination.</p><button :disabled="busy" @click="grant">Confirm approval</button><button class="quiet" @click="reviewedGrant=null">Back</button></div>
  <div v-if="revokeTarget"><p>Revoke {{ revokeTarget.integration }} use at {{ revokeTarget.destination }}? A request already sent cannot be recalled.</p><button :disabled="busy" @click="revoke">Confirm revocation</button><button class="quiet" @click="revokeTarget=null">Cancel</button></div>
  <p role="status">{{ status }}</p><button class="quiet" @click="reload">Refresh</button>
 </section>
</template>
