<script setup lang="ts">
import {onMounted,ref} from 'vue';
import {useWorkspace} from '../workspace';
const {app}=useWorkspace();
const names=ref<Awaited<ReturnType<typeof app.secrets>>>([]),target=ref(''),status=ref('');
async function reload(){try{names.value=await app.secrets();}catch{status.value='Could not load named secrets.';}}
async function remove(){const name=target.value;target.value='';try{await app.deleteSecret(name);await reload();status.value='Secret deleted from this instance.';}catch{status.value='Deletion failed or is uncertain. Refresh before retrying.';}}
onMounted(reload);
</script>
<template>
 <section class="settings-section" aria-label="Named secrets">
  <h2 class="section-title">Named secrets</h2>
  <p>Values cannot be displayed. Saving a secret does not authorize any plugin to use it.</p>
  <p v-if="!names.length">No named secrets saved.</p>
  <div v-for="item in names" :key="item.name"><strong>{{ item.name }}</strong><p>{{ item.purpose }}</p><p v-if="item.destination">Intended destination: {{ item.destination }}</p><button class="quiet" @click="target=item.name">Delete</button></div>
  <div v-if="target"><p>Delete {{ target }}? This does not revoke it at the provider or erase backups.</p><button @click="remove">Confirm delete</button><button class="quiet" @click="target=''">Cancel</button></div>
  <p role="status">{{ status }}</p><button class="quiet" @click="reload">Refresh</button>
 </section>
</template>
