import {transformPoint,type Transform} from './transform.js';

/** ATT_ v1 + IREF bind matrices. These are model attachments, not fence connector semantics. */
export function attachmentMeasurements(b:Buffer,transform:Transform={}){
 const attachments:Array<{name:string;bone:number;position:number[];evidence:string}>=[],issues:string[]=[];
 try{
  if(b.length<24||b.toString('ascii',0,4)!=='43DM')throw new Error('ATTACHMENT_MD34_REQUIRED');
  const offset=b.readUInt32LE(4),count=b.readUInt32LE(8);if(count>10000||offset+count*16>b.length)throw new Error('ATTACHMENT_INDEX_BOUNDS');
  const sections=Array.from({length:count},(_,i)=>{const at=offset+i*16;return {tag:b.toString('ascii',at,at+4).split('').reverse().join(''),offset:b.readUInt32LE(at+4),count:b.readUInt32LE(at+8),version:b.readUInt32LE(at+12)};});
  const bind=sections.find(s=>s.tag==='IREF');
  for(const section of sections.filter(s=>s.tag==='ATT_')){
   if(section.version!==1||section.count>1024||section.offset+section.count*20>b.length)throw new Error('ATTACHMENT_LAYOUT_UNSUPPORTED');
   for(let i=0;i<section.count;i++){
    const at=section.offset+i*20,n=b.readUInt32LE(at+4),nameSection=sections[b.readUInt32LE(at+8)],bone=b.readUInt32LE(at+16);
    if(!nameSection||nameSection.tag!=='CHAR'||n>4096||nameSection.offset+n>b.length)throw new Error('ATTACHMENT_NAME_BOUNDS');
    const name=b.toString('utf8',nameSection.offset,nameSection.offset+n).replace(/\0.*$/s,'');
    if(!bind||bind.version!==0||bone>=bind.count||bind.offset+(bone+1)*64>b.length){issues.push('ATTACHMENT_BIND_UNAVAILABLE: '+name);continue;}
    const m=Array.from({length:16},(_,c)=>b.readFloatLE(bind.offset+bone*64+c*4));if(m.some(v=>!Number.isFinite(v)))throw new Error('ATTACHMENT_BIND_NONFINITE');
    // Solve inverse-bind A*x+t=0 to recover the bind-space bone origin.
    const [a,d,g,,bb,e,h,,c,f,j,,tx,ty,tz]=m,det=a*(e*j-f*h)-bb*(d*j-f*g)+c*(d*h-e*g);
    if(Math.abs(det)<1e-10){issues.push('ATTACHMENT_SINGULAR_BIND: '+name);continue;}
    const p=[(-(e*j-f*h)*tx+(bb*j-c*h)*ty-(bb*f-c*e)*tz)/det,((d*j-f*g)*tx-(a*j-c*g)*ty+(a*f-c*d)*tz)/det,(-(d*h-e*g)*tx+(a*h-bb*g)*ty-(a*e-bb*d)*tz)/det];
    attachments.push({name,bone,position:transformPoint(p,transform).map(v=>Math.round(v*1e6)/1e6),evidence:'ATT_ v1 bone origin from inverse IREF bind matrix; supplied model transform applied'});
   }
  }
 }catch(e){issues.push(e instanceof Error?e.message:String(e));}
 return {attachments,issues,pose:'bind-pose only',semantics:'Model attachment names do not certify fence connection sockets'};
}
