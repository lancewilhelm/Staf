/** Type-checked examples only. Never executed or imported by production Staf. */
import type { CodeMode, AcceptedCodeWork, RunReport } from './sketch.js';
import { codeToolResult, parseModelCodeCall } from './sketch.js';
import type {
  ApplicationCapabilities, CapturedCapabilityContext, DataSchema,
} from './capability-registration.js';
import { applicationCapability, resourceScope } from './capability-registration.js';

/** The shared turn receives a service-minted accepted-work handle. It cannot
 * replace the accepted session using values returned by a model. */
export async function providerCallSite(input: {
  readonly codeMode: CodeMode;
  readonly work: AcceptedCodeWork;
  readonly rawToolCall: unknown;
}) {
  const call = parseModelCodeCall(input.rawToolCall);
  const report = await input.codeMode.execute({work: input.work, ...call});
  return codeToolResult({providerCallId: call.providerCallId, report});
}

type SearchInput = { readonly query: string };
type SearchOutput = { readonly matches: readonly {readonly messageId: string; readonly excerpt: string}[] };

/** Illustrative feature service, not the actual implementation of issue #67.
 * Method names and ID types adapt to the feature-owned exports when available. */
interface SessionMethods {
  checkSearchAccess(context: CapturedCapabilityContext, input: SearchInput): Promise<void>;
  search(context: CapturedCapabilityContext, input: SearchInput): Promise<SearchOutput>;
}

export function registrationCallSite(input: {
  readonly methods: SessionMethods;
  readonly inputSchema: DataSchema<SearchInput>;
  readonly outputSchema: DataSchema<SearchOutput>;
}): ApplicationCapabilities {
  return {
    'sessions.search': applicationCapability({
      description: 'Explicitly search original messages belonging to this agent.',
      input: input.inputSchema,
      output: input.outputSchema,
      effect: {
        kind: 'read',
        resource: call => resourceScope({
          family: 'session-history', owner: call.context.botId, key: 'same-agent',
        }),
      },
      checkScope: (call, args) => input.methods.checkSearchAccess(call.context, args),
      invoke: (call, args) => input.methods.search(call.context, args),
    }),
  };
}

/** Owner Stop stays on the existing service route; only inspection is read back
 * through the Code Mode facade. Both address the original accepted work. */
export async function stopCallSite(input: {
  readonly stopAcceptedWork: (work: AcceptedCodeWork) => Promise<void>;
  readonly codeMode: CodeMode;
  readonly work: AcceptedCodeWork;
}) {
  await input.stopAcceptedWork(input.work);
  return input.codeMode.inspect({work: input.work});
}

/** The formatter has actual bounded values on partial and final outcomes, not
 * only unresolved result IDs. A later model request still uses the same work. */
export function inspectReturnedValues(report: RunReport) {
  return report.outputs.map(output => output.value);
}
