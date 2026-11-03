<script setup lang="ts">
const explanation = "Instructions are standing guidance for the agent's personality, role, and behavior. They populate the agent's soul.md document and are optional.";
</script>

<template>
  <details class="instructions-help"><summary :title="explanation">About Instructions</summary><p>{{ explanation }}</p></details>
</template>
