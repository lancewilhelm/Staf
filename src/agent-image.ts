export const agentImageShapes = {
  circle: {label:'Circle'},
  'rounded-square': {label:'Rounded square'},
  capsule: {label:'Capsule'},
  triangle: {label:'Triangle'},
  pentagon: {label:'Pentagon'},
  hexagon: {label:'Hexagon'},
};
export const agentImageColors = {
  apricot:{label:'Apricot',hex:'#EFAB78'}, coral:{label:'Coral',hex:'#EB8D88'},
  marigold:{label:'Marigold',hex:'#E6C368'}, sage:{label:'Sage',hex:'#A8C79B'},
  lagoon:{label:'Lagoon',hex:'#7CC6BD'}, sky:{label:'Sky',hex:'#8BB8DE'},
  lilac:{label:'Lilac',hex:'#B4A0D6'}, rose:{label:'Rose',hex:'#D9A0BC'},
};
export type AgentImageShape = keyof typeof agentImageShapes;
export type AgentImageColor = keyof typeof agentImageColors;
export type AgentImageAssetId = string & {readonly __agentImageAssetId: unique symbol};
export type AgentImage = {kind:'initials'} | {kind:'avatar';shape:AgentImageShape;color:AgentImageColor} | {kind:'upload';assetId:AgentImageAssetId};
export type AgentImageInput = AgentImage | {kind:'upload-data';png:string};
export const agentImageSize = 256;
export const agentImageByteLimit = 512 * 1024;
export const agentImageBodyType = 'application/vnd.staf.agent-image+json';
export const agentImageBodyLimit = 1024 * 1024;

export function isAgentImageShape(value:unknown):value is AgentImageShape { return typeof value==='string' && Object.hasOwn(agentImageShapes,value); }
export function isAgentImageColor(value:unknown):value is AgentImageColor { return typeof value==='string' && Object.hasOwn(agentImageColors,value); }
export function isAgentImageAssetId(value:unknown):value is AgentImageAssetId { return typeof value==='string' && /^[a-f0-9]{64}$/.test(value); }
export function parseAgentImage(value:unknown):AgentImage {
  if (value===undefined) return {kind:'initials'};
  if (value && typeof value==='object' && !Array.isArray(value) && 'kind' in value) {
    const keys=Object.keys(value);
    if (value.kind==='initials' && keys.length===1) return {kind:'initials'};
    if (value.kind==='avatar' && keys.length===3 && 'shape' in value && isAgentImageShape(value.shape) && 'color' in value && isAgentImageColor(value.color)) return {kind:'avatar',shape:value.shape,color:value.color};
    if (value.kind==='upload' && keys.length===2 && 'assetId' in value && isAgentImageAssetId(value.assetId)) return {kind:'upload',assetId:value.assetId};
  }
  throw Error('Invalid agent image. Choose initials, an available shape and color, or a saved image.');
}
export function parseAgentImageInput(value:unknown):AgentImageInput {
  if (value && typeof value==='object' && !Array.isArray(value) && 'kind' in value && value.kind==='upload-data' && Object.keys(value).length===2 && 'png' in value && typeof value.png==='string' && value.png.length>0 && value.png.length<=Math.ceil(agentImageByteLimit/3)*4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.png)) return {kind:'upload-data',png:value.png};
  return parseAgentImage(value);
}
export function imageSetting(image:AgentImage|undefined):string|null {
  if (!image || image.kind==='initials') return null;
  return image.kind==='avatar' ? `avatar:${image.shape}:${image.color}` : `upload:${image.assetId}`;
}
export function parseImageSetting(value:unknown):AgentImage {
  if (value===undefined || value==='initials') return {kind:'initials'};
  if (typeof value==='string') {
    const parts=value.split(':');
    if (parts.length===3 && parts[0]==='avatar') return parseAgentImage({kind:'avatar',shape:parts[1],color:parts[2]});
    if (parts.length===2 && parts[0]==='upload') return parseAgentImage({kind:'upload',assetId:parts[1]});
  }
  throw Error('Invalid image setting. Use initials, avatar:SHAPE:COLOR, or upload:ASSET_ID.');
}
export function avatarSvg(image:Extract<AgentImage,{kind:'avatar'}>):string {
  let body:string;
  switch (image.shape) {
    case 'circle': body='<circle cx="32" cy="32" r="26"/>';break;
    case 'rounded-square': body='<rect x="8" y="8" width="48" height="48" rx="15"/>';break;
    case 'capsule': body='<rect x="4" y="14" width="56" height="36" rx="18"/>';break;
    default: {
      const sides={triangle:3,pentagon:5,hexagon:6}[image.shape];
      const point=(index:number)=>{const a=-Math.PI/2+index*Math.PI*2/sides;return {x:32+28*Math.cos(a),y:32+28*Math.sin(a)};};
      // Trim six SVG units from each end of every edge, then round each vertex.
      const trim=6/(56*Math.sin(Math.PI/sides));
      const corners=Array.from({length:sides},(_,index)=>{
        const vertex=point(index),before=point(index-1),after=point(index+1);
        const entry=`${(vertex.x+(before.x-vertex.x)*trim).toFixed(6)},${(vertex.y+(before.y-vertex.y)*trim).toFixed(6)}`;
        const exit=`${(vertex.x+(after.x-vertex.x)*trim).toFixed(6)},${(vertex.y+(after.y-vertex.y)*trim).toFixed(6)}`;
        return `${index===0?'M':'L'} ${entry} Q ${vertex.x.toFixed(6)},${vertex.y.toFixed(6)} ${exit}`;
      });
      body=`<path d="${corners.join(' ')} Z"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><g fill="${agentImageColors[image.color].hex}">${body}</g><g fill="#000"><circle cx="26" cy="32" r="3.2"/><circle cx="38" cy="32" r="3.2"/></g></svg>`;
}
