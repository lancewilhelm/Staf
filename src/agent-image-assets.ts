import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,fsyncSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {agentImageByteLimit,agentImageSize,isAgentImageAssetId,type AgentImage,type AgentImageInput} from './agent-image.js';

/** Immutable assets live inside the backed-up agents directory; only form saves write them. */
export class AgentImageAssets {
  constructor(private readonly root:string) {
    mkdirSync(root,{recursive:true,mode:0o700});
    for (const entry of readdirSync(root,{withFileTypes:true})) {
      if (entry.isFile() && /^\.upload-[a-f0-9-]{36}$/.test(entry.name)) unlinkSync(join(root,entry.name));
    }
  }
  accept(image:AgentImageInput):AgentImage {
    if (image.kind!=='upload-data') return image;
    const input=Buffer.from(image.png,'base64');
    if (input.length>agentImageByteLimit || input.length<33 || input.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || input.readUInt32BE(8)!==13 || input.subarray(12,16).toString()!=='IHDR' || input.readUInt32BE(16)!==agentImageSize || input.readUInt32BE(20)!==agentImageSize || input[24]!==8 || ![2,6].includes(input[25]??-1) || input[26]!==0 || input[27]!==0 || input[28]!==0) throw Error('Upload a 256 × 256, 8-bit, non-interlaced PNG crop, up to 512 KiB.');
    let bytes:Buffer;
    try { bytes=PNG.sync.write(PNG.sync.read(input,{checkCRC:true})); }
    catch { throw Error('The image crop is not a valid PNG. Choose the image again.'); }
    const assetId=createHash('sha256').update(bytes).digest('hex');
    if (!isAgentImageAssetId(assetId)) throw Error('Invalid generated image identity');
    const target=join(this.root,assetId+'.png');
    if (this.read(assetId)) return {kind:'upload',assetId};
    const temporary=join(this.root,'.upload-'+randomUUID());
    try {
      const fd=openSync(temporary,'wx',0o600);
      try {writeFileSync(fd,bytes);fsyncSync(fd);} finally {closeSync(fd);}
      renameSync(temporary,target);
      const directory=openSync(this.root,'r');try {fsyncSync(directory);} finally {closeSync(directory);}
    } finally {if (existsSync(temporary)) unlinkSync(temporary);}
    return {kind:'upload',assetId};
  }
  read(assetId:string):Buffer|undefined {
    if (!isAgentImageAssetId(assetId)) return;
    try {
      const fd=openSync(join(this.root,assetId+'.png'),constants.O_RDONLY|constants.O_NOFOLLOW);
      try {
        const stat=fstatSync(fd);if(!stat.isFile() || stat.size>agentImageByteLimit)return;
        const bytes=readFileSync(fd);
        return createHash('sha256').update(bytes).digest('hex')===assetId ? bytes : undefined;
      } finally {closeSync(fd);}
    } catch {return;}
  }
}
