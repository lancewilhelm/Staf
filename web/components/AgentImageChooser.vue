<script setup lang="ts">
import {computed,nextTick,onUnmounted,ref,shallowRef,watch} from 'vue';
import {agentImageColors,agentImageShapes,agentImageSize,isAgentImageColor,isAgentImageShape,type AgentImageColor,type AgentImageInput,type AgentImageShape} from '../../src/agent-image';
import AgentImage from './AgentImage.vue';
const props=defineProps<{modelValue:AgentImageInput;name:string;disabled?:boolean}>();
const emit=defineEmits<{'update:modelValue':[value:AgentImageInput];valid:[value:boolean]}>();
type Mode='initials'|'avatar'|'upload';
const open=ref(false),busy=ref(false),error=ref(''),unavailable=ref(false);
const mode=ref<Mode>(props.modelValue.kind==='upload-data'?'upload':props.modelValue.kind);
const lastAvatar=ref<{kind:'avatar';shape:AgentImageShape;color:AgentImageColor}>(props.modelValue.kind==='avatar'?props.modelValue:{kind:'avatar',shape:'circle',color:'apricot'});
const source=shallowRef<ImageBitmap|null>(null),canvas=ref<HTMLCanvasElement|null>(null);
const zoom=ref(1),horizontal=ref(0),vertical=ref(0);
const shapes=Object.keys(agentImageShapes).filter(isAgentImageShape);
const colors=Object.keys(agentImageColors).filter(isAgentImageColor);
const groups=[...new Set(Object.values(agentImageShapes).map(shape=>shape.group))];
const pending=computed(()=>mode.value==='upload' && !['upload','upload-data'].includes(props.modelValue.kind));
const preview=computed<AgentImageInput>(()=>pending.value?{kind:'initials'}:props.modelValue);
const color=computed(()=>props.modelValue.kind==='avatar'?props.modelValue.color:lastAvatar.value.color);
let generation=0;
let drag:{pointer:number;clientX:number;clientY:number;x:number;y:number;size:number}|null=null;
watch([pending,busy],()=>emit('valid',!pending.value&&!busy.value),{immediate:true});
watch(()=>props.modelValue,value=>{if(value.kind==='avatar')lastAvatar.value=value;unavailable.value=false;});
onUnmounted(()=>{generation++;source.value?.close();});
function selectMode(value:Mode){
  if(props.disabled||busy.value)return;
  mode.value=value;error.value='';
  if(value==='initials')emit('update:modelValue',{kind:'initials'});
  if(value==='avatar')emit('update:modelValue',lastAvatar.value);
}
function shape(value:AgentImageShape){emit('update:modelValue',{kind:'avatar',shape:value,color:color.value});}
function chooseColor(value:AgentImageColor){emit('update:modelValue',{kind:'avatar',shape:lastAvatar.value.shape,color:value});}
function crop(){
  if(!source.value||!canvas.value)return;
  const context=canvas.value.getContext('2d');if(!context)return;
  const bitmap=source.value,side=Math.min(bitmap.width,bitmap.height)/zoom.value;
  context.clearRect(0,0,agentImageSize,agentImageSize);
  context.drawImage(bitmap,(bitmap.width-side)*(horizontal.value+1)/2,(bitmap.height-side)*(vertical.value+1)/2,side,side,0,0,agentImageSize,agentImageSize);
  const png=canvas.value.toDataURL('image/png').split(',')[1];
  if(png)emit('update:modelValue',{kind:'upload-data',png});
}
watch([source,canvas,zoom,horizontal,vertical],crop,{flush:'post'});
async function upload(event:Event){
  if(!(event.target instanceof HTMLInputElement))return;
  const file=event.target.files?.[0];if(!file)return;
  const current=++generation;error.value='';
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){error.value='Choose a PNG, JPEG, or WebP image.';return;}
  if(file.size>10*1024*1024){error.value='Choose an image up to 10 MiB.';return;}
  busy.value=true;
  try {
    const bitmap=await createImageBitmap(file);
    if(current!==generation){bitmap.close();return;}
    if(bitmap.width>8192||bitmap.height>8192||bitmap.width*bitmap.height>24_000_000){bitmap.close();throw Error('Choose an image up to 8192 pixels per side and 24 megapixels.');}
    source.value?.close();source.value=bitmap;zoom.value=1;horizontal.value=0;vertical.value=0;
    await nextTick();crop();
  } catch(value){if(current===generation)error.value=value instanceof Error?value.message:'The image could not be opened. Choose another image.';}
  finally {if(current===generation)busy.value=false;}
}
function startDrag(event:PointerEvent){
  if(props.disabled||!canvas.value||event.button!==0)return;
  drag={pointer:event.pointerId,clientX:event.clientX,clientY:event.clientY,x:horizontal.value,y:vertical.value,size:canvas.value.clientWidth};canvas.value.setPointerCapture(event.pointerId);
}
function move(event:PointerEvent){
  if(!drag||event.pointerId!==drag.pointer||props.disabled)return;
  horizontal.value=Math.max(-1,Math.min(1,drag.x-(event.clientX-drag.clientX)*2/drag.size));
  vertical.value=Math.max(-1,Math.min(1,drag.y-(event.clientY-drag.clientY)*2/drag.size));
}
</script>

