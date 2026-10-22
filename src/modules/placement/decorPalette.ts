import * as z from 'zod/v4';
import path from 'node:path';
import type {BrowseWorkspace} from '../browse/workspace.js';
import type {BrowseEntry} from '../browse/types.js';
import type {DataField} from '../data/types.js';
import {PlacementDocument} from './document.js';
import {StyleCatalog} from './styleCatalog.js';
import {ModelMeasurements,type MeasuredModel,type Vec3} from '../assets/measurement.js';
import {modelSheetPng,type View,type ModelCard} from '../assets/measurementRender.js';

export const decorMeasureSchema=z.object({id:z.string().min(1).optional(),key:z.string().min(1).optional(),representation:z.enum(['Doodad','Actor']).default('Doodad'),objectId:z.number().int().nonnegative().optional(),variation:z.number().int().min(0).max(9999).optional(),scale:z.number().positive().max(10).default(1),rotation:z.number().finite().default(0),preview:z.boolean().default(true),includeImage:z.boolean().default(true)}).strict();
export const decorPaletteSchema=z.object({tileset:z.string().min(1),section:z.enum(['decor','vegetation']).default('decor'),query:z.string().max(128).default(''),ids:z.array(z.string().min(1)).min(1).max(12).optional(),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(12).default(6),view:z.enum(['top','side','isometric']).default('isometric'),pixelsPerUnit:z.number().positive().max(512).optional(),reference:z.boolean().default(true),includeImage:z.boolean().default(true)}).strict();
type Field={path:string;value?:string;link?:string;attrs:Record<string,string>};
function flat(fields:DataField[]):Field[]{return fields.flatMap(f=>[f,...flat(f.children)]);}
function fields(e:BrowseEntry){return {...Object.fromEntries(flat(e.definition.fields).map(f=>[f.path,f])),...e.effective?.fields};}
function value(e:BrowseEntry,name:string){return Object.values(fields(e)).filter(f=>f.path===name||f.path.endsWith('/'+name)).map(f=>f.value??f.link??f.attrs.value).filter((v):v is string=>!!v).at(-1);}
export function catalogScale(raw:string|undefined):Vec3{if(!raw)return [1,1,1];const n=raw.trim().split(/[,\s]+/).map(Number);if(n.length===1)n.push(n[0],n[0]);if(n.length!==3||n.some(v=>!Number.isFinite(v)||v<=0||v>1000))throw new Error('DECOR_SCALE_UNSUPPORTED: '+raw);return n as Vec3;}
const normalized=(s:string)=>s.replaceAll('\\','/').toLowerCase();
export interface DecorModel {actor:BrowseEntry;model:BrowseEntry;measured:MeasuredModel;scales:{model:Vec3;actor:Vec3;placement:Vec3;extra:number;combined:Vec3};warnings:string[];variants:string[];variation:number|undefined;footprint:string[]}

