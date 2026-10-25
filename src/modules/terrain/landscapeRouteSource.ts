import * as z from 'zod/v4';
import path from 'node:path';
import type {Workspace} from '../../core/workspace.js';
import {readJsonPlanFile} from '../../core/jsonPlanFile.js';
import {bytesHash} from '../../core/binaryTransactions.js';
import {testManifestSchema} from '../testing/schemas.js';
import type {LocationRoute,ExclusionZone} from '../placement/types.js';
import type {PlacementDocument} from '../placement/document.js';
import {measuredMemberGeometry} from '../placement/compositionGeometry.js';
import {checkGroupClearance} from '../placement/groupClearance.js';
import {areaDistance} from './geometry.js';
import type {LandscapeState} from './landscapeOwnership.js';
import type {TerrainArea} from './types.js';
import {containsReservedCenter} from './landscapePadSource.js';

const point=z.object({x:z.number().finite(),y:z.number().finite()}).strict();
const corridor=z.object({points:z.array(point).min(2).max(100),width:z.number().finite().positive().max(256)}).strict();
export const landscapeRouteSourceSchema=z.object({file:z.string().min(1).max(512),clearWidth:z.number().finite().positive().max(256)}).strict();
export const landscapeRouteBindingSchema=landscapeRouteSourceSchema.extend({sha256:z.string().regex(/^[a-f0-9]{64}$/),corridors:z.array(corridor).max(50),blockedRouteIds:z.array(z.string()).max(16)}).strict();
export type LandscapeRouteBinding=z.infer<typeof landscapeRouteBindingSchema>;

/** Geometry-only reservation union. Execution tolerances are deliberately ignored. */
export function mergeRouteReservations(routes:readonly LocationRoute[]):LocationRoute[]{
 const unique=new Map<string,LocationRoute>();
 for(const route of routes){
  const forward=JSON.stringify(route.points),reverse=JSON.stringify([...route.points].reverse()),key=forward<reverse?forward:reverse;
  const previous=unique.get(key);if(!previous||route.width>previous.width)unique.set(key,{points:JSON.parse(key),width:route.width});
 }
 if(unique.size>50)throw Error('LANDSCAPE_ROUTE_SOURCE_LIMIT: at most50 combined unique corridors');
 return [...unique].sort(([a],[b])=>a.localeCompare(b)).map(([,route])=>route);
}

export function addedRouteReservations(previous:readonly LocationRoute[],current:readonly LocationRoute[]){
 const widths=new Map(mergeRouteReservations(previous).map(route=>[JSON.stringify(route.points),route.width]));
 return mergeRouteReservations(current).filter(route=>(widths.get(JSON.stringify(route.points))??0)<route.width);
}

export async function resolveLandscapeRouteSource(workspace:Workspace,source:z.infer<typeof landscapeRouteSourceSchema>){
 const file=path.relative(workspace.root,workspace.resolveUserPath(source.file)).replaceAll('\\','/'),manifest=testManifestSchema.parse(await readJsonPlanFile(workspace,file));
 const raw=await workspace.readRaw(file),points=manifest.game?.points??{},routes:LocationRoute[]=[],blockedRouteIds:string[]=[];
 const endpoint=(id:string)=>{if(!Object.hasOwn(points,id))throw Error('LANDSCAPE_ROUTE_SOURCE_ENDPOINT_REQUIRED: '+id);return points[id];};
 for(const route of manifest.game?.routes??[]){
  if(route.expected==='blocked'){blockedRouteIds.push(route.id);continue;}
  routes.push({points:[endpoint(route.from),endpoint(route.to)],width:source.clearWidth});
 }
 for(const formation of manifest.game?.formations??[])for(const offset of formation.offsets){
  routes.push({points:[endpoint(formation.from),endpoint(formation.to)].map(p=>({x:p.x+offset.x,y:p.y+offset.y})),width:source.clearWidth});
 }
 const corridors=mergeRouteReservations(routes);
 if(!corridors.length)throw Error('LANDSCAPE_ROUTE_SOURCE_EMPTY: no positive ground routes or formation members');
 return {binding:landscapeRouteBindingSchema.parse({...source,file,sha256:bytesHash(Buffer.from(raw.text)),corridors,blockedRouteIds}),manifestMap:manifest.map};
}

/** Review unchanged owned geometry at its actual current transform; never move it. */
export function ownedReservationConflicts(zones:LandscapeState['zones'],document:PlacementDocument,routes:LocationRoute[],area:TerrainArea,excluded:ReadonlySet<string>,exclusions:ExclusionZone[]=[]){
 if(!routes.length&&!exclusions.length)return new Set<string>();
 const current=new Map(document.list().flatMap(object=>object.id===undefined?[]:[[object.id,object] as const]));
 const conflicts=new Set<string>();
 for(const zone of zones){if(excluded.has(zone.id))continue;
  for(const owned of zone.objects){
   const placed=current.get(owned.id);if(!placed)continue;
   const [x,y]=placed.position?.split(',').map(Number)??[];if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('LANDSCAPE_OWNED_POSITION_INVALID');
   const slot=owned.slot?.startsWith('group:')?owned.slot.split(':'):undefined;
   if(!slot){if(routes.some(route=>areaDistance({type:'corridor',points:route.points,width:route.width},{x,y})>=0)||containsReservedCenter(exclusions,{x,y}))conflicts.add(zone.id);continue;}
   const group=zone.config.groups.find(group=>group.id===slot[1]),member=group?.members[Number(slot[2])];
   if(!group||!member)throw Error('LANDSCAPE_GROUP_SLOT_MISMATCH');
   if(placed.catalogId!==member.id||Number(placed.variation??0)!==(member.variation??0))throw Error('LANDSCAPE_ROUTE_SOURCE_MANUAL_MODEL_REVIEW: '+zone.id+'/'+owned.id);
   const rotation=Number(placed.rotation??0),scale=placed.scale?.split(',').map(Number)??[1,1,1];
   if(!Number.isFinite(rotation)||scale.length!==3||scale.some(value=>!Number.isFinite(value)||value<=0))throw Error('LANDSCAPE_ROUTE_SOURCE_TRANSFORM_REVIEW: '+zone.id+'/'+owned.id);
   const expected=measuredMemberGeometry(group.anchor,group.angle,member),c=Math.cos(expected.rotation),s=Math.sin(expected.rotation),rc=Math.cos(rotation),rs=Math.sin(rotation);
   const geometry={position:{x,y},corners:expected.corners.map(p=>{const dx=p.x-expected.position.x,dy=p.y-expected.position.y,localX=(c*dx+s*dy)*scale[0]/member.scale,localY=(-s*dx+c*dy)*scale[1]/member.scale;return{x:x+rc*localX-rs*localY,y:y+rs*localX+rc*localY};})};
   try{checkGroupClearance(geometry,area,routes,exclusions);}catch(error){if(/LANDSCAPE_GROUP_IN_RESERVED_ROUTE|LANDSCAPE_GROUP_IN_EXCLUSION/.test(String(error)))conflicts.add(zone.id);else throw error;}
  }
 }
 return conflicts;
}
