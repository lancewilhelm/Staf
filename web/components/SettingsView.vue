<script setup lang="ts">
import { Monitor, Moon, Sun } from '@lucide/vue';
import { useWorkspace } from '../workspace';
import { type Appearance, saveAppearance } from '../appearance';
import ProviderDefaults from './ProviderDefaults.vue';
import CoreSettings from './CoreSettings.vue';
import ToolSettings from './ToolSettings.vue';
import PluginSettings from './PluginSettings.vue';
import SecretSettings from './SecretSettings.vue';
import OutputRecovery from './OutputRecovery.vue';
import AppearanceOptions from './AppearanceOptions.vue';
import ConfirmAction from './ConfirmAction.vue';
import { ref } from 'vue';
const props = defineProps<{appearance: Appearance; hasAgentSettings: boolean; routerForm: {key: string; status: string; busy: boolean}}>();
const form = props.routerForm;
const emit = defineEmits<{'update:appearance': [value: Appearance]; agentSettings: []; chat: []; memory: []}>();
const {app, state: s} = useWorkspace();
const appearances: Appearance[] = ['light', 'dark', 'system'];
function chooseAppearance(value: Appearance) { emit('update:appearance', value); saveAppearance(value); }
const confirmingSignOut = ref(false);
function signOut() { confirmingSignOut.value = false; void app.signOutAuth(); }
type EarlierRecord = {key: string; value: string};
const discardTarget = ref<{record: EarlierRecord; dataset: string | null} | null>(null);
function recordContent(raw: string) {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return raw;
    const fields: string[] = [];
    for (const [name, text] of Object.entries(value)) {
      if (typeof text === 'string') fields.push(`${name}:\n${text}`);
      if (name === 'submission' && text && typeof text === 'object') {
        for (const [part, saved] of Object.entries(text)) if (typeof saved === 'string') fields.push(`submission ${part}:\n${saved}`);
      }
    }
    return [...fields, `Original saved record:\n${raw}`].join('\n\n');
  } catch { return raw; }
}
async function copyRecord(record: EarlierRecord) {
  try { await navigator.clipboard.writeText(recordContent(record.value)); app.notify('Record copied.', 'success'); }
  catch { app.notify('Could not copy the record. Select and copy its text instead.', 'error'); }
}
async function discardRecord() {
  const target = discardTarget.value;
  discardTarget.value = null;
  if (!target) return;
  if (await app.discardLegacyRecord(target.record, target.dataset)) app.notify('Record discarded.', 'success');
  else app.notify('Record changed or is in use. It was not discarded.', 'error');
}
async function saveRouter() {
  form.busy = true;
  form.status = '';
  try {
    await app.saveOpenRouter(form.key);
    form.key = '';
    form.status = 'Key saved. Account and model access have not been verified.';
    app.notify(form.status, 'success');
  } catch {
    form.status = 'Could not save the key, or the result is uncertain. Check status and retry.';
    app.notify(form.status, 'error');
  } finally { form.busy = false; }
}
async function disconnectRouter() {
  form.busy = true;
  form.status = '';
  try {
    await app.disconnectOpenRouter();
    form.key = '';
    form.status = 'OpenRouter disconnected.';
    app.notify(form.status, 'success');
  } catch {
    form.status = 'Disconnect failed or is uncertain. Check status and retry.';
    app.notify(form.status, 'error');
  } finally { form.busy = false; }
}
</script>

