<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {useWorkspace} from '../workspace';
import type {QuestionAnswer,QuestionSet} from '../controller';
const props=defineProps<{request:QuestionSet}>();
const {app}=useWorkspace();
const copy=(values:QuestionAnswer[]):QuestionAnswer[]=>values.map(value=>value ? {choices:[...value.choices],writeIn:value.writeIn} : null);
const index=ref(0),answers=ref<QuestionAnswer[]>(copy(props.request.draft)),busy=ref(false),error=ref('');
let timer:ReturnType<typeof setTimeout>|undefined;
let writes=Promise.resolve();
const current=computed(()=>props.request.questions[index.value]);
function answer(i:number){return answers.value[i] ?? {choices:[],writeIn:''};}
function update(i:number,value:Exclude<QuestionAnswer,null>) {answers.value[i]=value;queue();}
function writeIn(i:number,value:string){const old=answer(i);update(i,{...old,writeIn:value,...(props.request.questions[i]?.kind==='single' && value.trim()?{choices:[]}: {})});}
function select(i:number,choice:string,checked:boolean){const old=answer(i),question=props.request.questions[i];const choices=question?.kind==='single'?[choice]:checked?[...old.choices,choice]:old.choices.filter(c=>c!==choice);update(i,{choices,writeIn:question?.kind==='single'?'':old.writeIn});}
function queue(){if(timer)clearTimeout(timer);timer=setTimeout(()=>{void save().catch(()=>{});},300);}
function save(){if(timer)clearTimeout(timer);timer=undefined;const snapshot=copy(answers.value);writes=writes.catch(()=>{}).then(()=>app.questionDraft(props.request.id,snapshot)).then(()=>{error.value='';});return writes.catch(e=>{error.value=String(e);throw e;});}
async function finish(kind:'submit'|'dismiss'){busy.value=true;error.value='';try{if(kind==='submit')await save();else {if(timer)clearTimeout(timer);await writes;}await app.questionFinish(props.request.id,kind);}catch(e){error.value=String(e);}finally{busy.value=false;}}
function navigate(i:number){index.value=i;void save().catch(()=>{});}
watch(()=>props.request.id,()=>{answers.value=copy(props.request.draft);index.value=0;});
watch(()=>props.request.state, state=>{if(state!=='open'){if(timer)clearTimeout(timer);answers.value=copy(props.request.draft);}});
</script>
<template>
 <section class="question-set" :aria-label="'Question set for this response'">
  <template v-if="request.state==='open'">
   <p v-if="request.originState==='interrupted' || request.originState==='failed' || request.originState==='stopped'" role="status">{{ request.workKind==='task' ? 'The task was interrupted. Your answers will be saved, but the task will not resume automatically. Review the work before starting a new attempt.' : 'The original response was interrupted. Your answers will be saved, but it will not resume automatically. Review the work and send a new message when you are ready.' }}</p>
   <nav aria-label="Questions"><button v-for="(question,i) in request.questions" :key="i" type="button" class="quiet" :disabled="busy" :aria-current="i===index?'step':undefined" @click="navigate(i)">Question {{ i+1 }}<span v-if="!answer(i).choices.length && !answer(i).writeIn.trim()"> · unanswered</span></button></nav>
   <fieldset v-if="current" :disabled="busy"><legend>Question {{ index+1 }} of {{ request.questions.length }}: {{ current.prompt }}</legend>
    <template v-if="current.kind!=='text'"><label v-for="choice in current.choices" :key="choice"><input :type="current.kind==='single'?'radio':'checkbox'" :name="request.id+'-'+index" :checked="answer(index).choices.includes(choice)" @change="select(index,choice,($event.target as HTMLInputElement).checked)"> {{ choice }}</label></template>
    <label :for="request.id+'-write'">{{ current.kind==='text'?'Your answer':'Your own answer' }} (optional)</label><textarea :id="request.id+'-write'" :value="answer(index).writeIn" @input="writeIn(index,($event.target as HTMLTextAreaElement).value)" />
   </fieldset>
   <button type="button" class="quiet" :disabled="busy" @click="update(index,{choices:[],writeIn:''})">Skip this question</button>
   <p>Every question is optional. Unanswered questions will be sent as skipped.</p>
   <button v-if="index>0" :disabled="busy" type="button" class="quiet" @click="navigate(index-1)">Back</button><button v-if="index<request.questions.length-1" :disabled="busy" type="button" class="quiet" @click="navigate(index+1)">Next</button>
   <button type="button" :disabled="busy" @click="finish('submit')">Submit answers</button><button type="button" class="quiet" :disabled="busy" @click="finish('dismiss')">Dismiss</button><p v-if="error" role="alert">{{ error }}</p>
  </template>
  <template v-else><p>Question set {{ request.state }}.</p><ol v-if="request.state==='submitted'"><li v-for="(question,i) in request.questions" :key="i">{{ question.prompt }}: {{ [...answer(i).choices, ...(answer(i).writeIn.trim() ? [answer(i).writeIn] : [])].join(', ') || 'Skipped' }}</li></ol><template v-if="request.workKind==='task'"><p v-if="['failed','stopped','interrupted'].includes(request.originState)">The task {{ request.originState }} and will not resume automatically. Review its prior work before starting a new attempt.</p><p v-else-if="request.originState==='running'">The response is available to this task.</p></template><template v-else><p v-if="request.originState==='pending'">Waiting for the original response to finish.</p><p v-else-if="request.originState!=='completed'">The original response {{ request.originState }}; no automatic continuation was started. Review the work and send a new message to try again.</p><p v-else-if="request.deliveryError" role="status">{{ request.deliveryError }}</p><p v-else-if="!request.continuationState">Waiting to deliver your response.</p><p v-else-if="request.continuationState==='interrupted' || request.continuationState==='failed'">The follow-up {{ request.continuationState }}. Review the conversation before trying again.</p></template></template>
 </section>
</template>
