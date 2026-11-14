import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from './fixtures/controlled-instance.mjs';

test('known secrets cannot enter Gmail OAuth account or client ID fields',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-nonsecret-')),path=join(dir,'instance.sqlite');let app,port,token,requests=0;
 const emailSecret='synthetic-known-secret@example.test',clientSecret='synthetic-known-client-id';
 const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};};
 try {app=startInstance(path,0,{dataDir:dir,env:{},gmailRequest:async()=>{requests++;throw Error('Unexpected Google request');}});port=await app.listen();token=(await call('/api/pair',{code:app.code})).value.token;
  await call('/api/secrets/add',{name:'Known email',purpose:'Fixture',value:emailSecret});await call('/api/secrets/add',{name:'Known client id',purpose:'Fixture',value:clientSecret});
  for(const input of [{email:emailSecret,clientId:'normal-client'},{email:'owner@example.test',clientId:clientSecret}]){
   const result=await call('/api/plugins/gmail/start',{...input,clientSecret:'synthetic-client-secret',confirm:true});assert.notEqual(result.status,200);assert.ok(!JSON.stringify(result.value).includes(input.email===emailSecret?emailSecret:clientSecret));
  }
  assert.equal(requests,0);const plugins=await call('/api/plugins');assert.ok(!JSON.stringify(plugins.value).includes(emailSecret));assert.ok(!JSON.stringify(plugins.value).includes(clientSecret));assert.ok(!readFileSync(path).includes(Buffer.from(emailSecret)));assert.ok(!readFileSync(path).includes(Buffer.from(clientSecret)));
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
