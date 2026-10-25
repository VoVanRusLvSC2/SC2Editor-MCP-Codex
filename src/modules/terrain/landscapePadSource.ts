import * as z from 'zod/v4';
import path from 'node:path';
import type {Workspace} from '../../core/workspace.js';
import {readJsonPlanFile} from '../../core/jsonPlanFile.js';
import {bytesHash} from '../../core/binaryTransactions.js';
import {testManifestSchema} from '../testing/schemas.js';
import type {ExclusionZone} from '../placement/types.js';

const name=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const selection=z.object({id:name,clearWidth:z.number().finite().positive().max(256),clearHeight:z.number().finite().positive().max(256)}).strict();
const selections=z.array(selection).min(1).max(32).refine(a=>new Set(a.map(p=>p.id)).size===a.length,'Pad selections must have unique IDs');
export const landscapePadSourceSchema=z.object({file:z.string().min(1).max(512),pads:selections}).strict();
const rectangle=z.object({type:z.literal('rectangle'),minX:z.number().finite(),maxX:z.number().finite(),minY:z.number().finite(),maxY:z.number().finite()}).strict();
export const landscapePadBindingSchema=landscapePadSourceSchema.extend({sha256:z.string().regex(/^[a-f0-9]{64}$/),reservations:z.array(z.object({id:name,type:z.string().min(1).max(256),owner:z.number().int().min(0).max(15),area:rectangle}).strict()).min(1).max(32)}).strict();
export type LandscapePadBinding=z.infer<typeof landscapePadBindingSchema>;
export type PadRectangle=z.infer<typeof rectangle>;

/** Explicit design clearance; never infer an engine footprint from render bounds. */
export async function resolveLandscapePadSource(workspace:Workspace,source:z.infer<typeof landscapePadSourceSchema>){
 const file=path.relative(workspace.root,workspace.resolveUserPath(source.file)).replaceAll('\\','/'),manifest=testManifestSchema.parse(await readJsonPlanFile(workspace,file));
 const raw=await workspace.readRaw(file),pads=new Map(manifest.game?.pads.map(p=>[p.id,p])??[]),points=manifest.game?.points??{};
 const reservations=source.pads.map(s=>{
  const pad=pads.get(s.id);if(!pad)throw Error('LANDSCAPE_PAD_SOURCE_CHECK_REQUIRED: '+s.id);
  if(pad.expected!=='exact')throw Error('LANDSCAPE_PAD_SOURCE_EXACT_EXPECTATION_REQUIRED: '+s.id);
  if(!Object.hasOwn(points,pad.at))throw Error('LANDSCAPE_PAD_SOURCE_POINT_REQUIRED: '+pad.at);
  const p=points[pad.at];return {id:pad.id,type:pad.type,owner:pad.owner,area:{type:'rectangle' as const,minX:p.x-s.clearWidth/2,maxX:p.x+s.clearWidth/2,minY:p.y-s.clearHeight/2,maxY:p.y+s.clearHeight/2}};
 });
 return {binding:landscapePadBindingSchema.parse({file,pads:source.pads,sha256:bytesHash(Buffer.from(raw.text)),reservations}),manifestMap:manifest.map};
}

export function padReservationAreas(binding?:LandscapePadBinding):PadRectangle[]{
 return [...new Map((binding?.reservations??[]).map(p=>[JSON.stringify(p.area),p.area])).entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,area])=>area);
}
export function addedPadReservations(previous:PadRectangle[],current:PadRectangle[]){
 return current.filter(c=>!previous.some(p=>p.minX<=c.minX&&p.maxX>=c.maxX&&p.minY<=c.minY&&p.maxY>=c.maxY));
}
export const containsReservedCenter=(zones:readonly ExclusionZone[],p:{x:number;y:number})=>zones.some(z=>z.type==='circle'?Math.hypot(p.x-z.center.x,p.y-z.center.y)<=z.radius:p.x>=z.minX&&p.x<=z.maxX&&p.y>=z.minY&&p.y<=z.maxY);
