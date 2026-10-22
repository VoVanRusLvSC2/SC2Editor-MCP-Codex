import path from 'node:path';
import {promises as fs} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import type {Workspace} from '../../core/workspace.js';
import type {NativeGuiEvidence} from '../../integrations/native/guiEvidence.js';
import {extractArchive} from '../../archive/archiveAdapter.js';

const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const mutable=(file:string)=>/^(Triggers|MapScript\.galaxy)$/i.test(file)||/\.SC2Data\/LocalizedData\/TriggerStrings\.txt$/i.test(file);
const extraContext=(file:string)=>!file.split('/').some(part=>part.includes('.sc2uimcp.'))&&(/^(MapInfo|DocumentInfo|ComponentList\.SC2Components|Objects)$/i.test(file)||/\.galaxy$|\.(SC2Lib|triggerlib)$/i.test(file)||/^[^/]+\.SC2Data\//i.test(file)||/^TriggerLibs\//i.test(file));
/** Bind native compilation to the actual unpacked target, not a caller's assertion. */
export async function bindNativeGuiContext(workspace:Workspace,proof:NativeGuiEvidence){
 if(workspace.draftFiles().length||workspace.binary.draftFiles().length)throw Error('GUI_NATIVE_PENDING_DRAFTS: save complete source groups before native adoption');
 const template=await workspace.readBinaryDependency(proof.template.absolute),runtime=await workspace.readBinaryDependency(proof.output.absolute);
 if(hash(template)!==proof.template.sha256||hash(runtime)!==proof.output.sha256)throw Error('GUI_NATIVE_PROOF_STALE');
 if(!(await workspace.readBinaryDependency(workspace.resolveUserPath('MapInfo'),true)).length)throw Error('GUI_NATIVE_TARGET_MAP_REQUIRED');
 const directory=workspace.resolveUserPath(path.join('.sc2mcp-output','gui-native-context',randomUUID(),'Components'));
 const extracted=await extractArchive(proof.template.absolute,directory),expected=new Map(Object.entries(extracted.verification.contentSha256).filter(([file])=>!mutable(file)).map(([file,sha])=>[file.toLowerCase(),{file,sha}]));
 let bytes=0;
 for(const {file,sha}of expected.values()){
  const value=await workspace.readBinaryDependency(workspace.resolveUserPath(file));bytes+=value.length;
  if(bytes>256*1024*1024)throw Error('GUI_NATIVE_CONTEXT_BYTE_LIMIT');
  if(hash(value)!==sha)throw Error('GUI_NATIVE_TEMPLATE_CONTEXT_MISMATCH: '+file);
 }
 let files=0;
 const walk=async(relative='')=>{
  const folder=workspace.resolveUserPath(relative),accept=(e:import('node:fs').Dirent)=>e.isSymbolicLink()||!['.git','.sc2mcp','.sc2mcp-output'].includes(e.name)&&(!e.name.startsWith('.sc2mcp-')||e.name==='.sc2mcp-locales')&&(e.isDirectory()||extraContext(relative?relative+'/'+e.name:e.name));
  for(const entry of await workspace.readDirectory(folder,'gui-native-context',accept)){
   if(!accept(entry))continue;const file=relative?relative+'/'+entry.name:entry.name;
   if(entry.isSymbolicLink())throw Error('GUI_NATIVE_CONTEXT_SYMLINK');
   if(entry.isDirectory())await walk(file);
   else if(entry.isFile()){
    if(++files>16000)throw Error('GUI_NATIVE_CONTEXT_FILE_LIMIT');
    if(extraContext(file)&&!mutable(file)&&!expected.has(file.toLowerCase()))throw Error('GUI_NATIVE_TEMPLATE_CONTEXT_EXTRA: '+file);
   }
  }
 };
 await walk();
 // Keep the private extracted context as evidence; no user paths are deleted.
 await fs.writeFile(path.join(path.dirname(directory),'Context.json'),JSON.stringify({templateSha256:proof.template.sha256,comparedFiles:expected.size,bytes},null,2)+'\n');
 return {source:runtime.toString('utf8'),context:{templateSha256:proof.template.sha256,comparedFiles:expected.size,scope:'All template components except replaced GUI/runtime/TriggerStrings; additional compile-context files are refused'}};
}
