import {Buffer} from 'node:buffer';
import * as z from 'zod/v4';
import {landscapeConfigSchema,landscapeZoneSchema,landscapeClosure,landscapeHash,type LandscapeState,type LandscapeZone} from './landscapeOwnership.js';
import {terrainLocationSchema} from './schemas.js';

// A partial schema must not insert a field's default into an omitted edit.
function editShape<T extends z.ZodRawShape>(shape:T){
 return Object.fromEntries(Object.entries(shape).map(([key,value])=>[key,z.optional(value instanceof z.ZodDefault?value.removeDefault():value)])) as {[K in keyof T]:z.ZodOptional<T[K]>};
}
const terrainEdit=z.object(editShape(terrainLocationSchema.shape)).strict();
const configEdit=z.object(editShape(landscapeConfigSchema.shape)).extend({terrain:terrainEdit.optional()}).strict();
const unsetFields=[
 'candidateIds','queries','objectCount','objectBudget','density','clusterCount','clusterRadius','clusterSeparation','scaleRange','rotationRange','exclusionZones','candidateOverrides','excludedObjects','dependency','outsidePlayableReason','bounds','landmarkCount','maxSlope',
 'terrain.baseHeight','terrain.relief','terrain.wavelength','terrain.edgeBlend','terrain.materials','terrain.protectedAreas','terrain.topology',
] as const;
export const landscapeZonePlanSchema=z.object({
 zone:landscapeZoneSchema.shape.id,
 expectedRequestHash:z.string().regex(/^[a-f0-9]{64}$/),
 changes:z.object({purpose:landscapeZoneSchema.shape.purpose.removeDefault().optional(),condition:landscapeZoneSchema.shape.condition.removeDefault().optional(),dependsOn:landscapeZoneSchema.shape.dependsOn.removeDefault().optional(),config:configEdit.optional()}).strict(),
 unset:z.array(z.enum(unsetFields)).max(unsetFields.length).default([]),
}).strict();
const configKeys=Object.keys(landscapeConfigSchema.shape) as (keyof typeof landscapeConfigSchema.shape)[];
const fieldNames=[...configKeys,...Object.keys(terrainLocationSchema.shape).map(k=>`terrain.${k}`)] as [string,...string[]];
export const landscapeInspectSchema=z.object({
 zone:landscapeZoneSchema.shape.id.optional(),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(8).default(8),
 field:z.enum(fieldNames).optional(),group:landscapeZoneSchema.shape.id.optional(),itemOffset:z.number().int().nonnegative().default(0),itemLimit:z.number().int().min(1).max(100).default(20),
}).strict().refine(v=>!v.field||!!v.zone,'A field requires a zone').refine(v=>!v.group||v.field==='groups','A group requires field=groups');

const definitionHash=(zone:LandscapeZone)=>landscapeHash({id:zone.id,dependsOn:zone.dependsOn,purpose:zone.purpose,condition:zone.condition,config:zone.config});

/** Merge only the two named schema boundaries. Objects and arrays are whole replacements. */
export function editLandscapeZone(state:LandscapeState,input:z.input<typeof landscapeZonePlanSchema>):LandscapeZone{
 const edit=landscapeZonePlanSchema.parse(input),old=state.zones.find(v=>v.id===edit.zone);
 if(!old)throw Error('LANDSCAPE_ZONE_NOT_FOUND: '+edit.zone);
 if(old.requestHash!==definitionHash(old))throw Error('LANDSCAPE_DEFINITION_HASH_MISMATCH: '+edit.zone+'; review the complete definition');
 if(old.requestHash!==edit.expectedRequestHash)throw Error('LANDSCAPE_REQUEST_STALE: '+edit.zone);
 const changes=edit.changes,config={...old.config,...changes.config,terrain:{...old.config.terrain,...changes.config?.terrain}};
 const configRecord=config as unknown as Record<string,unknown>,terrainRecord=config.terrain as unknown as Record<string,unknown>;
 for(const field of new Set(edit.unset)){
  const nested=field.startsWith('terrain.'),key=nested?field.slice(8):field,provided=nested?changes.config?.terrain:changes.config;
  if(provided&&Object.hasOwn(provided,key))throw Error('LANDSCAPE_EDIT_SET_UNSET_CONFLICT: '+field);
  delete (nested?terrainRecord:configRecord)[key];
 }
 return landscapeZoneSchema.parse({id:old.id,dependsOn:old.dependsOn,purpose:old.purpose,condition:old.condition,...changes,config});
}

