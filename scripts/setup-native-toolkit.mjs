// Install the pinned optional native backend. Does not start SC2 or its Editor.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,URL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Buffer} from 'node:buffer';
import console from 'node:console';
const root=fileURLToPath(new URL('../',import.meta.url));
const pin=JSON.parse(await fs.readFile(path.join(root,'native-toolkit-release.json'),'utf8'));
if(!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(pin.version)||!Number.isSafeInteger(pin.nativeProtocol)||pin.nativeProtocol<1||!/^[a-f0-9]{64}$/.test(pin.archiveSha256))throw Error('NATIVE_RELEASE_PIN_INVALID');
const repository=pin.repository??'VoVanRusLvSC2/SC2NativeToolkit',prefix=pin.assetPrefix??'SC2NativeToolkit';
if(!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository)||!/^SC2(?:Editor|Native)Toolkit$/.test(prefix))throw Error('NATIVE_RELEASE_LOCATION_INVALID');
const version=pin.version,name=`${prefix}-v${version}-win-x64.zip`;
const url=`https://github.com/${repository}/releases/download/v${version}/${name}`;
const home=path.join(root,'.native-toolkit-runtime',version);
const sha=data=>createHash('sha256').update(data).digest('hex');
const get=async url=>{const r=await globalThis.fetch(url);if(!r.ok)throw Error(`NATIVE_DOWNLOAD_HTTP_${r.status}`);return Buffer.from(await r.arrayBuffer());};
await fs.mkdir(home,{recursive:true});
const expected=(await get(url+'.sha256')).toString('utf8').match(/\b[a-f0-9]{64}\b/i)?.[0].toLowerCase();
if(!expected)throw Error('NATIVE_CHECKSUM_MISSING');
if(expected!==pin.archiveSha256)throw Error('NATIVE_PUBLISHED_CHECKSUM_CHANGED');
const bytes=await get(url);
if(sha(bytes)!==expected)throw Error('NATIVE_CHECKSUM_MISMATCH');
const archive=path.join(home,name);await fs.writeFile(archive,bytes);
// Paths are arguments, never shell-interpolated. Extraction preserves all notices.
execFileSync('tar.exe',['-xf',archive,'-C',home],{stdio:'pipe',windowsHide:true});
const find=async dir=>{for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){const found=await find(p);if(found)return found;}else if(e.name==='SC2NativeMCP.exe')return p;}};
const executable=await find(home);if(!executable)throw Error('NATIVE_EXECUTABLE_MISSING');
const build=JSON.parse(await fs.readFile(path.join(home,'BUILD.json'),'utf8'));
if(build.version!==version||build.nativeProtocol!==pin.nativeProtocol)throw Error('NATIVE_PACKAGE_PROTOCOL_MISMATCH');
const receipt={version,release:`https://github.com/${repository}/releases/tag/v${version}`,
  archiveSha256:expected,executable:path.relative(home,executable),executableSha256:sha(await fs.readFile(executable)),
  nativeProtocol:build.nativeProtocol,sourceCommit:build.sourceCommit,diagnosticPreview:build.diagnosticPreview===true,editorStarted:false};
await fs.writeFile(path.join(home,'sc2-mcp-runtime.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({ready:true,home,...receipt}));
