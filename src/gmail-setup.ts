import {z} from 'zod';
import {questionSetInput} from './question-sets.js';

/** Service-defined prompts keep the protected step and the approved Google use bound together. */
export const gmailSetupQuestions=questionSetInput.parse({questions:[
 {kind:'text',prompt:'What Gmail address should Staf connect?'},
 {kind:'text',prompt:'What is the desktop OAuth client ID from your Google Cloud project?'},
 {kind:'secret',prompt:'Save or select the OAuth client secret from the same Google Cloud project.',name:'Gmail OAuth client secret',purpose:'Authorize the Gmail plugin for this account',destination:'Google OAuth token endpoint and Gmail API'},
 {kind:'multiple',prompt:'Which optional Google permissions should be requested? Leave blank for read-only access.',choices:['Send replies after explicit approval','Make inbox changes after explicit approval']},
]});

const answer=z.union([z.null(),z.strictObject({choices:z.array(z.string()),writeIn:z.string()})]);
const values=z.tuple([answer,answer,answer,answer]);
const clientId=z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);
export function parseGmailSetupDraft(input:unknown) {
 const [account,client,protectedStep,scopes]=values.parse(input);
 if(!account || !client || account.choices.length || client.choices.length || protectedStep?.choices.length || protectedStep?.writeIn)throw Error('Provide the Gmail address and client ID; save the client secret separately');
 const email=z.email().max(320).transform(value=>value.toLowerCase()).parse(account.writeIn.trim());
 const id=clientId.parse(client.writeIn.trim());
 const choices=scopes?.choices??[];
 if(scopes?.writeIn.trim() || new Set(choices).size!==choices.length || choices.some(choice=>!['Send replies after explicit approval','Make inbox changes after explicit approval'].includes(choice)))throw Error('Choose supported Gmail permissions');
 return {email,clientId:id,sendEnabled:choices.includes('Send replies after explicit approval'),modifyEnabled:choices.includes('Make inbox changes after explicit approval')};
}
