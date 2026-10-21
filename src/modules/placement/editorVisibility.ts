import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {Workspace} from '../../core/workspace.js';

const run=promisify(execFile);
const key='HKCU\\Software\\Blizzard Entertainment\\StarCraft II Editor\\Preferences';
const value='TerrainLayersVisible';
export function parseEditorLayerMask(output:string){
 const match=/\bTerrainLayersVisible\s+REG_DWORD\s+(0x[0-9a-f]+)\b/i.exec(output);
 if(!match)throw new Error('EDITOR_LAYER_MASK_NOT_FOUND');
 const mask=Number.parseInt(match[1],16);
 if(!Number.isInteger(mask)||mask<0||mask>0xffffffff)throw new Error('EDITOR_LAYER_MASK_INVALID');
 return {mask,hex:'0x'+mask.toString(16).toUpperCase().padStart(8,'0'),disabledBits:Array.from({length:32},(_,i)=>i).filter(i=>(mask&2**i)===0)};
}
export async function editorVisibility(workspace:Workspace,enableAll:boolean,dryRun:boolean){
 if(process.platform!=='win32')return {supported:false,reason:'WINDOWS_REGISTRY_ONLY',changed:false};
 const read=async()=>parseEditorLayerMask((await run('reg.exe',['query',key,'/v',value],{windowsHide:true})).stdout);
 const before=await read(),change=enableAll&&before.mask!==0xffffffff;
 const result={supported:true,registry:key,value,before,requested:enableAll?'ENABLE_ALL':'INSPECT',dryRun,changed:false,editorRuntime:'NOT_OBSERVED',modelRendering:'NOT_VERIFIED',note:'Saved global preference only; bit-to-layer meanings are not established here. Disabled bits do not diagnose missing Units/Doodads: both layers were checked in the live arena Editor while models remained absent. Running instances can cache/overwrite this value. A successful write is not a rendering repair. No Editor is launched.'};
 if(!change||dryRun)return {...result,wouldChange:change};
 const backup=workspace.resolveUserPath('.sc2mcp/editor-visibility-'+Date.now()+'.json');
 await fs.mkdir(path.dirname(backup),{recursive:true});
 await fs.writeFile(backup,JSON.stringify({at:new Date().toISOString(),key,value,...before},null,2),{flag:'wx'});
 if((await read()).mask!==before.mask)throw new Error('EDITOR_LAYER_MASK_STALE');
 await run('reg.exe',['add',key,'/v',value,'/t','REG_DWORD','/d','0xffffffff','/f'],{windowsHide:true});
 const after=await read();if(after.mask!==0xffffffff)throw new Error('EDITOR_LAYER_MASK_WRITE_FAILED');
 return {...result,changed:true,after,backup};
}
