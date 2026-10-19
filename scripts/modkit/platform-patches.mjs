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
