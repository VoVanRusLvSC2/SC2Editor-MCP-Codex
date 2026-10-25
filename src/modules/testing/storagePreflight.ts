import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {TestManifest,TestCheck} from './schemas.js';

export interface StorageObservation {volume:string;directory:string;availableBytes:number}
export type StorageProbe=(directory:string)=>Promise<StorageObservation>;
const MiB=1024*1024;
const reserve=256*MiB;
const scope='Free-space budget for private archive copies, bounded capture allowances and reports plus a 256 MiB reserve per volume. Not a universal prediction of native Editor/Game disk use.';

/** Inspect an existing ancestor without creating output directories or clients. */
export const probeStorage:StorageProbe=async directory=>{
 let ancestor=path.resolve(directory);
 while(true){
  try{if(!(await fs.stat(ancestor)).isDirectory())throw Error('TEST_STORAGE_PARENT_NOT_DIRECTORY');break;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const parent=path.dirname(ancestor);if(parent===ancestor)throw error;ancestor=parent;}
 }
 const real=await fs.realpath(ancestor),stat=await fs.stat(real,{bigint:true}),space=await fs.statfs(real,{bigint:true});
 if(space.bsize<=0n||space.bavail<0n)throw Error('TEST_STORAGE_INVALID_FILESYSTEM_COUNTS');
 const free=space.bsize*space.bavail;
 return {volume:stat.dev.toString(),directory:real,availableBytes:Number(free>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):free)};
};

export async function testStorageChecks(input:{directory:string;gameDirectory?:string;sourceBytes:number;manifest:TestManifest},probe:StorageProbe=probeStorage):Promise<TestCheck[]>{
 if(!Number.isSafeInteger(input.sourceBytes)||input.sourceBytes<0)throw Error('TEST_STORAGE_INVALID_SOURCE_SIZE');
 const game=input.manifest.game;
 const captures=game?game.views.length+(game.capture?1+game.routes.reduce((sum,r)=>sum+(r.bidirectional?2:1),0):0)+game.formations.reduce((sum,f)=>sum+(f.viewId?(f.bidirectional?2:1):0),0)+(game.launchDiagnostics?1:0)+game.scenarios.reduce((sum,s)=>sum+s.steps.filter(s=>s.method==='game.capture').length,0):0;
 const targets=[{role:'suite',directory:input.directory,budget:64*MiB+input.sourceBytes*((input.manifest.editor?.gameArtifact==='native_saved'?6:2)+(game&&(game.pads.length||game.pathing.length)?6:0))+captures*8*MiB},
  ...(game?[{role:'game',directory:input.gameDirectory??path.join(input.directory,'../native-game'),budget:input.sourceBytes*2+captures*6*MiB}]:[])];
 const volumes=new Map<string,{directories:string[];roles:string[];available:number;budget:number}>(),failures:TestCheck[]=[];
 for(const target of targets){
  try{
   const observation=await probe(target.directory);
   if(!observation.volume||!Number.isSafeInteger(observation.availableBytes)||observation.availableBytes<0)throw Error('TEST_STORAGE_INVALID_OBSERVATION');
   const old=volumes.get(observation.volume)??{directories:[],roles:[],available:observation.availableBytes,budget:0};
   old.directories.push(target.directory);old.roles.push(target.role);old.available=Math.min(old.available,observation.availableBytes);old.budget+=target.budget;volumes.set(observation.volume,old);
  }catch(error){failures.push({id:'storage:'+target.role,status:'inconclusive',required:true,reason:('TEST_STORAGE_INSPECTION_UNAVAILABLE: '+String(error)).replace(/\p{Cc}/gu,' ').slice(0,640),evidence:{directory:target.directory,scope}});}
 }
 const measuredAt=new Date().toISOString();
 return [...volumes.values()].map((v,index):TestCheck=>{
  const minimumFreeBytes=reserve+v.budget,passed=v.available>=minimumFreeBytes;
  return {id:'storage:'+index,status:passed?'passed':'failed',required:true,reason:passed?undefined:`TEST_STORAGE_INSUFFICIENT: ${v.available} bytes available; ${minimumFreeBytes} bytes required by the planned free-space budget`,evidence:{measuredAt,directories:v.directories,roles:v.roles,availableBytes:v.available,minimumFreeBytes,reserveBytes:reserve,plannedCaptureSlots:captures,scope}};
 }).concat(failures);
}
