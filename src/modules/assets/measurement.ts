import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import * as z from 'zod/v4';
import type {Workspace} from '../../core/workspace.js';
import {safeCascPath,type CascWorkspace} from '../casc/workspace.js';
import {readM3Geometry} from './m3.js';
import {readM3Metadata} from '../cutscene/assets.js';
import {attachmentMeasurements} from './attachmentMeasurements.js';

import {transformPoint,type Transform} from './transform.js';
export {transformPoint,type Transform,type Vec3} from './transform.js';
export type Geometry=ReturnType<typeof readM3Geometry>;
export const vector=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
export const measurementSchema=z.object({file:z.string().min(1).max(1024),scale:z.union([z.number().positive().max(1000),vector]).default(1),rotation:z.number().finite().default(0),position:vector.default([0,0,0]),preview:z.boolean().default(true),includeImage:z.boolean().default(true)}).strict();
const round=(n:number)=>Math.round(n*1e6)/1e6;
export function measureGeometry(g:Pick<Geometry,'positions'|'indices'>,t:Transform={}){
 if(!g.indices.length||g.positions.length%3)throw new Error('MEASURE_EMPTY_GEOMETRY');
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const i of new Set(g.indices)){if(i<0||!Number.isInteger(i)||i*3+2>=g.positions.length)throw new Error('MEASURE_VERTEX_INDEX');const v=transformPoint(g.positions.slice(i*3,i*3+3),t);if(v.some(n=>!Number.isFinite(n)))throw new Error('MEASURE_NONFINITE');for(let c=0;c<3;c++){min[c]=Math.min(min[c],v[c]);max[c]=Math.max(max[c],v[c]);}}
 const dimensions=max.map((v,i)=>round(v-min[i])),center=min.map((v,i)=>round((v+max[i])/2));
 return {bounds:{min:min.map(round),max:max.map(round)},dimensions:{width:dimensions[0],depth:dimensions[1],height:dimensions[2]},center,pivot:(t.position??[0,0,0]).map(round),bottom:round(min[2]),groundOffset:round((t.position?.[2]??0)-min[2]),boundingRadius:round(Math.hypot(...dimensions)/2),coordinateSystem:'right-handed XYZ, Z up; rotation in radians',units:'M3 model units multiplied by the supplied scale',scope:'Referenced triangles in first mesh division, raw rest geometry; no animation envelope, material visibility or collision footprint'};
}
export type Measurement=ReturnType<typeof measureGeometry>;
export interface MeasuredModel {file:string;sha256:string;build:string;geometry:Geometry;transform:Transform;measurement:Measurement;attachmentNames:string[];attachments?:ReturnType<typeof attachmentMeasurements>;cacheHit:boolean}
export class ModelMeasurements {
 private cache=new Map<string,Geometry>();private bytes=0;
 constructor(readonly workspace:Workspace,readonly casc:CascWorkspace){}
 async load(file:string,transform:Transform={}):Promise<MeasuredModel>{
  file=safeCascPath(file);if(!file.endsWith('.m3'))throw new Error('MEASURE_M3_REQUIRED');
  const read=await this.casc.read(file),key=read.metadata.sha256,hit=this.cache.get(key);let geometry=hit;
  if(!geometry){geometry=readM3Geometry(read.bytes);const size=(geometry.positions.length+geometry.indices.length)*8;if(size<=64*1024*1024){while(this.cache.size&&(this.bytes+size>64*1024*1024||this.cache.size>=24)){const first=this.cache.keys().next().value!,old=this.cache.get(first)!;this.bytes-=(old.positions.length+old.indices.length)*8;this.cache.delete(first);}this.cache.set(key,geometry);this.bytes+=size;}}
  const measurement=measureGeometry(geometry,transform),metadata=readM3Metadata(read.bytes);
  return {file,sha256:key,build:read.metadata.buildKey,geometry,transform,measurement,attachmentNames:metadata.valid?metadata.attachmentPoints:[],attachments:attachmentMeasurements(read.bytes,transform),cacheHit:!!hit};
 }
 async passport(file:string,transform:Transform={}){const model=await this.load(file,transform);return this.summary(model);}
 summary(model:MeasuredModel){return {file:model.file,sha256:model.sha256,build:model.build,...model.measurement,transform:model.transform,vertices:model.geometry.vertexCount,triangles:model.geometry.triangleCount,attachmentNames:model.attachmentNames,attachmentPositions:model.attachments,footprint:{status:'not_measured',note:'Visual geometry is separate from navigation/building footprints'},cacheHit:model.cacheHit};}
 async writeDerived(key:unknown,extension:'png'|'html'|'json',make:()=>Promise<Buffer|string>){const id=createHash('sha256').update('decor-measure-v3:'+JSON.stringify(key)).digest('hex'),file=this.workspace.resolveUserPath('.sc2mcp-assets-preview/decor/'+id+'.'+extension);try{await fs.access(file);return {file,cacheHit:true};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}const value=await make();await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value);return {file,cacheHit:false};}
}
