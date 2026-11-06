<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import type { Core } from '../controller';
import { useWorkspace } from '../workspace';

const { app, state } = useWorkspace();
const current = shallowRef<Core | null>(null);
const latest = shallowRef<Core | null>(null);
const draft = ref('');
const busy = ref(false);
const needsComparison = ref(false);
const status = ref('');
const cacheNotice = 'This change may reduce provider prompt cache reuse on the next message. Actual cache use depends on the provider.';

onMounted(async () => {
  try { current.value = await app.core(); draft.value = current.value.content; }
  catch (error) { needsComparison.value = true; status.value = 'Could not load the core. Compare the latest core to retry. ' + String(error); }
});
async function compare() {
  busy.value = true;
  try {
    const value = await app.core();
    if (!current.value) draft.value = value.content;
    current.value = value;
    latest.value = value;
    needsComparison.value = false;
    status.value = 'Review the current core below and reconcile your retained draft before saving.';
  } catch (error) { status.value = 'Could not load the current core. Your draft is retained. ' + String(error); }
  finally { busy.value = false; }
}
async function save(reset: boolean) {
  if (!current.value || busy.value || needsComparison.value) return;
  busy.value = true;
  const before = current.value;
  try {
    const saved = await app.saveCore(before.revision, reset ? null : draft.value);
    current.value = saved;
    const retainedDraft = reset && draft.value !== before.content;
    if (!retainedDraft) draft.value = saved.content;
    latest.value = retainedDraft ? saved : null;
    status.value = reset ? 'Core reset to the latest built-in text.' + (retainedDraft ? ' Your unsaved draft is retained.' : '') : 'Core saved.';
    if (saved.content !== before.content && state.value.bots.some(bot => !bot.archived && bot.provider !== 'demo')) app.notify(status.value + ' ' + cacheNotice, 'success');
  } catch (error) {
    needsComparison.value = true;
    status.value = 'The save failed or its result is uncertain. Your draft is retained. Compare the latest core before retrying. ' + String(error);
  } finally { busy.value = false; }
}
</script>

<template>
  <section class="settings-section core-settings" aria-label="Shared core guidance">
    <h2 class="section-title">Advanced Settings</h2>
    <h3>Shared core guidance</h3>
    <p>These instance-wide instructions apply to all agents' next accepted work. They replace the built-in core and do not grant permissions. Work already in progress keeps its captured instructions.</p>
    <template v-if="current">
      <p>Source: {{ current.source === 'default' ? 'Built-in default' : 'Override' }}. Host file: <code>{{ current.path }}</code></p>
      <p v-if="current.source === 'override' && current.content === ''">The saved override is empty.</p>
      <label>Effective core<textarea v-model="draft" :disabled="busy" rows="12" /></label>
      <p class="meta">An empty saved override is valid and removes the shared core guidance.</p>
      <details class="saved-settings"><summary>View latest built-in core</summary><pre>{{ current.defaultContent }}</pre></details>
      <div class="row"><button :disabled="busy || needsComparison" @click="save(false)">Save core</button><button class="quiet" :disabled="busy || needsComparison" @click="save(true)">Reset core</button></div>
    </template>
    <p role="status">{{ busy ? 'Loading or saving…' : status }}</p>
    <button class="quiet" :disabled="busy" @click="compare">Compare latest core</button>
    <section v-if="latest" class="saved-settings" aria-label="Current saved core">
      <h3>Current saved core</h3><p>Source: {{ latest.source }}</p><pre>{{ latest.content || '(empty override)' }}</pre>
    </section>
  </section>
</template>
