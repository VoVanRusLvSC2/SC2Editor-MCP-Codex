import sharp from 'sharp';
import {transformPoint,type MeasuredModel,type Vec3} from './measurement.js';

export const escapeSvg=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export type View='top'|'side'|'isometric';
export function projectPoint(p:number[],view:View):Vec3{return view==='top'?[p[0],-p[1],p[2]]:view==='side'?[p[0],-p[2],-p[1]]:[(p[0]-p[1])*Math.SQRT1_2,(p[0]+p[1])*.408248-p[2]*.816497,(p[0]+p[1])*.57735+p[2]*.57735];}
export interface ModelCard {id:string;model:MeasuredModel;subtitle?:string;reserved?:Array<{minX:number;minY:number;maxX:number;maxY:number}>}
function extents(model:MeasuredModel,view:View){const {min,max}=model.measurement.bounds,points:Vec3[]=[];for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])points.push(projectPoint([x,y,z],view));return {min:[0,1].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1].map(i=>Math.max(...points.map(p=>p[i])))};}
/** Geometry review only: orthographic painter with fixed shared units, not the SC2 material renderer. */
export function modelSheetSvg(cards:ModelCard[],options:{view?:View;pixelsPerUnit?:number;reference?:MeasuredModel;columns?:number}={}){
 if(!cards.length||cards.length>12)throw new Error('MODEL_SHEET_REQUIRES_1_TO_12');
 const view=options.view??'isometric',columns=Math.min(options.columns??3,cards.length),w=360,h=330,rows=Math.ceil(cards.length/columns),bounds=cards.map(c=>extents(c.model,view));
 const referenceOffsets=cards.map(c=>[c.model.measurement.bounds.max[0]+1-(options.reference?.measurement.bounds.min[0]??0),c.model.measurement.bounds.min[1]-(options.reference?.measurement.bounds.min[1]??0),c.model.measurement.bottom-(options.reference?.measurement.bottom??0)]);
 const fitted=bounds.map((b,i)=>{if(!options.reference)return b;const r=extents(options.reference,view),offset=projectPoint(referenceOffsets[i],view);return {min:b.min.map((v,c)=>Math.min(v,r.min[c]+offset[c])),max:b.max.map((v,c)=>Math.max(v,r.max[c]+offset[c]))};});
 const largest=Math.max(1,...fitted.flatMap(b=>[b.max[0]-b.min[0],b.max[1]-b.min[1]]));
 const ppu=options.pixelsPerUnit??Math.min(36,240/largest);if(!Number.isFinite(ppu)||ppu<=0||ppu>512)throw new Error('MODEL_SHEET_SCALE');
 const title=columns===1?`${view.toUpperCase()} · ${ppu.toFixed(2)} px / unit · geometry only`:`${view.toUpperCase()} · ${ppu.toFixed(2)} px / model unit · common scale · geometry only`,legend=columns===1?'Cyan: bounds · yellow: pivot · green: reserved path':'Cyan: geometry bounds · yellow: origin · grey: raw Marine reference · footprints are separate';
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${columns*w}" height="${rows*h+54}"><rect width="100%" height="100%" fill="#101b26"/><style>text{font-family:Arial,sans-serif;fill:#dcecf5;font-size:12px}.dim{fill:#8ed7e8}.small{font-size:10px;fill:#9eafbf}</style><text x="14" y="22">${title}</text><text class="small" x="14" y="42">${legend}</text>`;
 let sampled=false;
 for(let k=0;k<cards.length;k++){
  const card=cards[k],model=card.model,b=bounds[k],fit=fitted[k],x=k%columns*w,y=Math.floor(k/columns)*h+54,cx=(fit.min[0]+fit.max[0])/2,cy=(fit.min[1]+fit.max[1])/2;
  const sx=(v:number)=>w/2+(v-cx)*ppu,sy=(v:number)=>180+(v-cy)*ppu;
  svg+=`<svg x="${x}" y="${y}" width="${w}" height="${h}"><rect x="2" y="2" width="${w-4}" height="${h-4}" rx="7" fill="#182a38"/><text x="12" y="22">${escapeSvg(card.id)}</text><text class="dim" x="12" y="41">${Object.values(model.measurement.dimensions).map(n=>n.toFixed(2)).join(' × ')} · W / D / H</text>`;
  const grid=Math.max(1,Math.ceil(12/ppu));for(let v=-Math.ceil(360/ppu);v<=Math.ceil(360/ppu);v+=grid){const px=sx(v);if(px>5&&px<w-5)svg+=`<line x1="${px}" y1="54" x2="${px}" y2="286" stroke="#284150" stroke-width=".5"/>`;}
  for(let v=Math.floor(cy-125/ppu);v<=cy+125/ppu;v+=grid){const py=sy(v);if(py>54&&py<286)svg+=`<line x1="5" y1="${py}" x2="355" y2="${py}" stroke="#284150" stroke-width=".5"/>`;}
  for(const r of card.reserved??[]){const p=[[r.minX,r.minY,0],[r.maxX,r.minY,0],[r.maxX,r.maxY,0],[r.minX,r.maxY,0]].map(p=>projectPoint(p,view));svg+=`<path d="${p.map((v,i)=>(i?'L':'M')+sx(v[0])+','+sy(v[1])).join('')}Z" fill="#479858" fill-opacity=".28" stroke="#73d382" stroke-dasharray="4 3"/>`;}
  const faces:Array<{depth:number;path:string;color:string}>=[],stride=Math.max(1,Math.ceil(model.geometry.triangleCount/24000));sampled ||= stride>1;
  const draw=(m:MeasuredModel,reference=false)=>{const points=Array.from({length:m.geometry.positions.length/3},(_,i)=>transformPoint(m.geometry.positions.slice(i*3,i*3+3),m.transform));
   const offset=reference?referenceOffsets[k]:[0,0,0];
   for(let i=0;i<m.geometry.indices.length;i+=3*(reference?Math.max(1,Math.ceil(m.geometry.triangleCount/6000)):stride)){
    const tri=m.geometry.indices.slice(i,i+3).map(j=>points[j].map((v,c)=>v+offset[c])),p=tri.map(v=>projectPoint(v,view));
    const a=tri[1].map((v,c)=>v-tri[0][c]),bb=tri[2].map((v,c)=>v-tri[0][c]),n=[a[1]*bb[2]-a[2]*bb[1],a[2]*bb[0]-a[0]*bb[2],a[0]*bb[1]-a[1]*bb[0]],len=Math.hypot(...n)||1,light=.35+.65*Math.abs((n[0]*.3+n[1]*-.4+n[2]*.866)/len),base=reference?[115,120,126]:[90,167,182];
    faces.push({depth:p.reduce((s,v)=>s+v[2],0)/3,path:p.map((v,j)=>(j?'L':'M')+sx(v[0]).toFixed(2)+' '+sy(v[1]).toFixed(2)).join('')+'Z',color:'rgb('+base.map(c=>Math.round(c*light)).join(',')+')'});
   }};
  draw(model);if(options.reference)draw(options.reference,true);faces.sort((a,b)=>a.depth-b.depth);for(const f of faces)svg+=`<path d="${f.path}" fill="${f.color}"/>`;
  svg+=`<rect x="${sx(b.min[0])}" y="${sy(b.min[1])}" width="${(b.max[0]-b.min[0])*ppu}" height="${(b.max[1]-b.min[1])*ppu}" fill="none" stroke="#55dae3" stroke-dasharray="4 3"/>`;
  const pivot=projectPoint(model.measurement.pivot,view);svg+=`<path d="M${sx(pivot[0])-5} ${sy(pivot[1])}h10M${sx(pivot[0])} ${sy(pivot[1])-5}v10" stroke="#ffd36d"/>`;
  const ruler=Math.max(1,Math.ceil(40/ppu));svg+=`<path d="M12 292h${ruler*ppu}M12 287v10M${12+ruler*ppu} 287v10" stroke="#f2df94"/><text class="small" x="12" y="310">${ruler} units · ${escapeSvg(card.subtitle??'rest mesh; catalogue scale applied when resolved')}</text></svg>`;
 }
 return {svg:svg+'</svg>',pixelsPerUnit:ppu,view,sampled,reference:!!options.reference,width:columns*w,height:rows*h+54};
}
export async function modelSheetPng(cards:ModelCard[],options:Parameters<typeof modelSheetSvg>[1]={}){const result=modelSheetSvg(cards,options);return {...result,svg:undefined,bytes:await sharp(Buffer.from(result.svg),{limitInputPixels:16*1024*1024}).png().toBuffer()};}
