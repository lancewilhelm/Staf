<script setup lang="ts">
import { useWorkspace } from '../workspace';
import { type Appearance, saveAppearance } from '../appearance';
import ProviderDefaults from './ProviderDefaults.vue';
import AppearanceOptions from './AppearanceOptions.vue';
const props = defineProps<{appearance: Appearance; hasAgentSettings: boolean; routerForm: {key: string; status: string; busy: boolean}}>();
const form = props.routerForm;
const emit = defineEmits<{'update:appearance': [value: Appearance]; agentSettings: []; chat: []; memory: []}>();
const {app, state: s} = useWorkspace();
const appearances: Appearance[] = ['light', 'dark', 'system'];
function chooseAppearance(value: Appearance) { emit('update:appearance', value); saveAppearance(value); }
function signOut() {
  if (window.confirm('Sign out of ChatGPT for this Staf instance? All agents using it will need a new sign-in.')) void app.signOutAuth();
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
      <label v-for="value in appearances" :key="value"><span class="theme-preview" :class="value" aria-hidden="true"><i /><span><b /><em /></span></span><span class="theme-name"><input type="radio" name="appearance" :value="value" :checked="appearance === value" @change="chooseAppearance(value)" />{{ value[0].toUpperCase() + value.slice(1) }}</span></label>
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
        <button v-if="s.credential === 'signed-in'" class="quiet" @click="signOut">Sign out</button>
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
    <ProviderDefaults />
    <div class="row"><button v-if="hasAgentSettings" class="quiet" @click="emit('agentSettings')">Back to agent settings</button><button class="quiet" @click="emit('chat')">Back to chat</button></div>
  </div></div>
</template>
