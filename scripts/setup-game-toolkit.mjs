/* global process */
// Explicit authenticated installation of a pinned private release; never starts SC2.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyGameRuntime} from '../dist/integrations/game/runtime.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pin=JSON.parse(await fs.readFile(path.join(root,'game-toolkit-release.json'),'utf8'));
if(!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(pin.repository)||!/^\d+\.\d+\.\d+-dev\.\d+$/.test(pin.version)||!/^SC2GameToolkit-[A-Za-z0-9.-]+\.zip$/.test(pin.asset)||!/^[a-f0-9]{64}$/.test(pin.archiveSha256))throw Error('GAME_RELEASE_PIN_INVALID');
const base=path.join(root,'.game-toolkit-runtime'),version=path.join(base,pin.version),folder=pin.asset.slice(0,-4),home=path.join(version,folder);
const options={requiredRelease:'v'+pin.version};
let installed=false;try{await fs.access(home);installed=true;}catch(error){if(error.code!=='ENOENT')throw error;}
if(installed){
 const identity=await verifyGameRuntime(await fs.realpath(home),undefined,options);
 process.stdout.write(JSON.stringify({ready:true,alreadyInstalled:true,home,...identity})+'\n');
}else{
 const download=path.join(base,pin.version+'-download');await fs.mkdir(download,{recursive:true});
 const archive=path.join(download,pin.asset);
 try{await fs.access(archive);}catch(e){if(e.code!=='ENOENT')throw e;execFileSync('gh',['release','download','v'+pin.version,'--repo',pin.repository,'--pattern',pin.asset,'--dir',download],{stdio:['ignore','pipe','pipe'],windowsHide:true});}
 const bytes=await fs.readFile(archive);
 if(createHash('sha256').update(bytes).digest('hex')!==pin.archiveSha256)throw Error('GAME_RELEASE_ARCHIVE_CHANGED');
 const entries=execFileSync('tar.exe',['-tf',archive],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);
 if(entries.length>2000||entries.some(name=>name.includes('\\')||name.includes(':')||!name.startsWith(folder+'/')||name.split('/').some(part=>part==='..'||part==='.')))throw Error('GAME_RELEASE_ARCHIVE_PATH_INVALID');
 const staging=path.join(base,pin.version+'-staging-'+randomUUID());await fs.mkdir(staging,{recursive:true});
 execFileSync('tar.exe',['-xf',archive,'-C',staging],{stdio:'pipe',windowsHide:true});
 const extracted=path.join(staging,folder);
 await fs.writeFile(path.join(extracted,'sc2-game-runtime.json'),JSON.stringify({releaseTag:'v'+pin.version,repository:pin.repository,zipSha256:pin.archiveSha256,verifiedAt:new Date().toISOString(),sourceBundledInMcp:false},null,2)+'\n');
 await verifyGameRuntime(await fs.realpath(extracted),undefined,options);
 for(const candidate of [extracted,home]){const relative=path.relative(base,path.resolve(candidate));if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('GAME_INSTALL_PATH_ESCAPE');}
 await fs.mkdir(version,{recursive:true});await fs.rename(extracted,home);
 process.stdout.write(JSON.stringify({ready:true,alreadyInstalled:false,home,...await verifyGameRuntime(await fs.realpath(home),undefined,options)})+'\n');
}