/** An image/measurement view of StyleCatalog, not a separate asset catalogue. */
export class DecorPalette {
 constructor(readonly browse:BrowseWorkspace,readonly measurements:ModelMeasurements,readonly catalog=new StyleCatalog()){}
 private async entry(id:string,catalogType:string,dependency?:string){
  const found=await this.browse.get(id.startsWith(catalogType+':')?{key:id}:{id,catalogType});
  let entries=found.definitions.filter(e=>e.catalogType===catalogType&&['MAP_LOCAL','AVAILABLE_THROUGH_DEPENDENCY'].includes(e.availability)&&e.engineActive!==false);
  if(entries.length>1&&dependency){const same=entries.filter(e=>e.dependency===dependency);if(same.length===1)entries=same;}
  // Explicit keys always bind an exact catalogue namespace, never a similarly named Model/Unit.
  if(entries.length!==1)throw new Error('DECOR_SELECTOR_NOT_UNIQUE_OR_AVAILABLE: '+id+'; candidates='+entries.map(e=>e.key).join(','));
  return entries[0];
 }
 private async modelPaths(file:string,model:BrowseEntry){
  let name=file.replaceAll('##id##',model.id);
  for(const [id,value] of Object.entries(model.definition.tokens??{}))name=name.replaceAll('##'+id+'##',value);
  for(const f of Object.values(fields(model))){const id=f.attrs.id??f.attrs.index;if(id&&f.value)name=name.replaceAll('##'+id+'##',f.value);}
  name=normalized(name);const basename=path.posix.basename(name),stem=basename.split(/[#*]/)[0].replace(/\.m3$/,'');
  if(!stem)throw new Error('DECOR_MODEL_TOKEN_UNRESOLVED: '+file);
  const query=(path.posix.dirname(name)+'/'+stem).replace(/##[^#]+##/g,'');
  const candidates:string[]=[];let offset=0;
  for(let page=0;page<10;page++){const result=await this.measurements.casc.search('',query.length<=128?query:stem,offset,100);candidates.push(...result.items.map(i=>i.path).filter(p=>p.endsWith('.m3')));if(result.nextOffset===null||result.nextOffset===undefined)break;offset=result.nextOffset;if(page===9)throw new Error('DECOR_ASSET_SEARCH_TRUNCATED');}
  let matches=candidates.filter(p=>normalized(p).endsWith('/'+name)||normalized(p)===name);
  if(!matches.length){const escaped=name.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/##[^#]+##|\*/g,'[^/]+'),pattern=new RegExp('(?:^|/)'+escaped+'$','i');matches=candidates.filter(p=>pattern.test(normalized(p)));}
  if(!matches.length&&Number(value(model,'VariationCount'))>0){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\\\.m3$/,'_[0-9]+\\.m3'),pattern=new RegExp('(?:^|/)'+escaped+'$','i');matches=candidates.filter(p=>pattern.test(normalized(p)));}
  if(!matches.length)throw new Error('DECOR_MODEL_ASSET_NOT_FOUND: '+file);
  const same=matches.filter(p=>normalized(p).startsWith(normalized(model.dependency)+'/')||normalized(p).includes('/'+normalized(model.dependency)+'/'));
  if(same.length)matches=same;
  // The same logical asset in multiple packages needs an explicit model/package binding.
  const suffixes=new Set(matches.map(p=>normalized(p).split('/base.sc2assets/').at(-1)));
  if(matches.length>suffixes.size)throw new Error('DECOR_ASSET_PACKAGE_AMBIGUOUS: '+matches.join(','));
  return [...new Set(matches)].sort();
 }
 async resolve(input:z.input<typeof decorMeasureSchema>):Promise<DecorModel>{
  const a=decorMeasureSchema.parse(input);let selector=a.key??a.id,placement:Vec3=[1,1,1],rotation=a.rotation,variation=a.variation;
  if(a.objectId!==undefined){const raw=await this.measurements.workspace.readRaw('Objects'),o=new PlacementDocument(raw.text).list().find(o=>o.id===a.objectId);if(!o||o.kind!=='ObjectDoodad'||!o.catalogId)throw new Error('DECOR_PLACED_DOODAD_NOT_FOUND');if(selector&&selector!==o.catalogId)throw new Error('DECOR_OBJECT_SELECTOR_CONFLICT');selector=o.catalogId;placement=catalogScale(o.scale);rotation+=Number(o.rotation??0);variation??=o.variation===undefined?undefined:Number(o.variation);}
  if(!selector)throw new Error('DECOR_ID_KEY_OR_OBJECT_REQUIRED');
  const actor=await this.entry(selector,'Actor');if(a.representation==='Doodad'&&actor.placeableRepresentation?.kind!=='Doodad')throw new Error('DECOR_NOT_PLACEABLE_DOODAD: '+actor.id);
  const modelId=value(actor,'Model')??actor.id,model=await this.entry(modelId,'Model',actor.dependency),file=value(model,'File')??value(model,'Model')??model.assetPaths.find(p=>/\.m3$/i.test(p));
  if(!file||!/\.m3$/i.test(file))throw new Error('DECOR_MODEL_FILE_UNRESOLVED: '+modelId+'; mount catalog metadata for Core.SC2Mod and the declared dependencies with casc.mount');
  const min=catalogScale(value(model,'ScaleMin')),max=catalogScale(value(model,'ScaleMax')??value(model,'ScaleMin'));
  if(min.some((v,i)=>v!==max[i]))throw new Error('DECOR_RANDOM_MODEL_SCALE_REQUIRES_EXPLICIT_FIXED_MODEL: '+modelId);
  const actorScale=catalogScale(value(actor,'Scale')),combined=min.map((v,i)=>v*actorScale[i]*placement[i]*a.scale) as Vec3,variants=await this.modelPaths(file,model);
  if(variants.length>1&&variation===undefined)throw new Error('DECOR_VARIATION_REQUIRED: '+actor.id+'; variants='+variants.length);
  const chosen=variation??0,selected=variants.find(file=>{const n=file.match(/_(\d+)\.m3$/i);return n&&Number(n[1])===chosen;})??(variants.length===1&&chosen===0?variants[0]:undefined);if(!selected)throw new Error('DECOR_VARIATION_OUT_OF_RANGE: '+variants.length);
  const measured=await this.measurements.load(selected,{scale:combined,rotation}),warnings=['Rest geometry only; actor events, animated scale, visibility, deformation and engine default/layer merges are not simulated.'];
  if(!value(model,'ScaleMin')||!value(actor,'Scale'))warnings.push('Undeclared Model/Actor scale uses identity; this is an explicit assumption.');
  if(variants.length>1)warnings.push('Variation selects the numeric _NN.m3 suffix. Its engine fallback behavior still requires SC2 review.');
  const footprint=Object.values(fields(actor)).filter(f=>/footprint/i.test(f.path)).map(f=>f.value??f.link??'').filter(Boolean);
  return {actor,model,measured,scales:{model:min,actor:actorScale,placement,extra:a.scale,combined},warnings,variants,variation,footprint};
 }
 summary(d:DecorModel){const b=d.measured.measurement.bounds,z=d.measured.measurement.pivot[2];return {id:d.actor.id,key:d.actor.key,model:d.model.id,modelKey:d.model.key,...this.measurements.summary(d.measured),scales:d.scales,variants:d.variants,variation:d.variation,footprint:{links:d.footprint,status:'not_evaluated',note:'Geometry AABB is not an engine pathing/building footprint.'},connectors:{attachmentNames:d.measured.attachmentNames,authoredAttachments:d.measured.attachments,candidates:[{name:'minX',position:[b.min[0],0,z]},{name:'maxX',position:[b.max[0],0,z]},{name:'minY',position:[0,b.min[1],z]},{name:'maxY',position:[0,b.max[1],z]}],evidence:'AABB extrema; candidates only, not authored connection sockets'},warnings:d.warnings};}
 async image(cards:ModelCard[],view:View,pixelsPerUnit?:number,reference?:MeasuredModel){
  const key={cards:cards.map(c=>({id:c.id,sha:c.model.sha256,transform:c.model.transform,reserved:c.reserved})),view,pixelsPerUnit,reference:reference?{sha:reference.sha256,transform:reference.transform}:null};
  const render=()=>modelSheetPng(cards,{view,pixelsPerUnit,reference});const output=await this.measurements.writeDerived(key,'png',async()=>(await render()).bytes);
  return {pngFile:output.file,cacheHit:output.cacheHit,view,scale:'shared model units across every card',geometryOnly:true};
 }
 async measure(input:z.input<typeof decorMeasureSchema>){return this.browse.withSnapshot(async()=>{const a=decorMeasureSchema.parse(input),d=await this.resolve(a),images=[];if(a.preview)for(const view of ['top','side','isometric'] as const)images.push(await this.image([{id:d.actor.id,model:d.measured}],view));return {...this.summary(d),representation:a.representation,placeableAsDoodad:d.actor.placeableRepresentation?.kind==='Doodad',images,pngFile:images.at(-1)?.pngFile};});}
 async palette(input:z.input<typeof decorPaletteSchema>){return this.browse.withSnapshot(async()=>{
  const a=decorPaletteSchema.parse(input),page=await this.catalog.query({tileset:a.tileset,section:a.section,query:a.query,offset:a.offset,limit:a.limit});if(!('items' in page))throw new Error('DECOR_PALETTE_PAGE_REQUIRED');const rows=a.ids?.map(id=>({id}))??page.items??[],items=[],cards=[];
  for(const row of rows){try{const d=await this.resolve({id:row.id,variation:0});items.push({reference:row,...this.summary(d)});cards.push({id:d.actor.id,model:d.measured});}catch(e){items.push({id:row.id,status:'unavailable',error:e instanceof Error?e.message:String(e)});}}
  let reference:MeasuredModel|undefined,referenceError:string|undefined;if(a.reference){try{const candidates=await this.measurements.casc.search('','marine.m3',0,100),file=candidates.items.find(i=>/\/units\/terran\/marine\/marine\.m3$/i.test(i.path))?.path;if(file)reference=await this.measurements.load(file);else referenceError='Marine reference not found';}catch(e){referenceError=String(e);}}
  const image=cards.length?await this.image(cards,a.view,a.pixelsPerUnit,reference):undefined;
  return {tileset:a.tileset,section:a.section,total:a.ids?.length??page.total,offset:a.ids?0:a.offset,nextOffset:a.ids?null:page.nextOffset,items,...image,reference:reference?{file:reference.file,dimensions:reference.measurement.dimensions,scale:'raw M3 1; reference only'}:undefined,referenceError,checks:{geometry:'measured_for_successful_items',engineVisual:'not_checked'},note:'The existing StyleCatalog is the source; unavailable target actors remain visible as diagnostics. Variation 0 is shown explicitly.'};
 });}
}
