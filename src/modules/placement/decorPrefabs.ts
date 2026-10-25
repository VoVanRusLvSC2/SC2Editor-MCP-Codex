import * as z from 'zod/v4';
import {createHash} from 'node:crypto';
import {DecorPalette,type DecorModel} from './decorPalette.js';
import {structuralDamageHint} from './styleCatalog.js';
import {measureGeometry,transformPoint,type Geometry,type MeasuredModel} from '../assets/measurement.js';

export const prefabRecipeSchema=z.enum(['base_entrance','service_yard','landing_pad','forest_edge','supply_cluster']);
export const prefabSchema=z.object({tileset:z.string().min(1),recipe:prefabRecipeSchema,anchor:z.object({x:z.number().finite(),y:z.number().finite()}).strict().default({x:0,y:0}),angle:z.number().finite().default(0),clearance:z.number().min(3).max(40).default(6),fence:z.string().optional(),light:z.string().optional(),prop:z.string().optional(),secondaryProp:z.string().optional(),tree:z.string().optional(),seed:z.number().int().default(42),includeImage:z.boolean().default(true)}).strict();
export const assembleSchema=prefabSchema.extend({zone:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),maxSlope:z.number().nonnegative().default(.5),directory:z.string().default(''),dryRun:z.boolean().default(true),stage:z.boolean().default(true)}).strict();
type Rect={minX:number;minY:number;maxX:number;maxY:number};
export function overlaps(a:Rect,b:Rect){return a.minX<b.maxX&&a.maxX>b.minX&&a.minY<b.maxY&&a.maxY>b.minY;}
type Member={id:string;key:string;offset:{x:number;y:number};heightOffset:number;horizontalBounds:Rect;boundsFrame:'member';rotation:number;scale:number;variation:number};
export interface Slot {name:string;decor:DecorModel}
/** Deterministic local layout using measured geometry, with no inference of game collision. */
export function layoutPrefab(recipe:z.infer<typeof prefabSchema>['recipe'],slots:Slot[],clearance:number,seed:number){
 const members:Member[]=[],bounds:Rect[]=[],models:MeasuredModel[]=[],connections:Array<Record<string,unknown>>=[];
 const reserved:Rect=recipe==='landing_pad'?{minX:-clearance/2,minY:-clearance/2,maxX:clearance/2,maxY:clearance/2}:recipe==='supply_cluster'?{minX:-1e6,minY:-clearance,maxX:1e6,maxY:0}:{minX:-clearance/2,minY:-1e6,maxX:clearance/2,maxY:1e6};
 const slot=(name:string)=>{const found=slots.find(s=>s.name===name);if(!found)throw new Error('PREFAB_SLOT_REQUIRED: '+name);return found.decor;};
 const add=(name:string,x:number,y:number,rotation=0)=>{
  const d=slot(name),g=d.measured.geometry,initial=measureGeometry(g,{...d.measured.transform,rotation}),unrotated=measureGeometry(g,{...d.measured.transform,rotation:0}),center=initial.center;
  // Offsets refer to the actual model pivot. Centre each mesh on a desired layout point.
  const offset={x:x-center[0],y:y-center[1]},transform={...d.measured.transform,rotation,position:[offset.x,offset.y,-initial.bottom] as [number,number,number]},measurement=measureGeometry(g,transform),b=measurement.bounds,r={minX:b.min[0],maxX:b.max[0],minY:b.min[1],maxY:b.max[1]};
  if(overlaps(r,reserved))throw new Error('PREFAB_VISUAL_BOUNDS_INTRUDE_RESERVED_PATH: '+d.actor.id);
  if(bounds.some(b=>overlaps(r,b)))throw new Error('PREFAB_VISUAL_BOUNDS_OVERLAP: '+d.actor.id);
  members.push({id:d.actor.id,key:d.actor.key,offset,heightOffset:-initial.bottom,horizontalBounds:{minX:unrotated.bounds.min[0],maxX:unrotated.bounds.max[0],minY:unrotated.bounds.min[1],maxY:unrotated.bounds.max[1]},boundsFrame:'member',rotation,scale:1,variation:d.variation??0});bounds.push(r);models.push({...d.measured,transform,measurement});
 };
 if(recipe==='base_entrance'){
  const fence=slot('fence'),d=fence.measured.measurement.dimensions,rotate=d.depth>d.width?Math.PI/2:0,length=Math.max(d.width,d.depth),thickness=Math.min(d.width,d.depth);if(length<.1)throw new Error('PREFAB_FENCE_DIMENSIONS');
  for(const sign of [-1,1])for(let i=0;i<3;i++)add('fence',sign*(clearance/2+length/2+i*(length+.05)),0,rotate);
  const light=slot('light').measured.measurement.dimensions;
  for(const sign of [-1,1])add('light',sign*(clearance/2+light.width/2+.5),thickness/2+light.depth/2+1);
  connections.push({type:'fence_run',axis:'local X',span:length,gap:.05,evidence:'Measured major AABB axis; endpoints are geometric candidates, not verified sockets'});
 }else if(recipe==='service_yard'){
  const d=slot('prop').measured.measurement.dimensions;for(const sign of [-1,1])for(let i=0;i<3;i++)add('prop',sign*(clearance/2+d.width/2+.6),(i-1)*(d.depth+.7));
  const l=slot('light').measured.measurement.dimensions;for(const sign of [-1,1])add('light',sign*(clearance/2+l.width/2+.5),2*(d.depth+.7)+l.depth/2);
 }else if(recipe==='supply_cluster'){
  const p=slot('prop').measured.measurement.dimensions,s=slot('secondaryProp').measured.measurement.dimensions,l=slot('light').measured.measurement.dimensions;
  if([p.width,p.depth,s.width,s.depth,l.width,l.depth].some(v=>!Number.isFinite(v)||v<=.01))throw Error('PREFAB_SUPPLY_DIMENSIONS');
  const secondary=slot('secondaryProp').measured,turned=measureGeometry(secondary.geometry,{...secondary.transform,rotation:Math.PI/2}).dimensions,gap=.45,front=.6,x=p.width/2+gap+s.width/2;
  add('prop',0,front+p.depth/2);
  add('secondaryProp',x,front+s.depth/2);
  add('secondaryProp',x,front+s.depth+gap+s.depth/2);
  const right=x+s.width/2+gap+turned.width/2;
  add('secondaryProp',right,front+turned.depth/2,Math.PI/2);
  add('light',-p.width/2-gap-l.width/2,front+l.depth/2);
  add('light',right+turned.width/2+gap+l.width/2,front+Math.max(p.depth,2*s.depth+gap,l.depth)-l.depth/2);
  reserved.minX=Math.min(...bounds.map(b=>b.minX))-.5;reserved.maxX=Math.max(...bounds.map(b=>b.maxX))+.5;
  connections.push({type:'service_apron',depth:clearance,approach:'local negative Y',evidence:'Open measured visual apron; not an engine building or collision footprint'});
 }else if(recipe==='landing_pad'){
  const d=slot('light').measured.measurement.dimensions;for(const sx of [-1,1])for(const sy of [-1,1])add('light',sx*(clearance/2+d.width/2+.5),sy*(clearance/2+d.depth/2+.5));
  const p=slot('prop').measured.measurement.dimensions;add('prop',clearance/2+p.width/2+2,clearance/2+d.depth+p.depth/2+2);
 }else{
  const d=slot('tree').measured.measurement.dimensions;let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const radius=Math.hypot(d.width,d.depth)/2,step=radius*2+1;
  for(const sign of [-1,1])for(let i=0;i<4;i++)add('tree',sign*(clearance/2+radius+.6+random()*.6),(i-1.5)*step,random()*Math.PI*2);
 }
 if(recipe!=='landing_pad'&&recipe!=='supply_cluster'){reserved.minY=Math.min(...bounds.map(b=>b.minY))-2;reserved.maxY=Math.max(...bounds.map(b=>b.maxY))+2;}
 return {members,bounds,models,reserved:[reserved],connections,clearance,checks:{visualBoundsVsReservedPath:'pass',visualBoundsOverlap:'pass',enginePathing:'not_checked'}};
}
export class DecorPrefabs {
 constructor(readonly palette:DecorPalette){}
 async plan(input:z.input<typeof prefabSchema>){return this.palette.browse.withSnapshot(async()=>{
  const a=prefabSchema.parse(input),pack=await this.palette.catalog.pack(a.tileset),rows=[...pack.sections.decor??[],...pack.sections.vegetation??[]];
  const patterns:Record<string,RegExp>={fence:/FenceStraight$/,light:/LandingLights|StreetLight|Lamp|CableLight/,prop:a.recipe==='supply_cluster'?/SupplyTanks|Container|Crate/:/Barrels|Crate|SupplyTanks/,secondaryProp:/Barrels|Crate|SupplyTanks/,tree:/Tree$/};
  const required=a.recipe==='base_entrance'?['fence','light']:a.recipe==='forest_edge'?['tree']:a.recipe==='supply_cluster'?['light','prop','secondaryProp']:['light','prop'],slots:Slot[]=[],selectionDiagnostics:Array<{slot:string;id:string;error:string}>=[];
  for(const name of required){const explicit=a[name as keyof typeof a] as string|undefined,candidates=explicit?[explicit]:rows.filter(r=>patterns[name].test(r.id)&&(a.recipe!=='supply_cluster'||!structuralDamageHint(r))).map(r=>r.id).slice(0,8);let found=false;
   for(const id of candidates){try{const decor=await this.palette.resolve({id,variation:0});if(a.recipe==='supply_cluster'&&!explicit&&slots.some(s=>s.decor.actor.key===decor.actor.key)){selectionDiagnostics.push({slot:name,id,error:'PREFAB_DISTINCT_AUTOMATIC_SLOT_REQUIRED'});continue;}slots.push({name,decor});found=true;break;}catch(e){selectionDiagnostics.push({slot:name,id,error:e instanceof Error?e.message:String(e)});}}
   if(!found)throw new Error('PREFAB_NO_MEASURABLE_SLOT: '+name+'; '+JSON.stringify(selectionDiagnostics));
  }
  const layout=layoutPrefab(a.recipe,slots,a.clearance,a.seed),positions:number[]=[],indices:number[]=[];
  for(const m of layout.models){const base=positions.length/3;for(let i=0;i<m.geometry.positions.length;i+=3)positions.push(...transformPoint(m.geometry.positions.slice(i,i+3),m.transform));indices.push(...m.geometry.indices.map(i=>i+base));}
  const geometry={positions,indices,vertexCount:positions.length/3,triangleCount:indices.length/3,regions:layout.models.length,stride:12,bounds:{min:[0,0,0],max:[0,0,0]},pose:'raw-rest-geometry',materials:false,animations:false} as Geometry;
  const model:MeasuredModel={file:'prefab:'+a.recipe,sha256:createHash('sha256').update(JSON.stringify({slots:slots.map(s=>({name:s.name,sha:s.decor.measured.sha256,scales:s.decor.scales})),members:layout.members})).digest('hex'),build:slots[0].decor.measured.build,geometry,transform:{},measurement:measureGeometry(geometry),attachmentNames:[],cacheHit:false};
  const image=await this.palette.image([{id:a.recipe,model,reserved:layout.reserved}],'isometric'),top=await this.palette.image([{id:a.recipe,model,reserved:layout.reserved}],'top');
  const c=Math.cos(a.angle),s=Math.sin(a.angle),reservedWorld=layout.reserved.map(r=>{const points=[[r.minX,r.minY],[r.minX,r.maxY],[r.maxX,r.minY],[r.maxX,r.maxY]].map(([x,y])=>[a.anchor.x+c*x-s*y,a.anchor.y+s*x+c*y]);return {type:'rectangle' as const,minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1]))};});
  // Keep the exact local corridor for geometry checks. A rotated corridor's enclosing AABB
  // would wrongly reject valid members, so compose does not use that approximate exclusion.
  const composeArgs={tileset:a.tileset,profile:a.recipe==='forest_edge'?'forest':'terran_fortified',recipe:'measured_group' as const,prefabRecipe:a.recipe,anchor:a.anchor,angle:a.angle,members:layout.members,seed:a.seed};
  return {recipe:a.recipe,tileset:a.tileset,members:layout.members,reservedLocal:layout.reserved,reservedWorld,clearance:a.clearance,connections:layout.connections,slots:slots.map(s=>({slot:s.name,...this.palette.summary(s.decor)})),selectionDiagnostics,checks:layout.checks,composeArgs,pngFile:image.pngFile,topPngFile:top.pngFile,note:'Measured rest geometry layout. No terrain paint or engine footprint claim. Placement uses nominal variation 0; random actor scale/variations require in-engine review.'};
 });}
}
