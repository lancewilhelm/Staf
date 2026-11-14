// Existing service journeys use the current draft revision, like a fresh paired client.
// Concurrency tests call fetch directly to exercise stale revisions explicitly.
export async function questionFetch(input,init) {
 const url=typeof input==='string'?input:input instanceof URL?input.href:null;
 if(url && init?.method==='POST' && typeof init.body==='string') {
  const match=url.match(/^(.*)\/api\/question-sets\/([\w-]+)\/(draft|submit|dismiss)$/);
  if(match) {
   let body;try{body=JSON.parse(init.body);}catch{return fetch(input,init);}
   if(body && typeof body==='object' && !Array.isArray(body) && !('revision' in body)) {
    const response=await fetch(match[1]+'/api/question-sets',{headers:init.headers});
    if(response.ok){const requests=await response.json(),request=requests.find(item=>item.id===match[2]);if(request) init={...init,body:JSON.stringify({...body,revision:request.draftRevision})};}
   }
  }
 }
 return fetch(input,init);
}
