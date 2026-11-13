<script setup lang="ts">
import {computed,ref} from 'vue';
import type {InboxItem} from '../controller';
import {useWorkspace} from '../workspace';
const props=defineProps<{item:Extract<InboxItem,{kind:'secret'}>}>();
const {app,state}=useWorkspace();
const value=ref(''),reveal=ref(false),busy=ref(false),error=ref('');
const agent=computed(()=>state.value.bots.find(bot=>bot.id===props.item.botId)?.name ?? 'Agent');
async function decide(decision:'save'|'skip'|'dismiss') {
 busy.value=true;error.value='';
 try {await app.secretDecision(props.item.id,decision,decision==='save'?value.value:undefined);value.value='';reveal.value=false;}
 catch {error.value='Could not complete the request. Refresh and check its status before retrying.';}
 finally {busy.value=false;}
}
</script>
<template>
 <article class="item" aria-label="Secret request">
  <strong>{{ agent }} requests a secret</strong>
  <p>{{ item.name }}</p><p>{{ item.purpose }}</p><p v-if="item.destination">Intended destination: {{ item.destination }}</p>
  <p class="meta">Saving does not enable a plugin or authorize use. Saved values cannot be revealed here.</p>
  <template v-if="item.state==='pending'">
   <label>Secret <input v-model="value" :type="reveal?'text':'password'" autocomplete="off" /></label>
   <button type="button" class="quiet" @click="reveal=!reveal">{{ reveal?'Hide':'Reveal' }}</button>
   <button type="button" :disabled="busy || !value" @click="decide('save')">Save secret</button>
   <button type="button" class="quiet" :disabled="busy" @click="decide('skip')">Skip</button>
  </template>
  <p v-else>Work was interrupted. Start a new attempt to request the secret again.</p>
  <button type="button" class="quiet" :disabled="busy" @click="decide('dismiss')">Dismiss</button>
  <p v-if="error" role="alert">{{ error }}</p>
 </article>
</template>
