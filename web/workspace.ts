import { inject, onScopeDispose, provide, shallowRef, type InjectionKey, type ShallowRef } from 'vue';
import { Controller, type Workspace } from './controller';

const workspaceKey: InjectionKey<{app: Controller; state: ShallowRef<Workspace>}> = Symbol('workspace');
let controller: Controller | undefined;

export function provideWorkspace() {
  const app = controller ??= new Controller();
  const state = shallowRef(app.snapshot());
  const unsubscribe = app.subscribe(() => { state.value = app.snapshot(); });
  onScopeDispose(unsubscribe);
  const workspace = {app, state};
  provide(workspaceKey, workspace);
  return workspace;
}

export function useWorkspace() {
  const workspace = inject(workspaceKey);
  if (!workspace) throw new Error('Workspace must be provided by App.vue');
  return workspace;
}
