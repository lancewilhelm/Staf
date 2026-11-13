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
const existingConfigSchema=z.strictObject({teamId:z.string(),userId:z.string(),channelId:z.string(),botId:z.string()});
const grantSchema=z.strictObject({name:z.string(),revision:z.string(),integration:z.enum(['slack.app','slack.bot']),destination:z.string(),version:z.string()});
export const slackSetupApprovalSchema=slackSetupSelectionSchema.extend({authority:z.strictObject({agentRevision:z.string().min(1),slackGeneration:z.number().int().nonnegative(),connectionRevision:z.number().int().positive().nullable(),agentAccess:z.boolean().nullable(),existingConfig:existingConfigSchema.nullable(),existingEnabled:z.boolean().nullable()}),grantReview:z.strictObject({version:z.string().regex(/^[a-f0-9]{64}$/),hasHistory:z.boolean(),grants:z.array(grantSchema)})});
export type SlackSetupApproval=z.infer<typeof slackSetupApprovalSchema>;
