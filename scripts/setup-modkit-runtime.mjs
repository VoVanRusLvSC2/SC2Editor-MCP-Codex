// Reproducible optional runtime. Does not run SC2, its editor, or any Galaxy converter.
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL,URL} from 'node:url';
import {existsSync,promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import {patchHostArtifacts} from './modkit/platform-patches.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
const home=path.join(project,'.modkit-runtime'),blizzard=path.join(home,'ModKit-Blizzard'),core=path.join(home,'ModKit');
const pins={blizzard:'78104889bed092d901516044bd90734df8d5caac',core:'72253b49adff4f572c4763cd1ca5c980264afe41'};
if(Number(process.versions.node.split('.')[0])<22)throw Error('ModKit requires Node.js 22+');
const run=(cmd,args,cwd)=>execFileSync(cmd,args,{cwd,stdio:'inherit',windowsHide:true});
async function clone(name,rev,destination,sparse){
  if(!existsSync(path.join(destination,'.git'))){
    const args=['clone','--filter=blob:none','--no-checkout','https://github.com/hometlt/'+name,destination];run('git',args,project);
    if(sparse)run('git',['sparse-checkout','set','--no-cone',...sparse],destination);
    run('git',['checkout','--detach',rev],destination);
  }
  const actual=execFileSync('git',['rev-parse','HEAD'],{cwd:destination,encoding:'utf8'}).trim();
  if(actual!==rev)throw Error('MODKIT_PIN_MISMATCH: '+destination);
}
function pnpm(args,cwd){
  // npm run supplies npm_execpath; execute npx's JS entry, avoiding shell quoting of paths.
  const npm=process.env.npm_execpath;
  if(!npm)throw Error('Run this installer with npm run modkit:setup');
  const npx=path.join(path.dirname(npm),'npx-cli.js');
  run(process.execPath,[npx,'--yes','pnpm@10.12.1',...args],cwd);
}
await fs.mkdir(home,{recursive:true});
await clone('ModKit-Blizzard',pins.blizzard,blizzard);
await clone('ModKit',pins.core,core,['/extensions/images/','/extensions/models/','/LICENSE*','/licenses/']);
const patch=path.join(project,'scripts','modkit','compatibility.patch');
const applied=()=>{try{execFileSync('git',['apply','--reverse','--check',patch],{cwd:blizzard,stdio:'pipe'});return true;}catch{return false;}};
if(!applied()){run('git',['apply','--check',patch],blizzard);run('git',['apply',patch],blizzard);}
if(!process.argv.includes('--finalize-only')){
  // Initial install uses the upstream lock; subsequent runs retain the already verified tree.
  if(!existsSync(path.join(blizzard,'node_modules','@modkit','sdk','package.json')))
    pnpm(['install','--frozen-lockfile','--ignore-scripts'],blizzard);
  if(!existsSync(path.join(blizzard,'node_modules','@modkit','uv','package.json')))
    pnpm(['add','-Dw','@modkit/uv@file:./vendor/modkit-uv-1.0.0.tgz','--ignore-scripts'],blizzard);
  for(const name of ['build:mpq','build:casc','build:models'])pnpm(['run',name],blizzard);
  for(const config of ['tsconfig.sc2-data.json','tsconfig.sc2-map.json','tsconfig.sc2-mod.json','tsconfig.battlenet.json','tsconfig.json'])
    pnpm(['exec','tsc','-p','starcraft2/'+config],blizzard);
  pnpm(['--dir','starcraft2','exec','vite','build','--config','vite.sc2-map-portable.config.mjs'],blizzard);
}
for(const name of ['images','models'])await fs.cp(path.join(core,'extensions',name),path.join(blizzard,'.modkit-core-extensions',name),{
  recursive:true,filter:p=>!p.split(path.sep).some(s=>['node_modules','test','tests'].includes(s))});
const hostPatches=await patchHostArtifacts(blizzard);
const require=createRequire(path.join(blizzard,'package.json'));
const {build}=await import(pathToFileURL(require.resolve('esbuild')).href);
await build({entryPoints:[path.join(project,'scripts/modkit/world-viewer.mjs')],outfile:path.join(blizzard,'sc2-mcp-world-viewer.js'),
  bundle:true,format:'iife',globalName:'ModkitMapViewer',platform:'browser',target:'es2022',minify:true,
  banner:{js:'/*! ModKit world renderer, Copyright (c) 2026 Modkit contributors. MIT. '+(await fs.readFile(path.join(project,'vendor/modkit-scene/LICENSE-MIT.txt'),'utf8')).replaceAll('*/','* /')+' */'},
  nodePaths:[path.join(blizzard,'node_modules')],legalComments:'eof'});
const vendor=[];
for(const file of (await fs.readdir(path.join(blizzard,'vendor'))).filter(n=>n.endsWith('.tgz')).sort()){
  vendor.push({file,sha256:createHash('sha256').update(await fs.readFile(path.join(blizzard,'vendor',file))).digest('hex')});
}
const receipt={schemaVersion:1,pins,vendor,hostPatches,terrainApiExports:['@modkit/blizzard-starcraft2/map/format','@modkit/blizzard-starcraft2/map/navigation','@modkit/blizzard-starcraft2/map/overview'],compatibilityPatchSha256:createHash('sha256').update(await fs.readFile(patch)).digest('hex'),
  limitations:['Optional semantic RLE lattice overview disabled: public Core lacks its API',
    'Older public VFS hidden-path API uses recursive listing'],editorUsed:false,gameWrites:false};
await fs.writeFile(path.join(blizzard,'sc2-mcp-runtime.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({ready:true,runtimeRoot:blizzard,pins}));