<template>
  <div class="settings-scroll"><div class="setup settings-content">
    <h1 class="page-title">Settings</h1><p class="page-intro">User memory, appearance preferences, and shared provider connections.</p>
    <section class="settings-section"><h2 class="section-title">User</h2><p class="section-help">User memory is available to all your agents.</p><button class="quiet user-memory-link" @click="emit('memory')">View user memory</button></section>
    <section class="settings-section"><h2 class="section-title">Theme</h2><p class="section-help">Choose how Staf looks in this browser.</p>
    <fieldset class="appearance"><legend>Appearance</legend>
      <label v-for="value in appearances" :key="value"><span class="theme-preview" :class="value" aria-hidden="true"><Sun v-if="value === 'light'" :size="24" aria-hidden="true" focusable="false" /><Moon v-else-if="value === 'dark'" :size="24" aria-hidden="true" focusable="false" /><Monitor v-else :size="24" aria-hidden="true" focusable="false" /></span><span class="theme-name"><input type="radio" name="appearance" :value="value" :checked="appearance === value" @change="chooseAppearance(value)" />{{ value[0].toUpperCase() + value.slice(1) }}</span></label>
    </fieldset></section>
    <AppearanceOptions @reset="chooseAppearance('light')" />
    <section class="settings-section"><h2 class="section-title">Provider connections</h2><p class="section-help">Connections belong to this Staf instance and are available to all your agents.</p><div class="providers">
    <div class="provider provider-settings provider-card">
      <div class="provider-title"><h3>ChatGPT</h3><span class="badge">{{ s.credential === 'signed-in' ? 'Sign-in saved' : 'No sign-in saved' }}</span></div>
      <p>{{ s.credential === 'signed-in' ? 'Saved sign-in found for this instance.' : s.credential === 'signed-out' ? 'No usable sign-in found for this instance.' : 'Checking the sign-in for this instance.' }}</p>
      <p v-if="s.credential === 'signed-in'" class="meta">This saved sign-in has not been checked against the provider.</p>
      <p v-if="s.authStatus" role="status">{{ s.authStatus }}</p>
      <p v-if="s.authAttempt">Sign-in {{ s.authAttempt.phase }}{{ s.authAttempt.phase === 'failed' || s.authAttempt.phase === 'expired' ? '. You can try again.' : '' }}</p>
      <p v-if="s.authAttempt?.phase === 'waiting' && (!s.authUrl || s.authUrlAttemptId !== s.authAttempt.id)">The sign-in link is no longer available here. Cancel this attempt and start again.</p>
      <div class="row">
        <button :disabled="s.authStarting || !!s.authAttempt && ['waiting', 'exchanging', 'committing'].includes(s.authAttempt.phase)" @click="app.startAuth()">{{ s.credential === 'signed-in' ? 'Sign in again' : 'Connect ChatGPT' }}</button>
        <a v-if="s.authUrl && s.authAttempt?.phase === 'waiting' && s.authUrlAttemptId === s.authAttempt.id" :href="s.authUrl" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Continue sign-in</a>
        <button v-if="s.authAttempt && ['waiting', 'exchanging'].includes(s.authAttempt.phase)" class="quiet" @click="app.cancelAuth()">Cancel sign-in</button>
        <button v-if="s.credential === 'signed-in'" class="quiet" @click="confirmingSignOut = true">Sign out</button>
        <ConfirmAction v-if="confirmingSignOut" title="Sign out of ChatGPT?" message="All agents using ChatGPT on this instance will need a new sign-in." action="Sign out" @cancel="confirmingSignOut = false" @confirm="signOut" />
      </div>
    </div>
    <div class="provider provider-settings provider-card">
      <div class="provider-title"><h3>OpenRouter</h3><span class="badge">{{ s.openrouter === 'saved' ? 'Key saved' : 'No key saved' }}</span></div>
      <p>{{ s.openrouter === 'saved' ? 'API key saved for this instance.' : s.openrouter === 'missing' ? 'No OpenRouter API key saved.' : s.openrouter === 'error' ? 'OpenRouter credential storage is unavailable. Replace or disconnect the key.' : 'Checking the OpenRouter connection.' }}</p>
      <p class="meta">A saved key does not verify account or model access.</p>
      <label>OpenRouter API key<input v-model="form.key" type="password" autocomplete="off" :disabled="form.busy" /></label>
      <div class="row">
        <button :disabled="form.busy || !form.key" @click="saveRouter">{{ s.openrouter === 'saved' ? 'Replace OpenRouter key' : 'Save OpenRouter key' }}</button>
        <button v-if="s.openrouter === 'saved' || s.openrouter === 'error'" class="quiet" :disabled="form.busy" @click="disconnectRouter">Disconnect OpenRouter</button>
      </div>
      <p role="status">{{ form.status }}</p>
    </div>
    </div></section>
    <section v-if="s.connection.kind === 'ready' && s.legacyRecords.length" class="settings-section">
      <h2 class="section-title">Earlier browser records</h2>
      <p class="section-help">These records have no dataset identity, so Staf cannot verify where they belong. Copy any text you need. Staf will not send them or attach them to this instance automatically.</p>
      <div v-for="record in s.legacyRecords" :key="record.key" class="provider-card earlier-record">
        <p>{{ record.key }}</p><pre style="white-space: pre-wrap; overflow-wrap: anywhere">{{ recordContent(record.value) }}</pre>
        <div class="row"><button class="quiet" @click="copyRecord(record)">Copy</button><button class="quiet" @click="discardTarget = {record: {...record}, dataset: s.datasetIdentity}">Discard</button></div>
      </div>
      <ConfirmAction v-if="discardTarget" title="Discard this browser record?" message="This removes only the selected saved record from this browser. Copy anything you need first." action="Discard record" @cancel="discardTarget = null" @confirm="discardRecord" />
    </section>
    <ToolSettings />
    <SecretSettings />
    <OutputRecovery />
    <PluginSettings />
    <ProviderDefaults />
    <CoreSettings />
    <div class="row"><button v-if="hasAgentSettings" class="quiet" @click="emit('agentSettings')">Back to agent settings</button><button class="quiet" @click="emit('chat')">Back to chat</button></div>
  </div></div>
</template>
