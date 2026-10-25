import {promises as fs} from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {projectPath} from '../../app/paths.js';
import * as z from 'zod/v4';

export const catalogQuerySchema=z.object({tileset:z.string().max(128).optional(),profile:z.string().max(64).optional(),section:z.enum(['decor','vegetation','terrain_object_actors','terrain_objects','auto_vegetation','locations']).default('decor'),query:z.string().max(128).default(''),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(40).default(12)}).strict();
export interface CatalogRow {id:string;name?:string;catalog?:string;roles?:string[];placement?:string;[key:string]:unknown}
/** Positive source naming/category hints only; deadwood is not structural damage. */
export function structuralDamageHint(row:CatalogRow){return /wreck|destroyed|ruins?|broken|damaged|burnt|burned/i.test([row.id,row.name,...row.roles??[]].join(' '));}
interface Pack {id:string;name:string;texture_ids:string[];sample_maps:number;sections:Record<string,CatalogRow[]>}
export interface Profile {id:string;name:string;geometry:string[];surface:string[];decor:string[];vegetation:string[];avoid:string[]}
/** Reference data is read lazily, cached with a bounded LRU, and never executed. */
export class StyleCatalog {
 private cache=new Map<string,{value:unknown;bytes:number}>();
 constructor(readonly root=projectPath('resources/authoring-catalog')){}
 async read<T>(file:string):Promise<T>{
  if(!/^[A-Za-z0-9_./-]+\.json$/.test(file)||file.split('/').includes('..'))throw new Error('CATALOG_PATH_INVALID');
  const hit=this.cache.get(file);if(hit){this.cache.delete(file);this.cache.set(file,hit);return hit.value as T;}
  let raw:Buffer;try{raw=await fs.readFile(path.join(this.root,file));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;raw=gunzipSync(await fs.readFile(path.join(this.root,file+'.gz')),{maxOutputLength:32*1024*1024});}
  if(raw.length>32*1024*1024)throw new Error('CATALOG_FILE_LIMIT');
  const value=JSON.parse(raw.toString('utf8')) as T;
  if(raw.length<=8*1024*1024){this.cache.set(file,{value,bytes:raw.length});while(this.cache.size>16||[...this.cache.values()].reduce((n,e)=>n+e.bytes,0)>16*1024*1024)this.cache.delete(this.cache.keys().next().value!);}
  return value;
 }
 async profile(id?:string){
  const rules=await this.read<{profiles:Profile[];common_rules:string[]}>('style_rules/profiles.json');
  if(!id)return {profiles:rules.profiles.map(p=>({id:p.id,name:p.name})),commonRules:rules.common_rules};
  const profile=rules.profiles.find(p=>p.id===id);if(!profile)throw new Error('STYLE_PROFILE_UNKNOWN: '+id);
  return {profile,commonRules:rules.common_rules,transitions:await this.read('style_rules/transitions.json'),states:await this.read('style_rules/states.json'),compositions:await this.read('style_rules/compositions.json'),quality:await this.read('style_rules/quality_checks.json'),evidence:'AUTHORED_GUIDANCE_NOT_ENGINE_VALIDATED'};
 }
 async pack(id:string):Promise<Pack>{
  const index=await this.read<{packs:Array<{id:string}>}>('mcp_view/index.json');if(!index.packs.some(p=>p.id===id))throw new Error('CATALOG_TILESET_UNKNOWN: '+id);
  const [summary,full]=await Promise.all([this.read<Pack>('mcp_view/packs/'+id+'.json'),this.read<Pick<Pack,'sections'>>('mcp_view/full/'+id+'.json')]);return {...summary,sections:full.sections};
 }
 async query(input:z.input<typeof catalogQuerySchema>){
  const args=catalogQuerySchema.parse(input),needle=args.query.toLowerCase();
  if(args.profile&&!args.tileset)return this.profile(args.profile);
  if(!args.tileset){const index=await this.read<{packs:Array<{id:string;name:string}>}>('mcp_view/index.json');const all=index.packs.filter(p=>(p.id+' '+p.name).toLowerCase().includes(needle));return {offset:args.offset,total:all.length,items:all.slice(args.offset,args.offset+args.limit),nextOffset:args.offset+args.limit<all.length?args.offset+args.limit:null};}
  const pack=await this.pack(args.tileset);
  const rows=args.section==='locations'?(await this.read<{examples:Array<{environment:string;hint:string;candidates:CatalogRow[]}>}>('locations/shortlist.json')).examples.filter(e=>e.environment===args.tileset).flatMap(e=>e.candidates.map(c=>({...c,locationHint:e.hint}))):pack.sections[args.section]??[];
  const all=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(needle));
  const overrides=await this.read<{items:CatalogRow[]}>('style_rules/asset_overrides.json');
  return {offset:args.offset,tileset:args.tileset,textures:pack.texture_ids,sampleMaps:pack.sample_maps,section:args.section,total:all.length,items:all.slice(args.offset,args.offset+args.limit).map(r=>({...r,override:overrides.items.find(o=>o.id===r.id)})),nextOffset:args.offset+args.limit<all.length?args.offset+args.limit:null,style:args.profile?await this.profile(args.profile):undefined,evidence:'REFERENCE_CANDIDATES_VERIFY_TARGET_DEPENDENCIES',countsAreQuotas:false};
 }
}
