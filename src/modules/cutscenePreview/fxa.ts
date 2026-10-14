import type {FacialController} from './types.js';
/** Bounded, independently written reader for the SC2 FACE/1731 compiled archive.
 * Layout cross-checked with installed FirstOfficer and the published LegendaryExplorer
 * FaceFXAsset/FaceFXAnimSet field descriptions. No SDK or third-party code is embedded. */
export function readSc2Fxa(bytes:Buffer):FacialController {
 let at=0;const bounds=(n:number)=>{if(n<0||!Number.isSafeInteger(n)||at+n>bytes.length)throw new Error('FXA_TRUNCATED');};
 const u=()=>{bounds(4);const v=bytes.readUInt32LE(at);at+=4;return v;},short=()=>{bounds(2);const v=bytes.readUInt16LE(at);at+=2;return v;};
 const count=(limit=4096)=>{const n=u();if(n>limit)throw new Error('FXA_COUNT_BUDGET');return n;};
 const floats=(n:number)=>{bounds(n*4);const out=Array.from({length:n},(_,i)=>bytes.readFloatLE(at+i*4));at+=n*4;if(out.some(v=>!Number.isFinite(v)||Math.abs(v)>1e9))throw new Error('FXA_NONFINITE');return out;};
 const string=()=>{const n=count(4096);bounds(n);const s=bytes.toString('utf8',at,at+n).replace(/\0$/,'');at+=n;return s;};
 if(bytes.length>16*1024*1024||u()!==0x45434146)throw new Error('FXA_VERSION_UNSUPPORTED');const version=u();if(![1731,1740].includes(version))throw new Error('FXA_VERSION_UNSUPPORTED');u();
 let product='';for(let i=0;i<32;i++){bounds(1);const c=bytes[at++];if(!c)break;product+=String.fromCharCode(c);}if(product!=='SC2')throw new Error('FXA_PRODUCT_UNSUPPORTED');
 const licensee=string(),project=string(),sdk=u();short();const classes=Array.from({length:count(64)},()=>{u();return Array.from({length:count(16)},()=>{const name=string(),version=short();return {name,version};});}).flat();
 if(!classes.some(c=>c.name==='FxCompiledFaceGraph'))throw new Error('FXA_GRAPH_FORMAT_UNSUPPORTED');
 const names=Array.from({length:count(10000)},string),name=(id:number)=>{if(id>=names.length)throw new Error('FXA_NAME_INDEX');return names[id];};
 u();u();const bones=Array.from({length:count(1024)},()=>{const n=name(u()),position=floats(3),rotation=floats(4),scale=floats(3);floats(4);u();const weight=floats(1)[0];const poses=Array.from({length:count(4096)},()=>{const node=u();name(u());const position=floats(3),rotation=floats(4),scale=floats(3);return {node,position,rotation,scale};});return {name:n,position,rotation,scale,weight,poses};});
 const nodes=Array.from({length:count(4096)},()=>{const type=u(),n=name(u()),range=floats(4),operation=u();const links=Array.from({length:count(4096)},()=>({node:u(),function:u(),parameters:floats(count(32))}));const parameters=Array.from({length:count(128)},()=>{const n=name(u()),type=u(),integer=u(),decimal=floats(1)[0];u();const value=type===3?string():undefined;if(![0,1,2,3].includes(type))throw new Error('FXA_PARAMETER_TYPE');return {name:n,type,integer,decimal,value};});return {type,name:n,min:range[0],max:range[2],operation,links,parameters};});
 for(const n of nodes)for(const l of n.links)if(l.node>=nodes.length)throw new Error('FXA_GRAPH_LINK');for(const b of bones)for(const p of b.poses)if(p.node>=nodes.length)throw new Error('FXA_POSE_NODE');
 // Compiled user-property table consumes one graph row per stored string.
 for(let i=0;i<nodes.length;){name(u());u();const n=count(128);for(let j=0;j<n;j++){if(j)u();string();}i+=Math.max(1,n);}
 u();let totalKeys=0;const readGroup=()=>{const group=name(u());return Array.from({length:count(4096)},()=>{const n=name(u()),channels=Array.from({length:count(4096)},()=>{const n=name(u());u();return n;});const points=Array.from({length:count(500000)},()=>{totalKeys++;if(totalKeys>1000000)throw new Error('FXA_KEY_BUDGET');return floats(4);});const sizes=points.length?Array.from({length:count(4096)},u):channels.map(()=>0);if(sizes.length!==channels.length||sizes.reduce((a,b)=>a+b,0)!==points.length)throw new Error('FXA_CURVE_KEY_COUNTS');const [fadeIn,fadeOut]=floats(2);u();const audio=string(),id=string();u();let offset=0;const curves=channels.map((name,i)=>({name,keys:points.slice(offset,offset+=sizes[i])}));for(const c of curves)if(c.keys.some((k,i)=>i>0&&k[0]<c.keys[i-1][0]))throw new Error('FXA_KEY_ORDER');return {name:n,group,fadeIn,fadeOut,audio,id,curves};});};const clips=readGroup();for(let i=0,n=count(512);i<n;i++)clips.push(...readGroup());
 for(let i=0,n=count(10000);i<n;i++){name(u());name(u());floats(1);}for(let i=0,n=count(4096);i<n;i++)name(u());if(at!==bytes.length)throw new Error('FXA_TRAILING_BYTES_UNSUPPORTED');
 const unsupported=[...new Set(nodes.filter(n=>![0,4].includes(n.type)||![0,1].includes(n.operation)||n.links.some(l=>l.function!==1)).map(n=>n.name))];
 return {version,licensee,project,sdk,bones,nodes,clips,decodedBytes:at,totalBytes:bytes.length,unsupported,parity:false};
}
