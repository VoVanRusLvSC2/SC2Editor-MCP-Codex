// Narrow compatibility fix for pinned ModKit Host (MIT). No model parser is replaced.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// A large UVM puts its profile marker beyond the probe. The UVM codec must also see
// the synthetic artifact's extension; otherwise ordinary glTF wins and drops rig/material facets.
export function patchUvmArtifactUri(text){
  const before='uri: `memory+uvm:${encodeURIComponent(source.ref.uri)}`',
    after='uri: `memory+uvm:${encodeURIComponent(source.ref.uri)}.uvm`';
  if(text.includes(after)&&!text.includes(before))return text;
  if(text.split(before).length!==2)throw Error('MODKIT_HOST_UVM_PATCH_CONTEXT_MISMATCH');
  return text.replace(before,after);
}
// Native TerrainRamp records use directions0..7, including south=0. The pinned
// reader preserves this enum; its two writer guards incorrectly use 1..8.
export function patchRampDirectionEnum(text){
  for(const subject of ['ramp','template.ramp']){
    const before=`${subject}.dir < 1 || ${subject}.dir > 8`,after=`${subject}.dir < 0 || ${subject}.dir > 7`;
    const oldCount=text.split(before).length-1,newCount=text.split(after).length-1;
    if(oldCount===0&&newCount===1)continue;
    if(oldCount!==1||newCount!==0)throw Error('MODKIT_RAMP_ENUM_PATCH_CONTEXT_MISMATCH');
    text=text.replace(before,after);
  }
  return text;
}
export async function patchHostArtifacts(runtimeRoot){
  const records=[];
  for(const entry of ['node','maps']){
    const relative=`node_modules/@modkit/host/dist/${entry}/index.js`,file=path.join(runtimeRoot,relative);
    const original=await readFile(file,'utf8'),patched=patchUvmArtifactUri(original);
    if(patched!==original)await writeFile(file,patched);
    records.push({file:relative,sha256:createHash('sha256').update(patched).digest('hex')});
  }
  return records;
}
