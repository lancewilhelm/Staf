# Vue frontend for owner maintainability

Accepted on 2026-11-02. The owner chose to replace
React with Vue because familiarity with Vue makes the frontend easier to inspect
and maintain personally. Use Vue single-file components with Composition API and
`<script setup lang="ts">`, preserving the current interface's appearance and
behavior; handle UI improvements separately.

Organize the interface into focused `.vue` components so the owner can find and
edit distinct parts of the interface without navigating one large component.

Retain Vite and the existing backend and shared service contracts. Nuxt was
considered for its familiar conventions; the owner selected Vue with Vite to
keep the migration focused. The delivery is tracked in [issue #55](https://github.com/lancewilhelm/Staf/issues/55).

This changes the frontend technology choice, not the product decisions recorded
in [decisions](../decisions.md).
