<script setup lang="ts">
import { design, designDefaults, logoNames } from '../design';
import BrandMark from './BrandMark.vue';
</script>
<template>
  <section class="palette-options"><h3>Color palette</h3><div class="row"><button v-for="palette in (['green', 'ink'] as const)" :key="palette" class="palette-card quiet" :aria-pressed="design.palette === palette" @click="design.palette = palette"><span class="palette-swatch" :style="{background: palette === 'green' ? '#173d34' : '#202e42'}" />{{ palette === 'green' ? 'Evergreen' : 'Ink' }}</button></div></section>
  <details class="appearance-details"><summary>Layout and typography</summary>
    <label>Sidebar<select v-model="design.sidebar"><option value="expanded">Expanded</option><option value="focus">Focus rail</option></select></label>
    <label>Font<select v-model="design.font"><option value="sans">DM Sans</option><option value="system">System sans</option></select></label>
    <label>Text size <output>{{ design.body }}px</output><input v-model.number="design.body" type="range" min="13" max="17" aria-label="Text size" /></label>
    <label>Spacing <output>{{ design.space }}px</output><input v-model.number="design.space" type="range" min="14" max="32" aria-label="Spacing" /></label>
    <label>Corners <output>{{ design.corner }}px</output><input v-model.number="design.corner" type="range" min="0" max="22" aria-label="Corners" /></label>
    <p>Logo</p><div class="logo-options"><button v-for="(name, index) in logoNames" :key="name" class="quiet" :aria-label="'Use ' + name + ' logo'" :title="name" :aria-pressed="design.logo === index" @click="design.logo = index"><BrandMark :index="index" /></button></div>
    <button class="quiet" @click="Object.assign(design, designDefaults)">Reset layout and typography</button>
  </details>
</template>