<template>
  <div class="agent-image-editor">
    <div class="image-summary"><AgentImage :image="preview" :name="name" :size="30" @unavailable="unavailable=true" /><button class="quiet" type="button" :disabled="disabled" :aria-expanded="open" @click="open=!open">{{ open?'Close image chooser':'Change image' }}</button></div>
    <p v-if="unavailable" class="image-help" role="status">Image unavailable. Choose another image or use initials.</p>
    <fieldset v-if="open" class="image-chooser" :disabled="disabled||busy" aria-label="Agent image chooser">
      <legend>Agent image</legend>
      <div class="image-modes" role="group" aria-label="Image type"><button v-for="choice in [{kind:'initials',label:'Initials'},{kind:'avatar',label:'Built-in avatar'},{kind:'upload',label:'Uploaded image'}]" :key="choice.kind" type="button" :aria-pressed="mode===choice.kind" @click="selectMode(choice.kind==='avatar'?'avatar':choice.kind==='upload'?'upload':'initials')">{{ choice.label }}</button></div>
      <div class="image-previews"><AgentImage :image="preview" :name="name" :size="80" /><figure v-for="size in [24,28,30]" :key="size"><AgentImage :image="preview" :name="name" :size="size===24?24:size===28?28:30" /><figcaption>{{ size }} px</figcaption></figure></div>
      <template v-if="mode==='avatar'">
        <div v-for="group in groups" :key="group" class="image-shape-group"><h3>{{ group }}</h3><div class="image-shapes" role="group" :aria-label="group"><button v-for="id in shapes.filter(id=>agentImageShapes[id].group===group)" :key="id" :data-image-shape="id" type="button" :aria-pressed="modelValue.kind==='avatar'&&modelValue.shape===id" @click="shape(id)"><AgentImage :image="{kind:'avatar',shape:id,color}" :name="name" :size="30" /><span>{{ agentImageShapes[id].label }}</span></button></div></div>
        <h3>Color</h3><div class="image-colors" role="group" aria-label="Character color"><button v-for="id in colors" :key="id" :data-image-color="id" type="button" :aria-label="agentImageColors[id].label" :title="agentImageColors[id].label" :aria-pressed="color===id" @click="chooseColor(id)"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9" :fill="agentImageColors[id].hex" /></svg></button></div>
      </template>
      <template v-if="mode==='upload'">
        <label>Choose an image<input type="file" accept="image/png,image/jpeg,image/webp" @change="upload"></label>
        <p class="image-help">PNG, JPEG, or WebP. Up to 10 MiB, 8192 pixels per side, and 24 megapixels.</p>
        <div v-if="source" class="image-crop-controls"><canvas ref="canvas" class="image-crop" :width="agentImageSize" :height="agentImageSize" aria-label="Crop preview. Drag to reposition or use the sliders." @pointerdown="startDrag" @pointermove="move" @pointerup="drag=null" @pointercancel="drag=null" @lostpointercapture="drag=null" /><div><label>Zoom<input v-model.number="zoom" type="range" min="1" max="3" step=".01"></label><label>Horizontal position<input v-model.number="horizontal" type="range" min="-1" max="1" step=".01"></label><label>Vertical position<input v-model.number="vertical" type="range" min="-1" max="1" step=".01"></label></div></div>
      </template>
      <p class="image-help">Preview changes here. They apply when you {{ name.trim()?'save the form':'create the agent' }}.</p>
    </fieldset>
    <p v-if="busy" class="image-help" role="status">Opening image…</p><p v-if="error" class="image-error" role="alert">{{ error }}</p>
  </div>
</template>
