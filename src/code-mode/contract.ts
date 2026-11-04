import { z } from 'zod';

const identifier = z.string().min(1).max(256);
export const ids = {
  bot: identifier.brand<'BotId'>(), session: identifier.brand<'ConversationSessionId'>(), command: identifier.brand<'CommandId'>(),
  execution: identifier.brand<'ExecutionId'>(), child: identifier.brand<'ChildId'>(), operation: identifier.brand<'OperationId'>(),
};
export type BotId = z.infer<typeof ids.bot>;
export type ConversationSessionId = z.infer<typeof ids.session>;
export type CommandId = z.infer<typeof ids.command>;
export type ExecutionId = z.infer<typeof ids.execution>;
export type ChildId = z.infer<typeof ids.child>;
export type OperationId = z.infer<typeof ids.operation>;
export const contextIds = z.strictObject({botId: ids.bot, sessionId: ids.session, commandId: ids.command});
export type CapabilityContextInput = z.input<typeof contextIds> & {readonly signal: AbortSignal};
export type CapturedCapabilityContext = Readonly<z.infer<typeof contextIds>> & {readonly signal: AbortSignal};
export interface CapabilityCall {
  readonly context: CapturedCapabilityContext;
  /** Additional per-execution cancellation. Accepted context.signal stays unchanged. */
  readonly signal: AbortSignal;
  readonly executionId: ExecutionId;
  readonly childId: ChildId;
  readonly operationId: OperationId;
}
export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
export const jsonValue: z.ZodType<Json> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValue), z.unknown().superRefine((value, context) => {
    if (value !== null && typeof value === 'object' && Object.hasOwn(value, '__proto__')) context.addIssue({code: 'custom', message: 'Unsupported JSON property'});
  }).pipe(z.record(z.string(), jsonValue)),
]));

/** Reject non-JSON values before serialization can erase or transform them. */
export function json(input: unknown, maxBytes = 256 * 1024): Json {
  const visit = (value: unknown, seen: Set<object>, depth: number): void => {
    if (depth > 64) throw Error('JSON nesting limit');
    if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || value === null || seen.has(value)) throw Error('Expected JSON data');
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null && !Array.isArray(value)) throw Error('Expected plain JSON data');
    if (Object.hasOwn(value, '__proto__')) throw Error('Unsupported JSON property');
    if (Object.getOwnPropertySymbols(value).length) throw Error('Expected JSON properties');
    seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (descriptor.get || descriptor.set) throw Error('Expected JSON values');
      if (descriptor.enumerable) visit(descriptor.value, seen, depth + 1);
    }
    if (Array.isArray(value) && (Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index)))) throw Error('Expected dense JSON array');
    seen.delete(value);
  };
  visit(input, new Set(), 0);
  const encoded = JSON.stringify(input);
  if (Buffer.byteLength(encoded) > maxBytes) throw Error('JSON byte limit');
  return deepFreeze(jsonValue.parse(JSON.parse(encoded)));
}

export interface DataSchema<Value> {
  readonly jsonSchema: Json;
  parse(value: unknown): Value;
}
/** A single Zod schema owns validation, inferred service types and JSON Schema. */
export function dataSchema<Value>(schema: z.ZodType<Value>): DataSchema<Value> {
  const projection = json(z.toJSONSchema(schema));
  return Object.freeze({jsonSchema: projection, parse: (value: unknown) => deepFreeze(schema.parse(json(value)))});
}
const resourceSchema = z.strictObject({family: identifier, owner: identifier, key: z.string().min(1).max(4096)});
export class ResourceScope {
  private constructor(readonly identity: Readonly<z.infer<typeof resourceSchema>>) {}
  static create(input: z.input<typeof resourceSchema>): ResourceScope { return Object.freeze(new ResourceScope(Object.freeze(resourceSchema.parse(input)))); }
}
export const resourceScope = ResourceScope.create;
/** Feature-owned revision assertion, checked synchronously at the dispatch boundary. */
export class ScopeClaim {
  private constructor(private readonly check: () => undefined) {}
  static create(check: () => undefined): ScopeClaim {const claim = new ScopeClaim(check); Object.freeze(claim); return claim;}
  assertCurrent(): void {
    const result: unknown = this.check();
    if (result instanceof Promise) void result.catch(() => {});
    if (result !== undefined) throw Error('Scope assertion must be synchronous');
  }
}
export const scopeClaim = ScopeClaim.create;
export interface ApplicationCapability<Input, Output> {
  readonly description: string;
  readonly input: DataSchema<Input>;
  readonly output: DataSchema<Output>;
  readonly effect: {readonly kind: 'read' | 'change'; readonly resource: (call: CapabilityCall, input: Input) => ResourceScope};
  readonly checkScope: (call: CapabilityCall, input: Input) => Promise<ScopeClaim>;
  readonly invoke: (call: CapabilityCall, input: Input) => Promise<Output>;
}
interface BoundCapability {
  readonly description: string;
  readonly inputSchema: Json;
  readonly outputSchema: Json;
  readonly kind: 'read' | 'change';
  bind(call: CapabilityCall, input: Json): {
    resource: ResourceScope;
    input: Json;
    checkScope(): Promise<ScopeClaim>;
    invoke(): Promise<Json>;
  };
}
const definitions = new WeakMap<RegisteredCapability, BoundCapability>();
const registration = Symbol('registered capability');
export interface RegisteredCapability {readonly [registration]: true}
export type ApplicationCapabilities = Readonly<Record<string, RegisteredCapability>>;
export function applicationCapability<Input, Output>(definition: ApplicationCapability<Input, Output>): RegisteredCapability {
  const frozen = {...definition, effect: {...definition.effect}};
  const entry: RegisteredCapability = Object.freeze({[registration]: true} satisfies RegisteredCapability);
  definitions.set(entry, {
    description: z.string().min(1).max(2048).parse(frozen.description), inputSchema: json(frozen.input.jsonSchema), outputSchema: json(frozen.output.jsonSchema), kind: frozen.effect.kind,
    bind(call, raw) {
      const input = frozen.input.parse(raw);
      const resource = frozen.effect.resource(call, input);
      if (!(resource instanceof ResourceScope)) throw Error('Invalid resource scope');
      return {resource, input: json(input), checkScope: async () => {
        const claim = await frozen.checkScope(call, input);
        if (!(claim instanceof ScopeClaim)) throw Error('Feature scope claim required');
        return claim;
      }, invoke: async () => json(frozen.output.parse(json(await frozen.invoke(call, input))))};
    },
  });
  return entry;
}
export class CapabilityRegistry {
  private readonly entries = new Map<string, BoundCapability>();
  constructor(capabilities: ApplicationCapabilities) {
    for (const [name, registration] of Object.entries(capabilities)) {
      z.string().regex(/^[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)+$/).max(128).parse(name);
      const definition = definitions.get(registration);
      if (!definition) throw Error('Unregistered capability');
      this.entries.set(name, definition);
    }
    if (this.entries.size > 128) throw Error('Capability catalog limit');
  }
  names(): string[] { return [...this.entries.keys()]; }
  catalog(): Json { return json(Object.fromEntries([...this.entries].map(([name, d]) => [name, {description: d.description, input: d.inputSchema, output: d.outputSchema, effect: d.kind}]))); }
  get(name: string): BoundCapability {
    const entry = this.entries.get(name);
    if (!entry) throw Error('Unknown capability');
    return entry;
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
