<script setup lang="ts">
import {onMounted, ref} from 'vue';
import {useWorkspace} from '../workspace';

const {app}=useWorkspace();
type Defaults=Awaited<ReturnType<typeof app.toolDefaults>>;
const saved=ref<Defaults|null>(null), draft=ref<Defaults|null>(null), latest=ref<Defaults|null>(null);
const search=ref<Awaited<ReturnType<typeof app.searchConfig>>|null>(null), origin=ref('');
const busy=ref(false), needsReload=ref(false), searchNeedsReload=ref(false), status=ref(''), searchStatus=ref('');
onMounted(async()=>{await Promise.all([reload(),reloadSearch()]);});
async function reload(){
  try {const value=await app.toolDefaults(); if(!draft.value)draft.value={...value}; saved.value=value;latest.value=value;needsReload.value=false;}
  catch(error){needsReload.value=true;status.value='Could not load tool settings. '+String(error);}
}
async function save(){
  if(!saved.value || !draft.value || busy.value || needsReload.value)return;
  busy.value=true;
  try{await app.saveToolDefaults({...draft.value,revision:saved.value.revision});saved.value=await app.toolDefaults();draft.value={...saved.value};latest.value=null;status.value='Tool availability saved.';}
  catch(error){needsReload.value=true;status.value='Save failed or is uncertain. Your choices are retained; compare current settings before retrying. '+String(error);}
  finally{busy.value=false;}
}
async function reloadSearch(){
  try{const value=await app.searchConfig();if(!search.value)origin.value=value.origin??'';search.value=value;searchNeedsReload.value=false;}
  catch(error){searchNeedsReload.value=true;searchStatus.value='Could not load search configuration. '+String(error);}
}
async function saveSearch(){
  if(!search.value || busy.value || searchNeedsReload.value)return;
  busy.value=true;
  try{await app.saveSearchConfig(search.value.revision,origin.value.trim()||null);search.value=await app.searchConfig();origin.value=search.value.origin??'';searchStatus.value='Search backend saved. Permissions and approvals still apply.';}
  catch(error){searchNeedsReload.value=true;searchStatus.value='Save failed or is uncertain. Your entry is retained; compare the current backend before retrying. '+String(error);}
  finally{busy.value=false;}
}
</script>
<template>
  <section class="settings-section" aria-label="Tools">
    <h2 class="section-title">Tools</h2>
    <p>These instance-wide controls make tools available to agents. Permissions, task scope and approvals still determine whether a call can run. Disabling preserves settings and records.</p>
    <template v-if="draft">
      <label class="tool-toggle"><input v-model="draft.clock" type="checkbox" :disabled="busy" /> Clock</label>
      <label class="tool-toggle"><input v-model="draft.memory" type="checkbox" :disabled="busy" /> Memory</label>
      <label class="tool-toggle"><input v-model="draft.web" type="checkbox" :disabled="busy" /> Web research</label>
      <label class="tool-toggle"><input v-model="draft.files" type="checkbox" :disabled="busy" /> Files</label>
      <p class="meta">Memory also controls automatic recall; saved memories remain available to you. File tools do not control the native terminal.</p>
      <button :disabled="busy || needsReload" @click="save">Save tool availability</button>
    </template>
    <p role="status">{{ status }}</p>
    <button v-if="needsReload" class="quiet" :disabled="busy" @click="reload">Compare current settings</button>
    <p v-if="latest && status">Current saved: clock {{ latest.clock ? 'on' : 'off' }}, memory {{ latest.memory ? 'on' : 'off' }}, web {{ latest.web ? 'on' : 'off' }}, files {{ latest.files ? 'on' : 'off' }}. Your choices above are retained.</p>
    <h3>Search backend</h3>
    <p>Web search needs a trusted local SearXNG backend at <code>http://127.0.0.1:PORT</code>, plus separate instance and agent permissions and approval. Web page reading has separate permissions. See the usage guide for permission controls.</p>
    <template v-if="search">
      <label>Search backend origin<input v-model="origin" type="url" placeholder="http://127.0.0.1:8080" :disabled="busy" /></label>
      <p class="meta">Current saved backend: {{ search.origin ?? 'Not configured' }}. Leave empty to clear.</p>
      <button :disabled="busy || searchNeedsReload" @click="saveSearch">Save search backend</button>
    </template>
    <p role="status">{{ searchStatus }}</p>
    <button v-if="searchNeedsReload" class="quiet" :disabled="busy" @click="reloadSearch">Compare current backend</button>
  </section>
</template>

<style scoped>
label.tool-toggle { display: flex; align-items: center; gap: 8px; }
.tool-toggle input { display: inline-block; width: auto; margin: 0; padding: 0; }
</style>
