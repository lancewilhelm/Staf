import {z} from 'zod';
import type {Capability,WorkContext,ActionIdentity} from './work-actions.js';
import {ActionFailed} from './work-actions.js';
import type {SecretRequests} from './secret-requests.js';
import {slackSetupInput,type SlackSetupInput,type SlackSetupSelection} from './slack-setup-types.js';
type Selection=SlackSetupSelection['app'];

/** The service owns confirmation and connection; the model never receives token values. */
export function slackSetupCapability(hooks:{
 secrets:SecretRequests;
 eligible:(work:WorkContext)=>boolean;
 check:(work:WorkContext)=>void;
 confirm:(approval:SlackSetupSelection,work:WorkContext,action:ActionIdentity)=>Promise<string>;
 ready:(work:WorkContext,action:ActionIdentity)=>boolean;
 pause:(work:WorkContext)=>void;
 resume:(work:WorkContext)=>void;
}):Capability<SlackSetupInput,string> {
 return {
  name:'setup_slack',
  definition:{type:'function',function:{name:'setup_slack',description:'Request protected app and bot tokens in Staf and ask the owner to approve the exact Slack destination and agent. First obtain the workspace, user, and DM IDs from the owner. Never put tokens in tool arguments or ask for them in Slack.',parameters:{type:'object',properties:{teamId:{type:'string'},userId:{type:'string'},channelId:{type:'string'}},required:['teamId','userId','channelId'],additionalProperties:false}}},
  parseInput:value=>slackSetupInput.parse(value),parseResult:value=>z.string().max(1000).parse(value),
  describe:()=>({summary:'Set up Slack with owner confirmation',resource:'Slack plugin',effect:'change'}),
  eligible:hooks.eligible,check:(_input,work)=>hooks.check(work),authorize:async()=>{},
  execute:async(input,work,action)=>{
   const destination=`Slack workspace ${input.teamId}, user ${input.userId}, DM ${input.channelId}; https://slack.com/api and Slack Socket Mode`;
   const request=async(role:'app'|'bot'):Promise<Selection|undefined>=>{
    hooks.check(work);
    const id=`${action.id}-${role}`;
    hooks.secrets.create(id,work.botId,work.work,{name:`Slack ${role} token ${action.id}`,purpose:role==='app'?'Connect Slack Socket Mode':'Identify the Slack bot and send approved messages',destination});
    const outcome=await hooks.secrets.wait(id,work.signal);
    hooks.check(work);
    if(outcome!=='saved')return undefined;
    const selected=hooks.secrets.selection(id);
    if(!selected)throw new ActionFailed('The selected secret changed; start a new Slack setup attempt.');
    return selected;
   };
   hooks.pause(work);
   try {
    const app=await request('app');if(!app)return 'Slack setup was not completed: app token request was skipped or dismissed.';
    const bot=await request('bot');if(!bot)return 'Slack setup was not completed: bot token request was skipped or dismissed.';
    hooks.check(work);
    if(!hooks.secrets.selection(`${action.id}-app`) || !hooks.secrets.selection(`${action.id}-bot`))throw new ActionFailed('A selected secret changed; start a new Slack setup attempt.');
    const result=await hooks.confirm({config:{...input,botId:work.botId},app,bot},work,action);
    if(result==='connected' && !hooks.ready(work,action))throw new ActionFailed('Slack setup was interrupted before completion.');
    if(result==='failed' || result==='connection failed')throw new ActionFailed('Slack setup failed. Check the connection status before trying again.');
    return result==='dismissed'?'Slack setup dismissed.':`Slack setup status: ${result}.`;
   } finally {if(!work.signal.aborted)hooks.resume(work);}
  },visibleResult:value=>value,
 };
}
