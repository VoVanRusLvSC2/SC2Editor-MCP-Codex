import * as z from 'zod/v4';
import {createHash} from 'node:crypto';
import {Workspace} from '../../core/workspace.js';
import type {BrowseWorkspace} from '../browse/workspace.js';
import type {TerrainWorkspace} from '../terrain/workspace.js';
import type {PlacementWorkspace} from './workspace.js';
import {PlacementDocument,componentListWithObjects} from './document.js';
import {scatterDoodadsSchema} from './decorationSchemas.js';
import {StyleCatalog} from './styleCatalog.js';
import type {PlacementPlan} from './types.js';
import {measuredMemberSchema,measuredObjects} from './measuredGroups.js';

export const stylePlanSchema=z.object({tileset:z.string().min(1).max(128),profile:z.string().min(1).max(64),query:z.string().max(128).default(''),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(40).default(16)}).strict();
const point=z.object({x:z.number().finite(),y:z.number().finite()}).strict();
export const compositionSchema=z.object({zone:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),tileset:z.string().min(1).max(128),profile:z.string().default('forest'),recipe:z.enum(['forest_edge','natural_cluster','base_entrance','service_yard','ruined_structure','measured_group']).default('forest_edge'),prefabRecipe:z.enum(['base_entrance','service_yard','landing_pad','forest_edge']).optional(),condition:z.enum(['operational','abandoned','damaged','destroyed','absent']).default('operational'),area:scatterDoodadsSchema.shape.area.optional(),anchor:point.optional(),angle:z.number().finite().default(0),members:z.array(measuredMemberSchema).max(500).default([]),objects:z.array(z.string().min(1)).max(32).optional(),count:z.number().int().min(1).max(1500).default(60),clusterCount:z.number().int().min(0).max(32).default(4),clusterRadius:z.number().positive().optional(),seed:z.number().int().default(42),minimumDistance:z.number().positive().default(1.5),maxSlope:z.number().nonnegative().default(0.5),exclusionZones:scatterDoodadsSchema.shape.exclusionZones.default([]),directory:z.string().default(''),dryRun:z.boolean().default(true),stage:z.boolean().default(true)}).strict();
type Owned={id:number;fingerprint:string};
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const fingerprint=(doc:PlacementDocument,id:number)=>{const o=doc.list().find(o=>o.id===id);return o?hash(JSON.stringify({...o,nodeId:undefined})):null;};
const rolePatterns:Record<string,RegExp>={forest:/nature\/(trees|ground_plants|rocks)|deadwood|shrubs/,natural:/nature\//,terran_fortified:/terran|military|light|utility|storage|perimeter/,terran_field_camp:/terran|military|storage/,terran_abandoned:/terran|storage|perimeter/,protoss_installation:/protoss/,zerg_hive:/zerg/,ruins:/ruin|debris|wreck/,road_checkpoint:/perimeter|light|road|military/,farmland:/agriculture/};

export class CompositionWorkspace {
 constructor(readonly workspace:Workspace,readonly placement:PlacementWorkspace,readonly browse:BrowseWorkspace,readonly terrain:TerrainWorkspace,readonly catalog=new StyleCatalog()){}
 async style(input:z.input<typeof stylePlanSchema>){
  const a=stylePlanSchema.parse(input),style=await this.catalog.profile(a.profile),pack=await this.catalog.pack(a.tileset),pattern=rolePatterns[a.profile];if(!pattern)throw new Error('STYLE_PROFILE_REQUIRES_EXPLICIT_SELECTION');
  const rows=[...pack.sections.vegetation??[],...pack.sections.decor??[]].filter(r=>pattern.test((r.roles??[]).join(' ')+' '+r.id+' '+r.name)&&(!a.query||JSON.stringify(r).toLowerCase().includes(a.query.toLowerCase())));
  const shortlist=rows.slice(a.offset,a.offset+a.limit),ids=[...new Set(shortlist.map(r=>r.id))],verified=ids.length?await this.browse.search({catalogType:'Actor',ids,limit:Math.max(1,ids.length)}):{results:[]};
  return {offset:a.offset,tileset:a.tileset,profile:a.profile,textures:pack.texture_ids,style,total:rows.length,items:shortlist.map(r=>({...r,target:verified.results.filter(v=>v.id===r.id).map(v=>({key:v.key,availability:v.availability,placeable:v.placeable,dependency:v.dependency})),selection:'CANDIDATE_REVIEW'})),nextOffset:rows.length>a.offset+shortlist.length?a.offset+shortlist.length:null,nativeFoliage:{bindings:pack.sections.auto_vegetation?.length??0,automaticGeneration:false},checks:{composition:'not_checked',pathing:'not_checked',engine:'not_checked'}};
 }
 async compose(input:z.input<typeof compositionSchema>){return this.workspace.withReadSet(()=>this.browse.withSnapshot(async()=>{
  const a=compositionSchema.parse(input),file='.sc2mcp/compositions/'+a.zone+'.json',old=await this.workspace.readRaw(file),raw=await this.workspace.readRaw('Objects'),document=raw.text?new PlacementDocument(raw.text):PlacementDocument.create();
  const previous=old.text?JSON.parse(old.text) as {version:number;objects:Owned[]}:null;if(previous&&previous.version!==1)throw new Error('COMPOSITION_STATE_VERSION');
  const owned=previous?.objects??[];
  for(const o of owned)if(fingerprint(document,o.id)!==o.fingerprint)throw new Error('COMPOSITION_OWNED_OBJECT_CHANGED: '+o.id);
  await this.catalog.profile(a.profile);await this.catalog.pack(a.tileset);
  if(a.recipe==='ruined_structure'&&!['destroyed','damaged'].includes(a.condition))throw new Error('COMPOSITION_RUIN_REQUIRES_DAMAGE_STATE');
  if(a.condition==='absent')throw new Error('COMPOSITION_ABSENT_HAS_NO_OBJECTS');
  let plan:PlacementPlan;
  if(a.recipe==='forest_edge'||a.recipe==='natural_cluster'){
   if(!a.area)throw new Error('COMPOSITION_AREA_REQUIRED');
   const selectors:Array<{key:string;weight:number}>=[];
   if(a.objects){for(const id of a.objects){const resolved=await this.browse.resolve({id,catalogType:'Actor'});if(!resolved.resolved||!resolved.object||!resolved.dependencyReady||resolved.placeableRepresentation?.kind!=='Doodad')throw new Error('COMPOSITION_ACTOR_NOT_AVAILABLE: '+id);selectors.push({key:resolved.object.key,weight:1});}}
   else{const candidates=await this.style({tileset:a.tileset,profile:a.profile,limit:32});selectors.push(...candidates.items.filter(r=>r.target.length===1&&r.target[0].placeable&&['MAP_LOCAL','AVAILABLE_THROUGH_DEPENDENCY'].includes(r.target[0].availability)&&r.placement!=='line').map(r=>({key:r.target[0].key,weight:1})).slice(0,16));}
   if(!selectors.length)throw new Error('COMPOSITION_NO_VERIFIED_ACTORS: mount catalog metadata for the map dependencies with casc.mount, then inspect terrain.style');
   const scatter=await this.placement.scatterDoodads({area:a.area,objects:selectors,replaceObjectIds:owned.map(o=>o.id),count:a.count,seed:a.seed,clusterCount:a.clusterCount,clusterRadius:a.clusterRadius,minimumDistance:a.minimumDistance,maxSlope:a.maxSlope,exclusionZones:a.exclusionZones,terrainDirectory:a.directory});plan=scatter.plan;
  }else{
   if(!a.anchor||!a.members.length)throw new Error('COMPOSITION_ANCHOR_AND_MEASURED_MEMBERS_REQUIRED');
   const surface=await this.terrain.surface(a.directory);if(!surface.waterCoverageKnown)throw new Error('TERRAIN_WATER_COVERAGE_UNAVAILABLE');
   const objects=measuredObjects({anchor:a.anchor,angle:a.angle,maxSlope:a.maxSlope,members:a.members},surface,(geometry,m)=>{
    const {x,y}=geometry.position;for(const zone of a.exclusionZones){if(zone.type==='circle'?Math.hypot(x-zone.center.x,y-zone.center.y)<zone.radius:x>=zone.minX&&x<=zone.maxX&&y>=zone.minY&&y<=zone.maxY)throw new Error('COMPOSITION_MEMBER_IN_RESERVED_PATH: '+m.id);}
   });
   plan=await this.placement.addBatch({objects});plan.operations.unshift(...owned.map(o=>({op:'remove' as const,objectId:o.id})));Object.assign(plan.sourceSha256,surface.sourceSha256);Object.assign(plan.diskSha256,surface.diskSha256);
  }
  for(const source of Object.keys(plan.sourceSha256))await this.workspace.readBinaryDependency(this.workspace.resolveUserPath(source),true);
  const transaction=await this.workspace.applyRawTransaction(this.workspace.coupledDraftFiles(['Objects','ComponentList.SC2Components',file]),async values=>{
   if(hash(values.get(file)??'')!==hash(old.text))throw new Error('COMPOSITION_STATE_STALE');
   for(const [source,sha]of Object.entries(plan.sourceSha256))if(hash(values.get(source)??(await this.workspace.binary.read(source)).bytes)!==sha)throw new Error('COMPOSITION_SOURCE_STALE: '+source);
   const doc=values.get('Objects')?new PlacementDocument(values.get('Objects')!):PlacementDocument.create();const applied=doc.apply(plan.operations),ids=applied.filter(v=>v.op==='add').map(v=>v.objectId);
   if(doc.validate().some(i=>i.severity==='error'))throw new Error('COMPOSITION_XML_INVALID');
   const state={version:1,zone:a.zone,tileset:a.tileset,profile:a.profile,recipe:a.recipe,condition:a.condition,seed:a.seed,anchor:a.anchor,parameters:{...a,dryRun:undefined,stage:undefined},objects:ids.map(id=>({id,fingerprint:fingerprint(doc,id)}))};
   return new Map([...values,['Objects',doc.source],['ComponentList.SC2Components',componentListWithObjects(values.get('ComponentList.SC2Components')??'')],[file,JSON.stringify(state,null,2)+'\n']]);
  },{dryRun:a.dryRun,stage:a.stage,backup:true,expectedSha256:plan.diskSha256,summary:'Reconcile owned terrain composition '+a.zone});
  return {zone:a.zone,profile:a.profile,recipe:a.recipe,objects:plan.operations.filter(o=>o.op==='add').length,replaced:owned.length,seed:a.seed,transaction,saveFile:file,checks:{xml:'pass',height:'pass',visual:'not_checked',enginePathing:'not_checked'},note:'Recipe owns only recorded object IDs. Manual edits to owned objects block replacement. Terrain textures and native foliage require their respective tools.'};
 }));}
}
