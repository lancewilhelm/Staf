// THROWAWAY: one gallery mixing rounded shapes and regular polygons in the workspace.
// All agent, chat, crop, and appearance changes live only in this page's memory.
const root = document.getElementById('prototype-app');
let view = 'chat', sidebar = 'expanded', theme = 'light', draft = null, chooser = false;
let fileError = '', drag = null, lastAction = 'Ready', nextId = 200;
const agents = [
  {id: 'prototype-agent-a101', name: 'Milo', family: 'A', shape: 1, color: 0},
  {id: 'prototype-agent-b202', name: 'Scout', family: 'C', shape: 0, color: 4},
  {id: 'prototype-agent-c303', name: 'Lumen', family: 'A', shape: 2, color: 2},
  {id: 'prototype-agent-d404', name: 'Atlas', family: 'C', shape: 1, color: 5},
  {id: 'prototype-agent-e505', name: 'Scout', family: 'C', shape: 2, color: 6},
  {id: 'prototype-agent-f606', name: 'Notes', family: 'A', shape: 0, color: 3},
].map(({id, name, family, shape, color}, index) => ({id, name, instructions: 'Be thoughtful, clear, and practical.', image: index === 5 ? {kind: 'initials'} : {kind: 'avatar', family, shape, color}, messages: []}));
let selectedId = agents[0].id;
const sampleMessages = [
  {role: 'user', text: 'Help me make a little room for a creative project this week.'},
  {role: 'assistant', text: 'Let’s keep it small enough to actually happen.\n\nPick one thing you’d enjoy making, then give it two short sessions:\n\n• Tuesday: collect a few ideas and choose a starting point.\n• Thursday: make one rough version.\n\nLeave the finishing for later. What would you like to make?'},
  {role: 'user', text: 'Something playful. Maybe a few little characters.'},
  {role: 'assistant', text: 'Start with a shape and a pair of eyes. Try a circle, a bend, or a lopsided little polygon.\n\nKeep the same eyes across the set. That small bit of consistency will make them feel like they belong together.'},
];
for (const agent of agents) agent.messages = structuredClone(sampleMessages);
const selected = () => agents.find(agent => agent.id === selectedId) ?? agents[0];
const avatarName = image => families.find(group => group.id === image.family).shapes[image.shape];
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const icon = name => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${{plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6', gear: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', panel: 'M3 4h18v16H3ZM9 4v16'}[name]}"/></svg>`;
const brand = '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="currentColor"><circle cx="50" cy="14" r="11"/><circle cx="84.24" cy="38.88" r="11"/><circle cx="71.16" cy="79.12" r="11"/><circle cx="28.84" cy="79.12" r="11"/><circle cx="15.76" cy="38.88" r="11"/></g></svg>';

