import {z} from 'zod';

// Only nonsecret Slack identifiers enter the work journal or the model's call.
export const slackSetupInput=z.strictObject({
 teamId:z.string().regex(/^T[A-Z0-9]{1,63}$/),
 userId:z.string().regex(/^U[A-Z0-9]{1,63}$/),
 channelId:z.string().regex(/^D[A-Z0-9]{1,63}$/),
});
export type SlackSetupInput=z.infer<typeof slackSetupInput>;
const selectionSchema=z.strictObject({name:z.string().min(1).max(120),revision:z.uuid()});
export const slackSetupSelectionSchema=z.strictObject({config:slackSetupInput.extend({botId:z.string().regex(/^[\w-]+$/)}),app:selectionSchema,bot:selectionSchema});
export type SlackSetupSelection=z.infer<typeof slackSetupSelectionSchema>;
export const slackSetupApprovalSchema=slackSetupSelectionSchema.extend({authority:z.strictObject({agentRevision:z.string().min(1),slackGeneration:z.number().int().nonnegative(),connectionRevision:z.number().int().positive().nullable(),agentAccess:z.boolean().nullable()})});
export type SlackSetupApproval=z.infer<typeof slackSetupApprovalSchema>;
