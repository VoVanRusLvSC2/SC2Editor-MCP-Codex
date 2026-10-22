import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export interface GameRuntimeIdentity {provenance:'pinned_release'|'external_unpinned';releaseTag?:string;archiveSha256?:string;verifiedFiles?:number;binaryOverride:boolean}
/** Verify the full release manifest before starting Python. External development installs remain explicit. */
export async function verifyGameRuntime(home:string,binaries?:string,options:{requiredRelease?:string;pin?:{version:string;archiveSha256:string;manifestSha256:string}}={}):Promise<GameRuntimeIdentity>{
 const receiptFile=path.join(home,'sc2-game-runtime.json');
 let receiptBytes:Buffer;
 try{receiptBytes=await fs.readFile(receiptFile);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){if(options.requiredRelease)throw Error('GAME_PINNED_RUNTIME_RECEIPT_REQUIRED',{cause:e});return {provenance:'external_unpinned',binaryOverride:!!binaries};}throw e;}
 if(receiptBytes.length>65536)throw Error('GAME_RUNTIME_RECEIPT_INVALID');
 const receipt=JSON.parse(receiptBytes.toString('utf8'));
 const pin=options.pin??JSON.parse(await fs.readFile(new URL('../../../game-toolkit-release.json',import.meta.url),'utf8'));
 if(receipt.releaseTag!=='v'+pin.version||receipt.zipSha256!==pin.archiveSha256)throw Error('GAME_RUNTIME_RELEASE_MISMATCH');
 if(options.requiredRelease&&receipt.releaseTag!==options.requiredRelease)throw Error('GAME_RUNTIME_REQUIRED_RELEASE_MISMATCH');
 if(binaries&&await fs.realpath(binaries)!==await fs.realpath(path.join(home,'bin')))throw Error('GAME_PINNED_RUNTIME_BINARY_OVERRIDE');
 const bytes=await fs.readFile(path.join(home,'SHA256SUMS.json'));
 if(bytes.length>512*1024||sha(bytes)!==pin.manifestSha256)throw Error('GAME_RUNTIME_MANIFEST_CHANGED');
 const entries=Object.entries(JSON.parse(bytes.toString('utf8'))) as Array<[string,unknown]>;
 if(!entries.length||entries.length>1000)throw Error('GAME_RUNTIME_MANIFEST_INVALID');
 for(const [name,expected]of entries){
  if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(name)||name.includes(':'))throw Error('GAME_RUNTIME_MANIFEST_INVALID');
  const file=path.join(home,name),real=await fs.realpath(file),relative=path.relative(home,real);
  if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('GAME_RUNTIME_FILE_ESCAPE');
  const stat=await fs.stat(real);
  if(!stat.isFile()||stat.size>32*1024*1024||sha(await fs.readFile(real))!==expected)throw Error('GAME_RUNTIME_FILE_CHANGED: '+name);
 }
 const names=new Set(entries.map(([name])=>name));
 async function checkAdditions(directory:string,relative:string):Promise<void>{
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
   if(entry.name==='__pycache__'&&entry.isDirectory())continue;
   const name=relative+'/'+entry.name;
   if(entry.isSymbolicLink())throw Error('GAME_RUNTIME_SYMLINK: '+name);
   if(entry.isDirectory())await checkAdditions(path.join(directory,entry.name),name);
   else if(/\.(?:py|pyi|galaxy|exe|dll)$/i.test(name)&&!names.has(name))throw Error('GAME_RUNTIME_UNLISTED_CODE: '+name);
  }
 }
 for(const directory of ['app','bin','galaxy'])try{await checkAdditions(path.join(home,directory),directory);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 return {provenance:'pinned_release',releaseTag:receipt.releaseTag,archiveSha256:pin.archiveSha256,verifiedFiles:entries.length,binaryOverride:false};
}