/** No terrain/object preimages or ownership fingerprints are returned. */
export function inspectLandscapeState(state:LandscapeState|undefined,input:z.input<typeof landscapeInspectSchema>){
 const args=landscapeInspectSchema.parse(input),zones=state?.zones??[],selected=args.zone?zones.filter(z=>z.id===args.zone):zones;
 if(args.zone&&!selected.length)throw Error('LANDSCAPE_ZONE_NOT_FOUND: '+args.zone);
 const page=selected.slice(args.offset,args.offset+args.limit);
 const summaries=page.map(zone=>({id:zone.id,requestHash:zone.requestHash,definitionIntegrity:zone.requestHash===definitionHash(zone)?'matched':'mismatch',purpose:zone.purpose,condition:zone.condition,dependsOn:zone.dependsOn,generatorRevision:zone.generatorRevision,
  locationType:zone.config.locationType,style:zone.config.terrain.style,ownedObjects:zone.objects.length,configFields:Object.keys(zone.config),
  groups:zone.config.groups.map(g=>({id:g.id,anchor:g.anchor,angle:g.angle,maxSlope:g.maxSlope,members:g.members.length})),
  ...(args.zone?{rebuildClosure:[...landscapeClosure(zones,[zone.id])]}:{}),
 }));
 let field:Record<string,unknown>|undefined;
 if(args.field){
  const config=selected[0].config;let value:unknown=args.field.startsWith('terrain.')?(config.terrain as unknown as Record<string,unknown>)[args.field.slice(8)]:(config as unknown as Record<string,unknown>)[args.field];
  if(args.group){const group=config.groups.find(g=>g.id===args.group);if(!group)throw Error('LANDSCAPE_GROUP_NOT_FOUND: '+args.group);value=group.members;}
  const budget=32*1024;
  if(Array.isArray(value)){
   const items:unknown[]=[];let bytes=2,oversizeItemBytes:number|undefined;
   for(const item of value.slice(args.itemOffset,args.itemOffset+args.itemLimit)){const size=Buffer.byteLength(JSON.stringify(item))+(items.length?1:0);if(bytes+size>budget){if(!items.length)oversizeItemBytes=size;break;}items.push(item);bytes+=size;}
   field={name:args.field,...args.group?{group:args.group}:{},items,total:value.length,offset:args.itemOffset,returned:items.length,truncated:args.itemOffset+items.length<value.length,nextOffset:args.itemOffset+items.length<value.length&&items.length?args.itemOffset+items.length:null,...oversizeItemBytes?{oversizeItemBytes}:{}};
  }else{
   const bytes=value===undefined?0:Buffer.byteLength(JSON.stringify(value));field={name:args.field,present:value!==undefined,bytes,omitted:bytes>budget,...bytes<=budget&&value!==undefined?{value}:{}};
  }
 }
 const result={version:state?.version??null,totalZones:zones.length,total:selected.length,offset:args.offset,returned:page.length,truncated:args.offset+page.length<selected.length,zones:summaries,
  routeSource:state?.routeSource?{file:state.routeSource.file,sha256:state.routeSource.sha256,clearWidth:state.routeSource.clearWidth,corridors:state.routeSource.corridors.length,blockedRoutes:state.routeSource.blockedRouteIds.length}:null,
  padSource:state?.padSource?{file:state.padSource.file,sha256:state.padSource.sha256,pads:state.padSource.pads.length}:null,
  ...(field?{field}:{}),
 };
 if(Buffer.byteLength(JSON.stringify(result))>96*1024)throw Error('LANDSCAPE_INSPECT_RESULT_TOO_LARGE: reduce limit or select one field');
 return result;
}
