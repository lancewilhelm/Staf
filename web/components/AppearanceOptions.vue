<script setup lang="ts">
import { design, designDefaults } from '../design';
import UiIcon from './UiIcon.vue';
const emit = defineEmits<{reset: []}>();
const palettes = [{id: 'green', label: 'Evergreen', colors: ['#173d34', '#dae8d7', '#f6f4ee']}, {id: 'ink', label: 'Ink', colors: ['#202e42', '#e0e6ee', '#f6f4ee']}] satisfies {id: 'green' | 'ink'; label: string; colors: string[]}[];
</script>
<template>
  <section class="settings-section"><h2 class="section-title">Color palette</h2><div class="palette-grid"><button v-for="palette in palettes" :key="palette.id" class="palette-card" :aria-pressed="design.palette === palette.id" @click="design.palette = palette.id"><span class="palette-colors" aria-hidden="true"><i v-for="color in palette.colors" :key="color" :style="{background: color}" /></span><span>{{ palette.label }}</span><span class="palette-check"><UiIcon name="check" /></span></button></div></section>
  <details class="appearance-details"><summary>Layout and typography</summary><div class="appearance-fields">
    <label>Font<select v-model="design.font"><option value="sans">DM Sans</option><option value="system">System sans</option></select></label>
    <label>Text size <output>{{ design.body }}px</output><input v-model.number="design.body" type="range" min="13" max="17" aria-label="Text size" /></label>
    <label>Spacing <output>{{ design.space }}px</output><input v-model.number="design.space" type="range" min="14" max="32" aria-label="Spacing" /></label>
    <label>Corners <output>{{ design.corner }}px</output><input v-model.number="design.corner" type="range" min="0" max="22" aria-label="Corners" /></label>
    <button class="text-action" @click="Object.assign(design, designDefaults); emit('reset')">Reset appearance</button></div>
  </details>
</template>
