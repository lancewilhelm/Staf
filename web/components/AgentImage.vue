<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {avatarSvg,type AgentImageInput} from '../../src/agent-image';
import {useWorkspace} from '../workspace';
const props=defineProps<{image?:AgentImageInput;name:string;size?:24|28|30|80}>();
const emit=defineEmits<{unavailable:[]}>();
const {app}=useWorkspace();
const url=ref('');
const image=computed<AgentImageInput>(()=>props.image??{kind:'initials'});
const svg=computed(()=>image.value.kind==='avatar'?avatarSvg(image.value):'');
watch(()=>props.image?.kind==='upload'?'asset:'+props.image.assetId:props.image?.kind==='upload-data'?'draft:'+props.image.png:'',(_,__,cleanup)=>{
  const value=props.image;
  url.value='';
  const controller=new AbortController();let objectUrl='';
  cleanup(()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);});
  void (async()=>{
    try {
      let blob:Blob;
      if(value?.kind==='upload') blob=await app.agentImage(value.assetId,controller.signal);
      else if(value?.kind==='upload-data') blob=new Blob([Uint8Array.from(atob(value.png),char=>char.charCodeAt(0))],{type:'image/png'});
      else return;
      if(controller.signal.aborted)return;
      objectUrl=URL.createObjectURL(blob);url.value=objectUrl;
    } catch {if(!controller.signal.aborted)emit('unavailable');}
  })();
},{immediate:true});
function failed(){url.value='';emit('unavailable');}
</script>

<template>
  <span class="avatar agent-image" :class="[size?`image-size-${size}`:'',{'has-agent-image':svg||url}]" aria-hidden="true">
    <span v-if="svg" class="agent-vector" v-html="svg" />
    <img v-else-if="url" :src="url" alt="" @error="failed">
    <template v-else>{{ name[0]?.toUpperCase() || '✳' }}</template>
  </span>
</template>
