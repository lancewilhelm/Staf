<script setup lang="ts">
import {onMounted,ref} from 'vue';
import {useWorkspace} from '../workspace';
const {app}=useWorkspace();
type Secret=Awaited<ReturnType<typeof app.secrets>>[number];
const names=ref<Secret[]>([]),target=ref<Secret|null>(null),mode=ref<'add'|'replace'|'delete'|null>(null);
const name=ref(''),purpose=ref(''),value=ref(''),reveal=ref(false),busy=ref(false),status=ref('');
async function reload(){try{names.value=await app.secrets();}catch{status.value='Could not load named secrets.';}}
function cancel(){mode.value=null;target.value=null;name.value='';purpose.value='';value.value='';reveal.value=false;}
async function save(){busy.value=true;status.value='';try{if(mode.value==='add')await app.addSecret(name.value,purpose.value,value.value);else if(mode.value==='replace' && target.value)await app.replaceSecret(target.value.name,target.value.revision,value.value);else return;cancel();await reload();status.value='Secret saved.';}catch{status.value='Save failed or the secret changed. Refresh before trying again.';}finally{busy.value=false;}}
async function remove(){if(!target.value)return;busy.value=true;try{await app.deleteSecret(target.value.name,target.value.revision);cancel();await reload();status.value='Secret deleted from this instance.';}catch{status.value='Deletion failed or is uncertain. Refresh before retrying.';}finally{busy.value=false;}}
onMounted(reload);
</script>
<template>
 <section class="settings-section" aria-label="Named secrets">
  <h2 class="section-title">Named secrets</h2>
  <p>Values cannot be displayed. Saving or selecting a secret does not authorize a plugin or destination to use it.</p>
  <p v-if="!names.length">No named secrets saved.</p>
  <div v-for="item in names" :key="item.name"><strong>{{ item.name }}</strong><p>{{ item.purpose }}</p><p v-if="item.destination">Intended destination: {{ item.destination }}</p><button class="quiet" @click="cancel();target=item;mode='replace'">Replace</button><button class="quiet" @click="cancel();target=item;mode='delete'">Delete</button></div>
  <button v-if="!mode" @click="mode='add'">Add secret</button>
  <form v-if="mode==='add' || mode==='replace'" @submit.prevent="save">
   <h3>{{ mode==='add'?'Add secret':`Replace ${target?.name}` }}</h3>
   <p v-if="mode==='replace'">Confirming replaces the saved value. The current value stays in place until you confirm.</p>
   <template v-if="mode==='add'"><label>Name <input v-model="name" maxlength="120" required /></label><label>Purpose <input v-model="purpose" maxlength="500" required /></label></template>
   <label>Secret <input v-model="value" :type="reveal?'text':'password'" autocomplete="off" required /></label>
   <button type="button" class="quiet" @click="reveal=!reveal">{{ reveal?'Hide':'Reveal' }}</button>
   <button :disabled="busy || !value">{{ mode==='replace'?'Confirm replacement':'Save secret' }}</button><button type="button" class="quiet" @click="cancel">Cancel</button>
  </form>
  <div v-if="mode==='delete' && target"><p>Delete {{ target.name }}? This does not revoke it at the provider, recall a request, or erase backups.</p><button :disabled="busy" @click="remove">Confirm delete</button><button class="quiet" @click="cancel">Cancel</button></div>
  <p role="status">{{ status }}</p><button class="quiet" @click="reload">Refresh</button>
 </section>
</template>
