export async function* responseEvents(body:ReadableStream<Uint8Array>):AsyncGenerator<unknown> {
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='';
  try {
    for (;;) {
      const part=await reader.read();
      if(part.done)return;
      buffer+=decoder.decode(part.value,{stream:true});
      if(buffer.length>2_000_000)throw Error('Response stream event is too large');
      let end:number;
      while((end=buffer.indexOf('\n\n'))>=0) {
        const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
        const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
        if(data)yield JSON.parse(data) as unknown;
      }
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
