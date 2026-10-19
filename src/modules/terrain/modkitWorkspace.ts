import path from 'node:path';
import {promises as fs} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import type {ModkitIntegration} from '../../integrations/modkit/runtime.js';
import {bytesHash} from '../../core/binaryTransactions.js';
import {modkitTerrainPlanSchema,type ModkitTerrainPlan} from './modkitSchemas.js';
import {componentListWithGameData,gameDataIndexWithCatalog} from '../data/workspace.js';
import {scanXml} from '../../core/xmlScanner.js';

export const MODKIT_TERRAIN_COMPONENTS=['t3Terrain.xml','t3HeightMap','t3SyncHeightMap','t3SyncCliffLevel','t3CellFlags','t3TextureMasks','t3SyncTextureInfo','t3Water','t3FluffDoodad','t3VertCol','t3HardTile','t3SyncPathingInfo','PaintedPathingLayer','PaintedCreepLayer','CellAttribute_Pnp','CellAttribute_Pnb','CellAttribute_Pcl','CellAttribute_Pgr','Terrain'] as const;
const guards=['MapInfo','Objects','ComponentList.SC2Components','Base.SC2Data/GameData/TerrainData.xml','Base.SC2Data/GameData/TerrainTexData.xml','Base.SC2Data/GameData.xml'];
const outputComponents=[...MODKIT_TERRAIN_COMPONENTS,...guards.filter(f=>f!=='MapInfo'&&f!=='Objects')];
interface HeldPlan {directory:string;next:Map<string,Buffer>;source:Record<string,string>;disk:Record<string,string>;summary:Record<string,any>;applied?:boolean}
/** Add missing native format owners; retain existing coherent terrain brushes and transaction coordinator. */
export class ModkitTerrainWorkspace {
  private plans=new Map<string,HeldPlan>();
  constructor(readonly integration:ModkitIntegration){}
  get workspace(){return this.integration.workspace;}
  private key(directory:string,name:string){return this.workspace.binary.key(path.join(directory,name));}
  private async load(directory:string,templates:Record<string,string>={}){
    const files=new Map<string,Uint8Array>(),source:Record<string,string>={},disk:Record<string,string>={};let total=0;
    for(const name of [...MODKIT_TERRAIN_COMPONENTS,...guards]){
      const key=this.key(directory,name),raw=await this.workspace.binary.read(key),saved=await this.workspace.binary.read(key,false);
      total+=raw.bytes.length;if(total>192*1024*1024)throw Error('MODKIT_TERRAIN_TOTAL_BYTE_LIMIT');
      source[key]=bytesHash(raw.bytes);disk[key]=bytesHash(saved.bytes);
      if(raw.bytes.length)files.set(name,raw.bytes);
    }
    for(const[name,file]of Object.entries(templates)){
      if(!MODKIT_TERRAIN_COMPONENTS.includes(name as typeof MODKIT_TERRAIN_COMPONENTS[number]))throw Error('MODKIT_TERRAIN_TEMPLATE_COMPONENT_REFUSED');
      if(files.has(name))throw Error('MODKIT_TERRAIN_TEMPLATE_TARGET_EXISTS');
      const raw=await this.workspace.binary.read(file),saved=await this.workspace.binary.read(file,false);
      if(!raw.bytes.length)throw Error('MODKIT_TERRAIN_TEMPLATE_MISSING');
      source[raw.file]=bytesHash(raw.bytes);disk[raw.file]=bytesHash(saved.bytes);
      files.set(name,raw.bytes);
    }
    return {files,source,disk};
  }
  async capabilities(directory=''){
    const loaded=await this.load(directory);
    return {backend:'ModKit',available:(await this.integration.provenance()).available,directory,
      components:MODKIT_TERRAIN_COMPONENTS.map(name=>({name,exists:loaded.files.has(name),bytes:loaded.files.get(name)?.length??0})),
      added:['CellAttribute no-path/no-building/clear-path paint and flood fill','raw PaintedPathing/PaintedCreep channels','vertex-color stroke values','fluff doodad add/update/remove','native HRDT group replacement/duplicate-key repair','PATH hint values','static terrain navigation and route preview','native palette and block texture-set authoring','native ramp template transfer and qualified diagonal widening'],
      retained:['terrain height/texture/water/cliff/ramp writers','placement.scatterDoodads/snapToTerrain','shared guarded transactions'],
      engineValidated:false,limitations:['Existing decoded components required; optional CellAttribute templates copy a native header and initialize empty target cells','Native pathing caches/paint are distinct from effective engine navigation','Original low-level formats do not promise every Editor brush, arbitrary RGBA or inferred road splines']};
  }
  async inspect(request:{directory:string;component:string;offset:number;limit:number;blockIndex?:number}){
    if(!MODKIT_TERRAIN_COMPONENTS.includes(request.component as typeof MODKIT_TERRAIN_COMPONENTS[number]))throw Error('MODKIT_TERRAIN_COMPONENT_REFUSED');
    return this.integration.exclusive(async()=>{
      const loaded=await this.load(request.directory),backend=await this.integration.port();
      const result=await backend.terrain('inspect',loaded.files,request);
      if(Buffer.byteLength(JSON.stringify(result))>48000)throw Error('MODKIT_TERRAIN_OUTPUT_LIMIT: reduce limit');
      return {backend:'ModKit',...result};
    });
  }
  async fit(request:{donorDirectory:string;rampIndex:number;bounds:{minX:number;minY:number;maxX:number;maxY:number};crossings:{x:number;y:number}[];uphill:{x:number;y:number}}){
    return this.integration.exclusive(async()=>{const data=await this.load(request.donorDirectory);return {backend:'ModKit',...await (await this.integration.port()).terrain('fit',data.files,request)};});
  }
  async plan(input:ModkitTerrainPlan){
    const request=modkitTerrainPlanSchema.parse(input);
    if(Buffer.byteLength(JSON.stringify(request))>1024*1024)throw Error('MODKIT_TERRAIN_REQUEST_BYTE_LIMIT');
    return this.integration.exclusive(async()=>{
      const loaded=await this.load(request.directory,request.templates),backend=await this.integration.port();
      const donors=[...new Set(request.operations.filter(o=>o.op==='ramp.template').map(o=>o.donorDirectory))];if(donors.length>4)throw Error('MODKIT_TERRAIN_DONOR_LIMIT');
      for(const directory of donors){const donor=await this.load(directory);Object.assign(loaded.source,donor.source);Object.assign(loaded.disk,donor.disk);for(const[name,bytes]of donor.files)loaded.files.set('@donor:'+directory+':'+name,bytes);}
      if([...loaded.files.values()].reduce((n,b)=>n+b.length,0)>256*1024*1024)throw Error('MODKIT_TERRAIN_TOTAL_BYTE_LIMIT');
      const result=await backend.terrain('plan',loaded.files,{operations:request.operations,templateComponents:Object.keys(request.templates)}),next=new Map<string,Buffer>();
      if(request.operations.some(o=>o.op==='palette.author')){
        let index=Buffer.from(loaded.files.get('Base.SC2Data/GameData.xml')??[]).toString('utf8');
        index=gameDataIndexWithCatalog(index,'GameData/TerrainData.xml');index=gameDataIndexWithCatalog(index,'GameData/TerrainTexData.xml');
        result.next.set('Base.SC2Data/GameData.xml',Buffer.from(index));
        result.next.set('ComponentList.SC2Components',Buffer.from(componentListWithGameData(Buffer.from(loaded.files.get('ComponentList.SC2Components')??[]).toString('utf8'))));
      }
      for(const[name,bytes]of result.next as Map<string,Uint8Array>){
        if(!outputComponents.includes(name))continue;
        const key=this.key(request.directory,name),value=Buffer.from(bytes);
        if(/\.(xml|SC2Components)$/i.test(name)&&scanXml(value.toString('utf8')).diagnostics.some(d=>d.severity==='error'))throw Error('MODKIT_TERRAIN_XML_INVALID: '+name);
        if(bytesHash(value)!==loaded.source[key])next.set(key,value);
      }
      const id='modkit_terrain_'+randomUUID(),summary={planId:id,backend:'ModKit',directory:request.directory,valid:true,
        files:[...next].map(([file,bytes])=>({file,bytes:bytes.length,beforeSha256:loaded.source[file],afterSha256:bytesHash(bytes)})),operations:result.reports,warnings:result.warnings,engineValidated:false};
      this.plans.set(id,{directory:request.directory,next,source:loaded.source,disk:loaded.disk,summary});
      while(this.plans.size>16)this.plans.delete(this.plans.keys().next().value!);
      return summary;
    });
  }
  private async checked(id:string){
    const p=this.plans.get(id);if(!p)throw Error('MODKIT_TERRAIN_PLAN_NOT_FOUND');
    for(const[file,hash]of Object.entries(p.source))if(bytesHash((await this.workspace.binary.read(file)).bytes)!==(p.applied&&p.next.has(file)?bytesHash(p.next.get(file)!):hash))throw Error('STALE_MODKIT_TERRAIN_PLAN: '+file);
    for(const[file,hash]of Object.entries(p.disk)){const actual=bytesHash((await this.workspace.binary.read(file,false)).bytes);if(actual!==hash&&!(p.applied&&p.next.has(file)&&actual===bytesHash(p.next.get(file)!)))throw Error('STALE_MODKIT_TERRAIN_DISK: '+file);}
    return p;
  }
  async apply(id:string,dryRun=true){
    const p=await this.checked(id);
    if(p.applied)return {accepted:true,alreadyApplied:true,planId:id};
    if(!p.next.size)return {accepted:true,dryRun,changed:false,planId:id};
    const transaction=await this.workspace.binary.apply([...p.next.keys()],()=>new Map(p.next),{dryRun,stage:true,expectedSha256:p.disk,verify:async()=>{
      for(const[file,hash]of Object.entries(p.source))if(!p.next.has(file)&&bytesHash((await this.workspace.binary.read(file)).bytes)!==hash)throw Error('STALE_MODKIT_TERRAIN_DEPENDENCY: '+file);
    }});
    if(!dryRun)p.applied=true;
    return {...transaction,planId:id,saveWith:'modkit.save(file); complete transaction group is saved together'};
  }
  async navigation(request:{directory:string;planId?:string;route?:{from:{x:number;y:number};to:{x:number;y:number}};profile:string;maxSize:number;catalog?:boolean}){
    return this.integration.exclusive(async()=>{
      const loaded=await this.load(request.directory),mapRoot=this.workspace.resolveUserPath(request.directory);
      const relative=(file:string)=>path.relative(mapRoot,this.workspace.resolveUserPath(file)).replaceAll('\\','/');
      const catalogDraft=(file:string)=>{const rel=relative(file);return !rel.startsWith('../')&&!path.isAbsolute(rel)&&!(MODKIT_TERRAIN_COMPONENTS as readonly string[]).includes(rel);};
      if(request.catalog!==false&&this.workspace.binary.draftFiles().some(catalogDraft))throw Error('MODKIT_NAVIGATION_CATALOG_DRAFT: save changed Objects/Data/dependencies or use catalog=false');
      if(request.planId){const p=await this.checked(request.planId);if(p.directory!==request.directory)throw Error('MODKIT_TERRAIN_PLAN_DIRECTORY_MISMATCH');if(request.catalog!==false&&[...p.next.keys()].some(catalogDraft))throw Error('MODKIT_NAVIGATION_CATALOG_PLAN: save changed catalog files or use catalog=false');for(const[file,bytes]of p.next)loaded.files.set(relative(file),bytes);}
      const snapshot=request.catalog===false?{}:await this.integration.snapshot(request.directory);
      const result=await (await this.integration.port()).terrain('navigation',loaded.files,{...request,...snapshot});
      const hash=createHash('sha256').update(JSON.stringify([...loaded.files].map(([name,bytes])=>[name,bytesHash(bytes)]))+JSON.stringify(request)+JSON.stringify(snapshot)).digest('hex').slice(0,24);
      const file=this.workspace.resolveUserPath(path.join('.sc2mcp-output','terrain-navigation',hash+'.png'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,result.png);
      return {...result.summary,backend:'ModKit',pngFile:file};
    });
  }
}
