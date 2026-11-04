/**
 * HISTORICAL CHECKPOINT SKETCH. Executable experiment exports now live in
 * src/code-mode/contract.ts; see experiment.md for the implemented contract.
 * Feature integration at 3e42d18 supplies scoped application methods; it does not
 * depend on an executor or introduce direct provider tools.
 *
 * Caller usage FIRST:
 *
 * const capabilities = {
 *   'sessions.search': applicationCapability({
 *     description: 'Search this agent\'s original sessions explicitly.',
 *     input: sessionSchemas.searchInput,
 *     output: sessionSchemas.searchOutput,
 *     effect: { kind: 'read', resource: (call, input) =>
 *       resources.sessionHistory(call.context.botId, input) },
 *     checkScope: (call, input) => sessions.checkSearchAccess(call.context, input),
 *     invoke: (call, input) => sessions.search(call.context, input),
 *   }),
 *   'artifacts.create': applicationCapability({
 *     description: 'Create an artifact revision in the addressed agent.',
 *     input: artifactSchemas.createInput,
 *     output: artifactSchemas.revisionOutput,
 *     effect: { kind: 'change', resource: (call, input) =>
 *       resources.artifacts(call.context.botId, input) },
 *     checkScope: (call, input) => artifacts.checkCreateAccess(call.context, input),
 *     invoke: (call, input) => artifacts.create(call.context, {
 *       ...input, operationId: call.operationId,
 *     }),
 *   }),
 * } satisfies ApplicationCapabilities;
 *
 * The coordinator will supply actual feature method/schema names. Examples do
 * not implement, register, or claim the availability of these future features.
 */

type Brand<Value, Name extends string> = Value & { readonly __brand: Name };
export type BotId = Brand<string, 'BotId'>;
export type ConversationSessionId = Brand<string, 'ConversationSessionId'>;
export type CommandId = Brand<string, 'CommandId'>;
export type ExecutionId = Brand<string, 'ExecutionId'>;
export type ChildId = Brand<string, 'ChildId'>;
export type OperationId = Brand<string, 'OperationId'>;

/** Import the feature-owned ID/context types when available. These aliases are
 * sketch placeholders, not a second implementation of the session contracts. */
export interface CapturedCapabilityContext {
  readonly botId: BotId;
  readonly sessionId: ConversationSessionId;
  readonly commandId: CommandId;
  readonly signal: AbortSignal;
}

/** Context is service-captured at command acceptance. Guest input cannot supply
 * or replace it. This invocation's identity is also minted by the service. */
export interface CapabilityCall {
  readonly context: CapturedCapabilityContext;
  readonly executionId: ExecutionId;
  readonly childId: ChildId;
  readonly operationId: OperationId;
}

export type Json = null | boolean | number | string | readonly Json[] | JsonObject;
export interface JsonObject { readonly [key: string]: Json }

/** One authoritative schema/codec supplies parsing and its generated JSON
 * Schema projection. It must not maintain separate hand-written property lists.
 * The registry's private JSON codec also rejects non-JSON and oversized values. */
export interface DataSchema<Value> {
  readonly jsonSchema: JsonObject;
  parse(value: unknown): Value;
}

declare const resourceBrand: unique symbol;
export interface ResourceScope { readonly [resourceBrand]: true }

type Effect<Input> =
  | {
      readonly kind: 'read';
      readonly resource: (call: CapabilityCall, input: Input) => ResourceScope;
    }
  | {
      readonly kind: 'change';
      readonly resource: (call: CapabilityCall, input: Input) => ResourceScope;
    };

export interface ApplicationCapability<Input, Output> {
  readonly description: string;
  readonly input: DataSchema<Input>;
  readonly output: DataSchema<Output>;
  readonly effect: Effect<Input>;
  /** A feature-owned guard rechecks captured work and resource access without
   * fetching the content or repeating an effect. It cannot override the common
   * host policy. Used before dispatch and before releasing a recovery receipt.
   * Exact feature guard names are integration placeholders until provided. */
  readonly checkScope: (call: CapabilityCall, input: Input) => Promise<void>;
  /** Called only after host validation, live authority, exact approval and the
   * atomic permit/fence check. The feature method rechecks its own scope too.
   * Typed application errors are mapped privately; an unexplained exception
   * after a changing call starts is uncertain, never assumed safe to retry. */
  readonly invoke: (call: CapabilityCall, input: Input) => Promise<Output>;
}

declare const registrationBrand: unique symbol;
export interface RegisteredCapability { readonly [registrationBrand]: true }
export type ApplicationCapabilities = Readonly<Record<string, RegisteredCapability>>;

/** Names are declared once as registry keys, e.g. 'documents.search'. From those
 * entries derive guest methods/types, descriptions, validation and dispatch.
 * Registration metadata describes effects; it cannot grant permissions or
 * disable the trusted gateway. No caller-supplied "approved" boolean exists. */
export function applicationCapability<Input, Output>(
  _definition: ApplicationCapability<Input, Output>,
): RegisteredCapability {
  throw new Error('not implemented');
}

/** Host-owned resource constructors produce scopes accepted by the common
 * policy/reconciliation layer. Feature adapters cannot clear prior uncertainty
 * with a model-authored claim. Concrete resource families belong to features. */
export function resourceScope(_input: {
  readonly family: string;
  readonly owner: BotId;
  readonly key: string;
}): ResourceScope {
  throw new Error('not implemented');
}
