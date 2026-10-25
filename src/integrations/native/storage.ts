import {promises as fs} from 'node:fs';
import path from 'node:path';

const contains=(root:string,file:string)=>{const r=path.relative(root,file);return !r||!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep);};

/** A known SDK save expands into a component directory before producing MPQ. */
export function nativePathBudget(worker:string,platform:NodeJS.Platform=process.platform){
 const p=platform==='win32'?path.win32:path;
 const temporary=p.join(worker,'document-checks','a'.repeat(32),'NativeSaved-'+ 'a'.repeat(12)+'.SC2Map.temp');
 const directory=p.join(temporary,'enUS.SC2Data','LocalizedData');
 const file=p.join(directory,'TriggerStrings.txt');
 const status=platform!=='win32'?'not_applicable':file.length>=260||directory.length>=248?'failed':'passed';
 return {status,knownSavePathLength:file.length,knownSaveDirectoryLength:directory.length,fileLimitExclusive:260,directoryLimitExclusive:248,
  scope:'Known pinned SDK save layout; arbitrary archive member paths are not certified',
  ...(status==='failed'?{reason:'NATIVE_WORK_PATH_TOO_LONG: configure SC2_NATIVE_WORK_ROOT as a short private local directory'}:{})};
}

async function directoryChain(file:string){
 const absolute=path.resolve(file);let current=path.parse(absolute).root;
 for(const part of path.relative(current,absolute).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  const stat=await fs.lstat(current).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
  if(!stat)return;
  if(stat.isSymbolicLink())throw Error('NATIVE_WORK_ROOT_REPARSE_REFUSED');
  if(!stat.isDirectory())throw Error('NATIVE_WORK_ROOT_NOT_DIRECTORY');
 }
}

async function canonicalTarget(file:string){
 let existing=path.resolve(file);const missing:string[]=[];
 while(true){
  try{return path.join(await fs.realpath(existing),...missing);}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const parent=path.dirname(existing);if(parent===existing)throw e;missing.unshift(path.basename(existing));existing=parent;}
 }
}

/** Keeps private outputs separate from input-map authorization and pins one worker. */
export class NativeStorage {
 readonly work:string;
 readonly worker:string;
 private canonical?:string;
 constructor(private workspace:string,private home:string,workerId:string,readonly external?:string){
  this.work=external?path.resolve(external):path.join(workspace,'.sc2mcp-output','ne');
  this.worker=path.join(this.work,'w',workerId);
 }
 async prepare(){
  const budget=nativePathBudget(this.worker);if(budget.status==='failed')throw Error(budget.reason);
  if(this.external){
   if(!path.isAbsolute(this.external)||this.work===path.parse(this.work).root||this.external.startsWith('\\\\')||this.external.startsWith('//'))throw Error('NATIVE_WORK_ROOT_INVALID: use an absolute local directory, not a volume/share root');
   await directoryChain(this.work);
   const base=await canonicalTarget(this.work),workspace=await fs.realpath(this.workspace),home=await canonicalTarget(this.home);
   if(contains(workspace,base)||contains(base,workspace))throw Error('NATIVE_WORK_ROOT_WORKSPACE_OVERLAP');
   if(contains(home,base)||contains(base,home))throw Error('NATIVE_WORK_ROOT_RUNTIME_OVERLAP');
  }
  await directoryChain(this.work);
  const target=await canonicalTarget(this.work);
  if(this.canonical&&this.canonical!==target)throw Error('NATIVE_WORK_ROOT_CHANGED');
  await fs.mkdir(this.work,{recursive:true});
  await directoryChain(this.work);
  if(await fs.realpath(this.work)!==target)throw Error('NATIVE_WORK_ROOT_CHANGED');
  this.canonical=target;
 }
 async readWorkerArtifact(file:string,limit=512*1024*1024){
  return this.readArtifact(file,[this.worker],limit,'NATIVE_ARTIFACT_OUTSIDE_WORKER');
 }
 async readCaptureArtifact(file:string,jobDirectory:string,limit=6*1024*1024){
  return this.readArtifact(file,[this.worker,jobDirectory],limit,'NATIVE_ARTIFACT_OUTSIDE_OWNER');
 }
 private async readArtifact(file:string,roots:string[],limit:number,outsideError:string){
  await this.prepare();
  const real=await fs.realpath(file);let allowed:{requested:string;real:string}|undefined;
  for(const requested of roots){await directoryChain(requested);const root=await fs.realpath(requested).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});if(root&&root!==this.canonical&&contains(this.canonical!,root)&&contains(root,real)&&root!==real){allowed={requested,real:root};break;}}
  if(!allowed)throw Error(outsideError);
  await directoryChain(path.dirname(real));
  const handle=await fs.open(real,'r');
  try{
   const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)throw Error('NATIVE_ARTIFACT_SIZE_LIMIT');
   const bytes=await handle.readFile();if(bytes.length>limit)throw Error('NATIVE_ARTIFACT_SIZE_LIMIT');
   if(await fs.realpath(file)!==real||await fs.realpath(allowed.requested)!==allowed.real)throw Error('NATIVE_ARTIFACT_CHANGED');
   return bytes;
  }finally{await handle.close();}
 }
}
