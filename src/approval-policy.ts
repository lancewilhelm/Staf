export type ApprovalMode = 'ask-every-time' | 'ask-for-risky-actions' | 'never-ask';
export type Risk = 'safe' | 'risky' | 'unknown';

export interface ActionBoundary {
  capability: string;
  operation: string;
  resource: string;
  effect: string;
  limits: Readonly<Record<string, string | number | boolean>>;
}

export interface Action extends ActionBoundary {
  risk: Risk;
}

export interface PermissionBoundary {
  enabledCapabilities: readonly string[];
  actions: readonly ActionBoundary[];
}

export type GrantDuration =
  | { kind: 'task'; taskId: string }
  | { kind: 'schedule'; scheduleId: string }
  | { kind: 'remembered' };

export interface ApprovalGrant {
  botScope: { kind: 'bot'; botId: string } | { kind: 'all-bots' };
  duration: GrantDuration;
  action: ActionBoundary;
  expiresAt: number | null;
  revoked: boolean;
}

export interface PolicyInput {
  action: Action;
  botId: string;
  taskId: string;
  scheduleId: string | null;
  now: number;
  instancePermissions: PermissionBoundary;
  botPermissions: PermissionBoundary;
  taskScope: readonly ActionBoundary[];
  modes: readonly [ApprovalMode, ...ApprovalMode[]];
  helper?: {
    permissions: PermissionBoundary;
    assignmentScope: readonly ActionBoundary[];
    mode: ApprovalMode;
  };
  grants: readonly ApprovalGrant[];
  // This must be supplied by trusted owner-request handling, never by a model.
  ownerRequest: { action: ActionBoundary } | null;
}

export type PolicyDecision =
  | { outcome: 'block'; reason: 'invalid-policy' | 'instance-permission' | 'bot-permission' | 'task-scope' | 'helper-permission' | 'assignment-scope' }
  | { outcome: 'prompt'; reason: 'ask-every-time' | 'approval-required' }
  | { outcome: 'allow'; reason: 'never-ask' | 'safe-action' | 'grant' | 'owner-request' };

function matches(boundary: ActionBoundary, action: ActionBoundary): boolean {
  if (boundary.capability !== action.capability || boundary.operation !== action.operation ||
      boundary.resource !== action.resource || boundary.effect !== action.effect) return false;
  const keys = Object.keys(boundary.limits);
  return keys.length === Object.keys(action.limits).length &&
    keys.every((key) => Object.hasOwn(action.limits, key) && boundary.limits[key] === action.limits[key]);
}

function permits(permission: PermissionBoundary, action: Action): boolean {
  return permission.enabledCapabilities.includes(action.capability) &&
    permission.actions.some((boundary) => matches(boundary, action));
}

function grantMatches(grant: ApprovalGrant, input: PolicyInput): boolean {
  if (!Number.isFinite(input.now) || grant.revoked !== false || (grant.expiresAt !== null && (!Number.isFinite(grant.expiresAt) || input.now >= grant.expiresAt))) return false;
  switch (grant.botScope.kind) {
    case 'bot':
      if (typeof grant.botScope.botId !== 'string' || grant.botScope.botId.length === 0 || grant.botScope.botId !== input.botId) return false;
      break;
    case 'all-bots':
      break;
    default:
      return false;
  }
  switch (grant.duration.kind) {
    case 'task':
      if (typeof grant.duration.taskId !== 'string' || grant.duration.taskId.length === 0 || grant.duration.taskId !== input.taskId) return false;
      break;
    case 'schedule':
      if (typeof grant.duration.scheduleId !== 'string' || grant.duration.scheduleId.length === 0 || grant.duration.scheduleId !== input.scheduleId) return false;
      break;
    case 'remembered':
      break;
    default:
      return false;
  }
  return matches(grant.action, input.action);
}

export function evaluateApproval(input: PolicyInput): PolicyDecision {
  const { action } = input;
  const validMode = (mode: ApprovalMode) => mode === 'ask-every-time' || mode === 'ask-for-risky-actions' || mode === 'never-ask';
  if (!Array.isArray(input.modes) || input.modes.length === 0 || !input.modes.every(validMode) ||
      (input.helper && !validMode(input.helper.mode))) return { outcome: 'block', reason: 'invalid-policy' };
  if (!permits(input.instancePermissions, action)) return { outcome: 'block', reason: 'instance-permission' };
  if (!permits(input.botPermissions, action)) return { outcome: 'block', reason: 'bot-permission' };
  if (!input.taskScope.some((boundary) => matches(boundary, action))) return { outcome: 'block', reason: 'task-scope' };
  if (input.helper && !permits(input.helper.permissions, action)) return { outcome: 'block', reason: 'helper-permission' };
  if (input.helper && !input.helper.assignmentScope.some((boundary) => matches(boundary, action))) return { outcome: 'block', reason: 'assignment-scope' };

  const modes = input.helper ? [...input.modes, input.helper.mode] : input.modes;
  if (modes.includes('ask-every-time')) return { outcome: 'prompt', reason: 'ask-every-time' };
  if (!modes.includes('ask-for-risky-actions')) return { outcome: 'allow', reason: 'never-ask' };
  if (action.risk === 'safe') return { outcome: 'allow', reason: 'safe-action' };
  if (input.grants.some((grant) => grantMatches(grant, input))) return { outcome: 'allow', reason: 'grant' };
  if (input.ownerRequest && matches(input.ownerRequest.action, action)) return { outcome: 'allow', reason: 'owner-request' };
  return { outcome: 'prompt', reason: 'approval-required' };
}
