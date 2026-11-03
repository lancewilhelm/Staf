import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

if (typeof globalThis.crypto?.randomUUID !== 'function') {
  const root = document.getElementById('root');
  if (root) root.textContent = 'Staf requires a browser with secure random UUID support. Update your browser and open Staf on localhost or a secure connection.';
  throw new Error('Secure random UUID support is unavailable');
}
createApp(App).mount('#root');
