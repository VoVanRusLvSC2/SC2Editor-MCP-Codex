// Install the pinned optional native backend. Does not start SC2 or its Editor.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,URL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Buffer} from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import {nativeReleaseAssets,nativePublishedChecksum,nativeBuildMetadata} from './native-release-assets.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const pin=JSON.parse(await fs.readFile(path.join(root,'native-toolkit-release.json'),'utf8'));
if(!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(pin.version)||!Number.isSafeInteger(pin.nativeProtocol)||pin.nativeProtocol<1||!/^[a-f0-9]{64}$/.test(pin.archiveSha256))throw Error('NATIVE_RELEASE_PIN_INVALID');
const {repository,name,url,checksumUrl,allowBareChecksum}=nativeReleaseAssets(pin),version=pin.version;
const configured=process.env.SC2_NATIVE_TOOLKIT_HOME;
if(configured!==undefined&&(!configured.trim()||!path.isAbsolute(configured)))throw Error('NATIVE_RUNTIME_HOME_ABSOLUTE_REQUIRED');
const home=configured?path.resolve(configured):path.join(root,'.native-toolkit-runtime',version);
const sha=data=>createHash('sha256').update(data).digest('hex');
const get=async url=>{const r=await globalThis.fetch(url);if(!r.ok)throw Error(`NATIVE_DOWNLOAD_HTTP_${r.status}`);return Buffer.from(await r.arrayBuffer());};
let existing=false;try{await fs.access(home);existing=true;}catch(error){if(error.code!=='ENOENT')throw error;}
if(existing){
 const receipt=JSON.parse(await fs.readFile(path.join(home,'sc2-mcp-runtime.json'),'utf8'));
 if(receipt.version!==version||receipt.nativeProtocol!==pin.nativeProtocol||receipt.archiveSha256!==pin.archiveSha256)throw Error('NATIVE_EXISTING_RUNTIME_MISMATCH: choose a new version directory');
 const executable=path.resolve(home,receipt.executable),relative=path.relative(home,executable);
 if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('NATIVE_MANIFEST_PATH_INVALID');
 nativeBuildMetadata(pin,pin.buildMetadata==='embedded'?undefined:JSON.parse(await fs.readFile(path.join(home,'BUILD.json'),'utf8')));
 if(pin.buildMetadata==='embedded'&&receipt.buildMetadata!=='embedded')throw Error('NATIVE_EXISTING_RUNTIME_MISMATCH');
 if(sha(await fs.readFile(executable))!==receipt.executableSha256)throw Error('NATIVE_EXECUTABLE_HASH_MISMATCH');
 if(sha(await fs.readFile(path.join(home,name)))!==pin.archiveSha256)throw Error('NATIVE_CHECKSUM_MISMATCH');
 console.log(JSON.stringify({ready:true,alreadyInstalled:true,home,...receipt}));
}else{
const staging=home+'-staging-'+randomUUID();await fs.mkdir(staging,{recursive:true});
const expected=nativePublishedChecksum((await get(checksumUrl)).toString('utf8'),name,allowBareChecksum);
if(expected!==pin.archiveSha256)throw Error('NATIVE_PUBLISHED_CHECKSUM_CHANGED');
const bytes=await get(url);
if(sha(bytes)!==expected)throw Error('NATIVE_CHECKSUM_MISMATCH');
const archive=path.join(staging,name);await fs.writeFile(archive,bytes);
// Paths are arguments, never shell-interpolated. Extraction preserves all notices.
const entries=execFileSync('tar.exe',['-tf',archive],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);
if(!entries.length||entries.length>2000||entries.some(name=>name.includes('\\')||name.includes(':')||name.startsWith('/')||name.split('/').includes('..')))throw Error('NATIVE_ARCHIVE_PATH_INVALID');
execFileSync('tar.exe',['-xf',archive,'-C',staging],{stdio:'pipe',windowsHide:true});
const find=async dir=>{for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){const found=await find(p);if(found)return found;}else if(e.name==='SC2NativeMCP.exe')return p;}};
const executable=await find(staging);if(!executable)throw Error('NATIVE_EXECUTABLE_MISSING');
const build=nativeBuildMetadata(pin,pin.buildMetadata==='embedded'?undefined:JSON.parse(await fs.readFile(path.join(staging,'BUILD.json'),'utf8')));
const receipt={version,release:`https://github.com/${repository}/releases/tag/v${version}`,
  archiveSha256:expected,executable:path.relative(staging,executable),executableSha256:sha(await fs.readFile(executable)),
  nativeProtocol:build.nativeProtocol,sourceCommit:build.sourceCommit,buildMetadata:build.buildMetadata,diagnosticPreview:build.diagnosticPreview===true,editorStarted:false};
await fs.writeFile(path.join(staging,'sc2-mcp-runtime.json'),JSON.stringify(receipt,null,2)+'\n');
await fs.rename(staging,home);
console.log(JSON.stringify({ready:true,alreadyInstalled:false,home,...receipt}));
}
