<script setup lang="ts">
import { computed } from 'vue';
import type { ConversationTask, InboxItem } from '../controller';
import { useWorkspace } from '../workspace';
import ApprovalItem from './ApprovalItem.vue';
import DisclosureSummary from './DisclosureSummary.vue';
import ResponseText from './ResponseText.vue';
import QuestionSet from './QuestionSet.vue';
const props=defineProps<{task:ConversationTask;inbox:InboxItem[]}>();
const {app,state}=useWorkspace();
const relevant=computed(()=>props.inbox.filter(item=>item.kind==='question'?item.attemptId===props.task.id:item.work.kind==='task' && item.work.id===props.task.id));
const questions=computed(()=>state.value.questionSets.filter(item=>item.workKind==='task' && item.workId===props.task.id));
const observations=computed(()=>props.task.activity.filter(event=>event.type==='assistant_observed' && !!event.text));
</script>
<template>
  <article class="task-conversation" :aria-label="'Task ' + task.id">
    <div class="who">Task · {{ task.state === 'queued' ? 'accepted' : task.state }}</div>
    <p>{{ task.objective }}</p>
    <p class="meta">Attempt {{ task.id }}</p>
    <button v-if="['queued','running','waiting','stopping'].includes(task.state)" class="quiet" type="button" :disabled="task.state==='stopping'" @click="app.stopTask(task.id)">{{ task.state==='stopping' ? 'Stopping…' : 'Stop task' }}</button>
    <template v-if="task.state==='completed' && task.outcome"><ResponseText :text="task.outcome" /></template>
    <p v-else-if="task.outcome" class="meta">{{ task.outcome }}</p>
    <div v-for="event in observations" :key="event.seq"><p class="meta">Observed output{{ event.late ? ' after Stop' : ' (not a completed result)' }}</p><ResponseText :text="event.text ?? ''" /></div>
    <ApprovalItem v-for="item in relevant" :key="item.id" :item="item" />
    <p v-if="questions.some(q=>q.state==='open')" role="status">This task has questions in Staf.</p>
    <QuestionSet v-for="request in questions" :key="request.id" :request="request" />
    <div v-if="['failed','stopped','interrupted'].includes(task.state) && questions.length && questions.every(q=>q.state!=='open')"><p>Review the prior work and any uncertain effects before starting a new attempt.</p><button class="quiet" type="button" @click="app.retryTask(task,questions)">Start a new attempt</button></div>
    <details v-if="task.activity.length"><DisclosureSummary>Task activity</DisclosureSummary>
      <div v-for="event in task.activity" :key="event.seq" class="task-event"><strong>{{ event.type }}</strong><pre v-if="event.message || event.content">{{ event.message || event.content }}</pre></div>
    </details>
  </article>
</template>
