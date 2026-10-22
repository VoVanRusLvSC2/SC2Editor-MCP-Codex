import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import process from 'node:process';

const source=/\.(?:c|cc|cpp|cxx|h|hpp|py|pyi|galaxy)$/i;
const digest=b=>createHash('sha256').update(b).digest('hex');
/** Distribution gate, not an obfuscator. Never copies the external private corpus. */
export async function checkDistributionPrivacy(root,{privateRoots=[]}={}){
 const privateHashes=new Set(),violations=[];let checkedFiles=0,privateSourceFiles=0;
 async function visit(directory,fn,relative='',privateCorpus=false){
  for(const e of await fs.readdir(directory,{withFileTypes:true})){
   const name=relative?relative+'/'+e.name:e.name,file=path.join(directory,e.name);
   if(e.isSymbolicLink()){await fn(file,name,'symlink');continue;}
   if(e.isDirectory()){
    if(privateCorpus&&['.git','node_modules','__pycache__','CMakeFiles'].includes(e.name))continue;
    await fn(file,name,'directory');await visit(file,fn,name,privateCorpus);
   }else if(e.isFile())await fn(file,name,'file');
  }
 }
 for(const privateRoot of privateRoots){
  const real=await fs.realpath(privateRoot),relative=path.relative(real,path.resolve(root));
  if(!relative||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep))throw Error('PRIVACY_OUTPUT_INSIDE_PRIVATE_ROOT');
  let bytes=0;
  await visit(real,async(file,name,kind)=>{
   if(kind!=='file'||!source.test(name))return;
   const size=(await fs.stat(file)).size;bytes+=size;
   if(++privateSourceFiles>25000||bytes>128*1024*1024)throw Error('PRIVATE_SOURCE_AUDIT_LIMIT');
   privateHashes.add(digest(await fs.readFile(file)));
  },'',true);
 }
 await visit(root,async(file,name,kind)=>{
  if(++checkedFiles>150000)throw Error('DISTRIBUTION_AUDIT_LIMIT');
  if(kind==='symlink'){violations.push({file:name,reason:'Distribution symlink'});return;}
  if(/(?:^|\/)(?:\.sc2mcp-[^/]*|\.(?:native|game)-toolkit-runtime|sc2[-_]game[-_]toolkit|SC2GameToolkit|local-tests|work)(?:\/|$)/i.test(name))violations.push({file:name,reason:'Private runtime, test or session directory'});
  if(kind!=='file')return;
  if(/\.(?:pdb|dmp|pyc|sc2map|sc2mod)$/i.test(name))violations.push({file:name,reason:'Debug data, bytecode or private test map'});
  if(/(?:^|\/)SC2Game(?:Bridge|Bootstrap|Host|Inject|Toolkit)[^/]*\.(?:dll|exe|zip|galaxy)$/i.test(name))violations.push({file:name,reason:'Private GameToolkit implementation or binary'});
  if(privateHashes.size&&source.test(name)&&privateHashes.has(digest(await fs.readFile(file))))violations.push({file:name,reason:'Exact external private source match'});
 });
 return {passed:!violations.length,checkedFiles,privateSourceFiles,privateCorpusCompared:privateRoots.length>0,violations,
  scope:'Explicit private paths/debug/test artifacts and exact external C++/Python/Galaxy source copies, including renamed files. Not proof against transformed snippets or binary reverse engineering.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(!process.argv[2])throw Error('Usage: node scripts/check-distribution-privacy.mjs <package directory>');
 const report=await checkDistributionPrivacy(path.resolve(process.argv[2]),{privateRoots:process.env.SC2_GAME_TOOLKIT_HOME?[process.env.SC2_GAME_TOOLKIT_HOME]:[]});
 process.stdout.write(JSON.stringify(report,null,2)+'\n');if(!report.passed)process.exitCode=1;
}
