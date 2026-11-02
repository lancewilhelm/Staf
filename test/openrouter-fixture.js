// Synthetic OpenRouter Chat Completions SSE; no network or credentials.
export function routerStream({message, usage, model}) {
 const delta={...(typeof message.content==='string'?{content:message.content}:{}),...(message.tool_calls?{tool_calls:message.tool_calls.map((call,index)=>({index,...call,type:'function'}))}:{})};
 const chunks=[{choices:[{index:0,delta,finish_reason:message.tool_calls?'tool_calls':'stop'}]},...(usage?[{choices:[],usage,model}]:[])];
 return new Response(chunks.map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
}
