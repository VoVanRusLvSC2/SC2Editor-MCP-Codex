import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {ModkitIntegration} from '../../integrations/modkit/runtime.js';
import type {NativeEditorBridge} from '../../integrations/native/bridge.js';
import type {MapWorkspace} from './workspace.js';
import {minimapTga} from './minimap.js';

export interface MinimapRequest {
  directory:string;size:number;dryRun:boolean;stage:boolean;backup:boolean;
  backend?:'native'|'overview';jobId?:string;
}
interface Pending {directory:string;revision:string;archive:string;archiveSha256:string;size:number}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

/** Original terrain pixels, bound to an owned export and the committed component revision. */
export class NativeMinimapWorkspace {
  private pending=new Map<string,Pending>();
  constructor(readonly modkit:ModkitIntegration,readonly map:MapWorkspace,readonly editor:NativeEditorBridge){}
  async rebuild(request:MinimapRequest){
    const workspace=this.modkit.workspace,directory=workspace.resolveUserPath(request.directory);
    if(!(await fs.stat(directory)).isDirectory())throw Error('MINIMAP_COMPONENT_DIRECTORY_REQUIRED');
    if(![64,128,256,512].includes(request.size))throw Error('MINIMAP_SIZE');
    if(workspace.draftFiles().length||workspace.binary.draftFiles().length)throw Error('MINIMAP_PENDING_DRAFTS');
    if(!request.jobId){
      if(!this.editor.configuration().available)throw Error('MINIMAP_NATIVE_EDITOR_UNAVAILABLE: configure the pinned Editor; overview is an explicit draft option');
      if(request.dryRun)return {dryRun:true,backend:'native',state:'planned',next:'Call with dryRun=false to queue the original Editor export. Poll editor.job, then repeat with jobId to stage Minimap.tga.',changes:['Minimap.tga'],fogChanged:false};
      if(this.pending.size>=32)throw Error('MINIMAP_JOB_LIMIT: finish retained rebuilds before starting another');
      const before=await this.modkit.snapshot(request.directory);
      const archive=path.join('.sc2mcp-output','minimap-native',randomUUID(),'Input.SC2Map');
      await this.map.export(request.directory,archive,false,false);
      if((await this.modkit.snapshot(request.directory)).revision!==before.revision)throw Error('MINIMAP_SOURCE_CHANGED');
      const archiveSha256=hash(await fs.readFile(workspace.resolveUserPath(archive)));
      const job=await this.editor.capture({archive,mode:'map',size:1024,includeUnits:false,includeDoodads:true,renderBackend:'auto',deadlineSeconds:1200});
      this.pending.set(job.id,{directory,revision:before.revision,archive,archiveSha256,size:request.size});
      return {backend:'native',state:job.state,jobId:job.id,next:'Poll editor.job, then repeat map.minimap.rebuild with this jobId and dryRun=false to stage the image.',fogChanged:false};
    }
    const pending=this.pending.get(request.jobId);
    if(!pending)throw Error('MINIMAP_OWNED_REBUILD_JOB_REQUIRED: start a rebuild in this MCP session');
    if(directory!==pending.directory||request.size!==pending.size)throw Error('MINIMAP_JOB_REQUEST_MISMATCH');
    const verify=async()=>{
      if((await this.modkit.snapshot(request.directory)).revision!==pending.revision)throw Error('STALE_MINIMAP_SOURCE');
      if(hash(await fs.readFile(workspace.resolveUserPath(pending.archive)))!==pending.archiveSha256)throw Error('STALE_MINIMAP_ARCHIVE');
    };
    await verify();
    const job=this.editor.job(request.jobId),result=job.result,capture=result?.capture;
    if(job.state!=='completed'||job.operation!=='capture'||result?.failed||result?.outcome!=='completed'||result?.sourceUnchanged!==true||result.sourceSha256!==pending.archiveSha256||typeof result.source!=='string'||path.resolve(result.source)!==workspace.resolveUserPath(pending.archive))throw Error('MINIMAP_NATIVE_CAPTURE_NOT_COMPLETED');
    if(capture?.wholeMapVerified!==true||capture.artifactOwnershipVerified!==true||result.objectFilters?.verified!==true||result.objectFilters.actual?.units!==false||result.objectFilters.actual?.doodads!==true)throw Error('MINIMAP_NATIVE_FULL_MAP_AND_FILTERS_REQUIRED');
    const png=await this.editor.readCaptureArtifact(request.jobId);
    const imageSha256=capture.preview?.sha256??capture.artifact?.sha256;
    if(typeof imageSha256!=='string'||!/^[a-f0-9]{64}$/.test(imageSha256)||hash(png)!==imageSha256)throw Error('MINIMAP_NATIVE_ARTIFACT_CHANGED');
    if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('MINIMAP_NATIVE_PNG_REQUIRED');
    const {default:sharp}=await import('sharp');
    const {data,info}=await sharp(png).resize(request.size,request.size,{fit:'contain',background:{r:0,g:0,b:0}}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
    if(info.channels!==3)throw Error('MINIMAP_PIXEL_FORMAT');
    const bytes=minimapTga(data,info.width,info.height),file=workspace.binary.key(path.join(request.directory,'Minimap.tga'));
    const previous=await workspace.binary.read(file,false);
    const transaction=await workspace.binary.apply([file],()=>new Map([[file,bytes]]),{dryRun:request.dryRun,stage:request.stage,backup:request.backup,expectedSha256:{[file]:hash(previous.bytes)},verify});
    // The staged transaction owns its verify closure; completed rebuilds need no session slot.
    if(!request.dryRun)this.pending.delete(request.jobId);
    return {...transaction,file,width:info.width,height:info.height,sha256:hash(bytes),inputRevision:pending.revision,backend:'native',renderer:'Original SC2 Editor full-map terrain export',jobId:request.jobId,sourceSha256:pending.archiveSha256,fogChanged:false,limitations:['Native terrain pixels; in-game minimap mapping and fog require separate observation. Water coverage depends on the native export.']};
  }
}