function imageMarkup(image, name, size = 30) {
  const content = image.kind === 'avatar' ? characterSvg(image.family, image.shape, colors[image.color].hex)
    : image.kind === 'upload' ? `<img src="${escapeHtml(image.url)}" alt="">` : escapeHtml(name.trim()[0]?.toUpperCase() ?? 'A');
  return `<span class="p-avatar ${image.kind === 'initials' ? 'p-initial' : ''}" style="width:${size}px;height:${size}px" aria-hidden="true">${content}</span>`;
}
function badge(agent, size = 30) { return imageMarkup(agent.image, agent.name, size); }
function nameMarkup(agent) {
  return escapeHtml(agent.name) + (agents.filter(other => other.name === agent.name).length > 1 ? `<span class="p-duplicate">${escapeHtml(agent.id.slice(-4))}</span>` : '');
}
function label(agent) { return agent.name + (agents.filter(other => other.name === agent.name).length > 1 ? ' · ' + agent.id.slice(-4) : ''); }
function sizesMarkup(image, name) { return `<div class="p-sizes">${[24, 28, 30].map(size => `<figure>${imageMarkup(image, name, size)}<figcaption>${size} px</figcaption></figure>`).join('')}</div>`; }
function paletteMarkup(image, action) {
  return `<div class="p-colors" role="group" aria-label="Character color">${colors.map((color, index) => `<button type="button" class="p-color" data-action="${action}" data-color="${index}" aria-label="${color.name}" title="${color.name}" aria-pressed="${image.kind === 'avatar' && image.color === index}" style="--swatch:${color.hex}"><span></span></button>`).join('')}</div>`;
}
function shapesMarkup(image, action) {
  return families.map(group => `<div class="p-shape-family"><h4>${group.name}</h4><div class="p-shapes" role="group" aria-label="${group.name}">${group.shapes.map((shape, index) => `<button type="button" class="p-shape" data-action="${action}" data-family="${group.id}" data-shape="${index}" aria-label="${shape}" aria-pressed="${image.kind === 'avatar' && image.family === group.id && image.shape === index}">${characterSvg(group.id, index, colors[image.kind === 'avatar' ? image.color : 0].hex)}<span>${shape}</span></button>`).join('')}</div></div>`).join('');
}
function sidebarMarkup() {
  return `<aside class="side" id="agent-sidebar"><div class="sidebar-head"><button class="brand" data-action="chat" aria-label="Staf, return to chat">${brand}<span>staf</span></button>${sidebar === 'expanded' ? panelButton() : ''}</div><div class="caption" id="agents-label">Agents</div><button class="new-agent" data-action="new" aria-label="New agent" title="New agent">${icon('plus')}<span>New agent</span></button><nav aria-labelledby="agents-label">${agents.map(agent => `<button class="agent-nav ${agent.id === selectedId && view === 'chat' ? 'active' : ''}" data-action="select" data-id="${agent.id}" aria-label="${escapeHtml(label(agent))}" title="${escapeHtml(label(agent))}" ${agent.id === selectedId && view === 'chat' ? 'aria-current="page"' : ''}><span class="avatar ${agent.image.kind !== 'initials' ? 'p-character' : ''}">${badge(agent)}</span><span class="identity"><strong>${nameMarkup(agent)}</strong><small>${agent.name === 'Atlas' ? 'OpenRouter' : 'ChatGPT'}</small></span></button>`).join('')}</nav><div class="minor"><button data-action="appearance" aria-label="Settings" title="Settings">${icon('gear')}<span>Settings</span></button><div class="workspace-caption">Personal workspace</div></div></aside>`;
}
function panelButton() { return `<button class="panel-toggle" data-action="sidebar" aria-label="${sidebar === 'expanded' ? 'Collapse sidebar into Focus' : 'Expand sidebar'}" aria-expanded="${sidebar === 'expanded'}" aria-controls="agent-sidebar">${icon('panel')}</button>`; }
function headerMarkup() {
  const agent = selected();
  return `<header class="top">${sidebar === 'focus' ? panelButton() : ''}<button class="avatar p-character" data-action="edit" aria-label="Open agent settings" title="Open agent settings">${badge(agent)}</button><div class="title">${view === 'appearance' ? 'Settings' : nameMarkup(agent)}</div><div class="spacer"></div><button class="header-action" data-action="${view === 'chat' ? 'edit' : 'cancel'}" aria-label="${view === 'chat' ? 'Agent settings' : 'Back to chat'}">${icon(view === 'chat' ? 'gear' : 'close')}</button></header>`;
}
function chatMarkup() {
  const agent = selected();
  return `<div class="workspace"><div class="chat"><div class="messages">${agent.messages.map(message => `<div class="message ${message.role === 'user' ? 'user-message' : ''}">${message.role === 'user' ? `<div class="user-bubble"><div class="who">YOU</div><div class="bubble">${escapeHtml(message.text)}</div></div>` : `<div class="who"><span class="avatar p-character">${badge(agent, 24)}</span>${escapeHtml(agent.name)}</div><div class="bottext">${escapeHtml(message.text)}</div>`}</div>`).join('')}</div><form id="chat-form" class="composer"><textarea id="message-input" name="message" rows="2" placeholder="Message ${escapeHtml(agent.name)}…" aria-label="Message ${escapeHtml(agent.name)}"></textarea><div class="p-compose-hint"><span>ChatGPT <span aria-hidden="true">⌄</span></span><button aria-label="Send message" type="submit">↑</button></div></form></div></div>`;
}
function studyMarkup() {
  const agent = selected();
  return `<aside class="p-study" aria-label="Avatar gallery"><span class="eyebrow">CHARACTER STUDY</span><h2>Rounded + polygons</h2><p>Simple shapes. Little black eyes.</p><div class="p-hero">${badge(agent, 84)}</div>${sizesMarkup(agent.image, agent.name)}${shapesMarkup(agent.image, 'try-shape')}${paletteMarkup(agent.image, 'try-color')}<button class="quiet p-edit" data-action="choose">Try shapes & colors</button><p>One gallery. Pick any shape.<br>The same eight colors.</p>${agent.image.kind === 'avatar' ? '<a class="p-download" href="#" data-action="download">Download this character as SVG ↗</a>' : ''}</aside>`;
}
function uploadMarkup() {
  const image = draft.image;
  return `<label>Choose an image<input id="upload-input" type="file" accept="image/*"></label><button class="quiet" type="button" data-action="sample-upload">Try a sample image</button>${fileError ? `<p class="p-file-error" role="alert">${escapeHtml(fileError)}</p>` : ''}${image.kind === 'upload' ? `<div class="p-crop-row"><div class="p-crop" title="Drag to reposition" aria-label="Crop preview. Drag to reposition; sliders are also available."><img id="crop-image" src="${escapeHtml(image.url)}" alt="Square crop preview" draggable="false"></div><div class="p-crop-controls">${[['zoom', 'Zoom', 1, 3], ['x', 'Horizontal position', -1, 1], ['y', 'Vertical position', -1, 1]].map(([field, title, min, max]) => `<label>${title}<input id="crop-${field}" data-crop="${field}" aria-label="${title}" type="range" min="${min}" max="${max}" step=".01" value="${image[field]}"></label>`).join('')}</div></div><p class="p-edit-note">Drag the image or use the sliders. The small previews show the final crop.</p>` : '<p class="p-edit-note">Choose a photo or try the sample to preview a square crop.</p>'}`;
}
function chooserMarkup() {
  if (!chooser) return '';
  const image = draft.image;
  const mode = image.kind === 'upload-pending' ? 'upload' : image.kind;
  const preview = image.kind === 'upload-pending' ? {kind: 'initials'} : image;
  return `<section class="p-chooser" aria-label="Agent image chooser"><h3>Agent image</h3><div class="p-mode-row" role="group" aria-label="Image type">${[['initials', 'Initials'], ['avatar', 'Built-in avatar'], ['upload', 'Uploaded image']].map(([kind, title]) => `<button type="button" class="p-mode" data-action="mode" data-kind="${kind}" aria-pressed="${mode === kind}">${title}</button>`).join('')}</div><div class="p-preview-head"><span data-draft-preview="80">${imageMarkup(preview, draft.name, 80)}</span><div data-draft-sizes>${sizesMarkup(preview, draft.name)}</div></div>${mode === 'avatar' ? `<h3>Shape</h3>${shapesMarkup(image, 'shape')}<h3 style="margin-top:20px">Color <span class="meta">· ${colors[image.color].name}</span></h3>${paletteMarkup(image, 'color')}` : mode === 'upload' ? uploadMarkup() : '<p class="p-edit-note">Use the first letter of this agent’s name.</p>'}</section>`;
}
function formMarkup(isNew) {
  return `<form id="agent-form"><div class="${isNew ? 'modal-head' : ''}">${isNew ? '<h2>Create agent</h2><button type="button" class="icon-button" data-action="cancel" aria-label="Close dialog">' + icon('close') + '</button>' : '<span class="eyebrow">AGENT SETTINGS</span><h1 class="page-title">' + escapeHtml(draft.name || 'Agent settings') + '</h1>'}</div><p class="page-intro">${isNew ? 'Choose a name and optional instructions.' : 'Edit this agent’s name, image, and instructions.'}</p><label>Name<input id="agent-name" name="name" value="${escapeHtml(draft.name)}" placeholder="e.g. Robin" required></label><div class="p-image-summary"><span data-draft-summary>${imageMarkup(draft.image.kind === 'upload-pending' ? {kind: 'initials'} : draft.image, draft.name, 40)}</span><div><button class="quiet" type="button" data-action="toggle-chooser">${chooser ? 'Close image chooser' : 'Change image'}</button><p class="meta">${draft.image.kind === 'initials' ? 'Initials' : draft.image.kind === 'avatar' ? avatarName(draft.image) + ' · ' + colors[draft.image.color].name : 'Uploaded image'}</p></div></div>${chooserMarkup()}<label>Instructions<textarea id="agent-instructions" name="instructions">${escapeHtml(draft.instructions)}</textarea></label><div class="p-form-actions"><button type="submit" ${draft.image.kind === 'upload-pending' ? 'disabled' : ''}>${isNew ? 'Create agent' : 'Save changes'}</button><button class="quiet" type="button" data-action="cancel">Cancel</button></div><p class="p-edit-note">Preview first. Your choice applies when you ${isNew ? 'create the agent' : 'save changes'}.</p></form>`;
}
function appearanceMarkup() {
  return `<div class="settings-scroll"><div class="setup settings-content"><span class="eyebrow">WORKSPACE SETTINGS</span><h1 class="page-title">Appearance</h1><p class="page-intro">Choose how this workspace looks.</p><h2 class="section-title">Theme</h2><div class="p-appearance">${['light', 'dark'].map(value => `<button class="quiet" data-action="theme" data-theme="${value}" aria-pressed="${theme === value}">${value === 'light' ? 'Light' : 'Dark'}</button>`).join('')}</div><h2 class="section-title">Sidebar</h2><button class="quiet" data-action="sidebar">${sidebar === 'expanded' ? 'Use Focus rail' : 'Expand sidebar'}</button><div class="p-form-actions"><button class="quiet" data-action="chat">Back to chat</button></div></div></div>`;
}
function stateLabel() {
  const agent = selected(), image = agent.image;
  const saved = image.kind === 'avatar' ? `${avatarName(image)} · ${colors[image.color].name}` : image.kind === 'upload' ? 'Uploaded image' : 'Initials';
  const editing = draft ? ` · unsaved ${draft.image.kind === 'avatar' ? avatarName(draft.image) + '/' + colors[draft.image.color].name : draft.image.kind}` : '';
  return `${agent.name} · ${saved}${editing} · ${lastAction}`;
}
function barMarkup() {
  return `<div class="p-bar" aria-label="Prototype controls"><div class="p-bar-top"><span class="p-family-label">Rounded shapes + regular polygons</span><button data-action="theme" data-theme="${theme === 'light' ? 'dark' : 'light'}" aria-label="Switch to ${theme === 'light' ? 'dark' : 'light'} theme">${theme === 'light' ? '◐ Dark' : '◑ Light'}</button></div><output id="prototype-state" aria-live="polite">${escapeHtml(stateLabel())}</output><div class="p-bottom">PROTOTYPE · Changes stay in this page</div></div>`;
}
function render() {
  const focused = document.activeElement;
  const focusId = focused?.id;
  const selection = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement ? focused.selectionStart : null;
  const oldScroll = document.querySelector('.messages')?.scrollTop ?? 0;
  document.documentElement.dataset.appearance = theme;
  root.innerHTML = `<div class="shell" data-sidebar="${sidebar}">${sidebarMarkup()}<main class="main">${headerMarkup()}<div class="p-content">${view === 'edit' ? `<div class="settings-scroll"><div class="setup settings-content agent-settings">${formMarkup(false)}</div></div>` : view === 'appearance' ? appearanceMarkup() : chatMarkup()}${view !== 'appearance' ? studyMarkup() : ''}</div></main></div>${view === 'new' ? `<dialog class="modal setup p-create" aria-label="Create agent">${formMarkup(true)}</dialog>` : ''}${barMarkup()}`;
  if (view === 'new') {
    const dialog = root.querySelector('dialog');
    dialog.showModal();
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
  }
  const restore = focusId ? document.getElementById(focusId) : null;
  if (restore) { restore.focus(); if (selection !== null && restore instanceof HTMLInputElement && restore.type === 'text') restore.setSelectionRange(selection, selection); }
  const messages = root.querySelector('.messages');
  if (messages) messages.scrollTop = oldScroll;
}
function beginEdit({isNew = false, openChooser = false} = {}) {
  const agent = selected();
  draft = isNew ? {id: null, name: '', instructions: '', image: {kind: 'initials'}} : {id: agent.id, name: agent.name, instructions: agent.instructions, image: copyImage(agent.image)};
  view = isNew ? 'new' : 'edit'; chooser = openChooser; fileError = ''; lastAction = 'Preview'; render();
  if (isNew) document.getElementById('agent-name')?.focus();
}
function cancel() { draft = null; chooser = false; view = 'chat'; fileError = ''; lastAction = 'Cancelled'; render(); document.querySelector('[data-action="edit"]')?.focus(); }
function updateDraftViews() {
  if (!draft) return;
  const image = draft.image.kind === 'upload-pending' ? {kind: 'initials'} : draft.image;
  for (const node of document.querySelectorAll('[data-draft-preview]')) node.innerHTML = imageMarkup(image, draft.name, Number(node.dataset.draftPreview));
  for (const node of document.querySelectorAll('[data-draft-sizes]')) node.innerHTML = sizesMarkup(image, draft.name);
  for (const node of document.querySelectorAll('[data-draft-summary]')) node.innerHTML = imageMarkup(image, draft.name, 40);
  const output = document.getElementById('prototype-state'); if (output) output.textContent = stateLabel();
}
function cropImage() {
  if (draft?.image.kind !== 'upload') return;
  const image = draft.image, canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const side = Math.min(image.width, image.height) / image.zoom;
  const sx = (image.width - side) * (image.x + 1) / 2, sy = (image.height - side) * (image.y + 1) / 2;
  canvas.getContext('2d').drawImage(image.source, sx, sy, side, side, 0, 0, 256, 256);
  image.url = canvas.toDataURL('image/png');
  const preview = document.getElementById('crop-image'); if (preview) preview.src = image.url;
  for (const field of ['zoom', 'x', 'y']) { const input = document.getElementById('crop-' + field); if (input) input.value = image[field]; }
  updateDraftViews();
}
async function loadUpload(url) {
  const editing = draft;
  const source = new Image();
  try { source.src = url; await source.decode(); }
  catch { if (draft === editing) { fileError = 'This image could not be opened. Choose another image.'; render(); } return; }
  if (!draft || draft !== editing) return;
  draft.image = {kind: 'upload', source, width: source.naturalWidth, height: source.naturalHeight, zoom: 1, x: 0, y: 0, url: ''};
  fileError = ''; cropImage(); render();
}
function sampleUpload() {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 320;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#E9C583'; ctx.fillRect(0, 0, 480, 320);
  ctx.fillStyle = '#D67B69'; ctx.beginPath(); ctx.arc(340, 98, 57, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6A978B'; ctx.beginPath(); ctx.moveTo(0, 260); ctx.lineTo(156, 90); ctx.lineTo(370, 320); ctx.lineTo(0, 320); ctx.fill();
  ctx.fillStyle = '#244F46'; ctx.beginPath(); ctx.moveTo(160, 320); ctx.lineTo(385, 150); ctx.lineTo(480, 244); ctx.lineTo(480, 320); ctx.fill();
  void loadUpload(canvas.toDataURL('image/png'));
}
function copyImage(image) {
  // Canvas sources remain local DOM objects; everything else is a value.
  return {...image};
}
root.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  if (button.tagName === 'A') event.preventDefault();
  if (action === 'sidebar') { sidebar = sidebar === 'expanded' ? 'focus' : 'expanded'; render(); }
  else if (action === 'theme') { theme = button.dataset.theme; render(); }
  else if (action === 'new') beginEdit({isNew: true});
  else if (action === 'edit' || action === 'choose') beginEdit({openChooser: action === 'choose'});
  else if (action === 'cancel') cancel();
  else if (action === 'chat' || action === 'select') { if (button.dataset.id) selectedId = button.dataset.id; draft = null; chooser = false; view = 'chat'; lastAction = 'Selected'; render(); }
  else if (action === 'appearance') { draft = null; view = 'appearance'; render(); }
  else if (action === 'toggle-chooser') { chooser = !chooser; render(); }
  else if (action === 'mode') {
    const kind = button.dataset.kind;
    draft.image = kind === 'avatar' ? {kind: 'avatar', family: 'A', shape: 0, color: 0} : kind === 'upload' ? {kind: 'upload-pending'} : {kind: 'initials'};
    fileError = ''; render();
  } else if (action === 'shape' || action === 'color') {
    if (draft.image.kind !== 'avatar') draft.image = {kind: 'avatar', family: 'A', shape: 0, color: 0};
    if (action === 'shape') draft.image.family = button.dataset.family;
    draft.image[action] = Number(button.dataset[action]); render();
  } else if (action === 'try-shape' || action === 'try-color') {
    beginEdit({openChooser: true});
    if (draft.image.kind !== 'avatar') draft.image = {kind: 'avatar', family: 'A', shape: 0, color: 0};
    if (action === 'try-shape') draft.image.family = button.dataset.family;
    const field = action === 'try-shape' ? 'shape' : 'color'; draft.image[field] = Number(button.dataset[field]); render();
  } else if (action === 'sample-upload') sampleUpload();
  else if (action === 'download' && selected().image.kind === 'avatar') {
    const image = selected().image, link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([characterSvg(image.family, image.shape, colors[image.color].hex)], {type: 'image/svg+xml'}));
    link.href = url; link.download = `staf-${image.family}-${avatarName(image).toLowerCase().replaceAll(' ', '-')}-${colors[image.color].name.toLowerCase()}.svg`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});
root.addEventListener('input', event => {
  const input = event.target;
  if (input.id === 'agent-name') { draft.name = input.value; updateDraftViews(); }
  else if (input.id === 'agent-instructions') draft.instructions = input.value;
  else if (input.dataset.crop && draft?.image.kind === 'upload') { draft.image[input.dataset.crop] = Number(input.value); cropImage(); }
});
root.addEventListener('change', event => {
  if (event.target.id !== 'upload-input') return;
  const file = event.target.files[0]; if (!file) return;
  const editing = draft, reader = new FileReader();
  reader.onload = () => { if (draft === editing && typeof reader.result === 'string') void loadUpload(reader.result); };
  reader.readAsDataURL(file);
});
root.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'agent-form' && draft && draft.name.trim() && draft.image.kind !== 'upload-pending') {
    const image = draft.image.kind === 'upload-pending' ? {kind: 'initials'} : copyImage(draft.image);
    if (view === 'new') { const agent = {id: 'prototype-agent-' + ++nextId, name: draft.name.trim(), instructions: draft.instructions, image, messages: []}; agents.push(agent); selectedId = agent.id; }
    else Object.assign(selected(), {name: draft.name.trim(), instructions: draft.instructions, image});
    draft = null; chooser = false; view = 'chat'; lastAction = 'Saved in this page'; render();
  } else if (event.target.id === 'chat-form') {
    const input = document.getElementById('message-input'); if (!input.value.trim()) return;
    selected().messages.push({role: 'user', text: input.value.trim()}, {role: 'assistant', text: 'A shape and a pair of eyes can go a long way. Try a rounded character alongside one of the polygons.'}); render();
    const messages = document.querySelector('.messages'); messages.scrollTop = messages.scrollHeight;
  }
});
root.addEventListener('pointerdown', event => {
  const crop = event.target.closest('.p-crop'); if (!crop || draft?.image.kind !== 'upload') return;
  drag = {clientX: event.clientX, clientY: event.clientY, x: draft.image.x, y: draft.image.y, size: crop.clientWidth}; crop.setPointerCapture(event.pointerId);
});
root.addEventListener('pointermove', event => {
  if (!drag || draft?.image.kind !== 'upload') return;
  draft.image.x = Math.max(-1, Math.min(1, drag.x - (event.clientX - drag.clientX) * 2 / drag.size));
  draft.image.y = Math.max(-1, Math.min(1, drag.y - (event.clientY - drag.clientY) * 2 / drag.size)); cropImage();
});
for (const type of ['pointerup', 'pointercancel']) root.addEventListener(type, () => { drag = null; });
document.addEventListener('keydown', event => {
  if (event.target.id === 'message-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.target.form.requestSubmit(); return; }
  if (event.target.closest('input,textarea,select,[contenteditable=true],[role=slider]') || view === 'new') return;
  if (event.key === 'Escape' && view !== 'chat') cancel();
});
render();
