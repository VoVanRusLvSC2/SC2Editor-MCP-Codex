import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {Workspace} from '../core/workspace.js';
import {ModkitIntegration} from '../integrations/modkit/runtime.js';
import {MapPreviewWorkspace} from '../modules/map/preview.js';
import {NativeMinimapWorkspace} from '../modules/map/nativeMinimap.js';

async function fixture(t:any){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-minimap-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'Map'));await fs.writeFile(path.join(root,'Map','Minimap.tga'),'old');
  await fs.writeFile(path.join(root,'Map','terrain.dat'),'terrain');
  const workspace=new Workspace(root),modkit=new ModkitIntegration(workspace,path.join(root,'missing-install'));
  const png=await sharp({create:{width:128,height:128,channels:3,background:{r:30,g:70,b:90}}}).png().toBuffer();
  let exports=0,captures=0,artifactReads=0;
  const job:any={id:'aaaaaaaa-1111-4111-8111-111111111111',state:'completed',operation:'capture'};
  const map:any={export:async(_directory:string,archive:string)=>{exports++;await fs.mkdir(path.dirname(workspace.resolveUserPath(archive)),{recursive:true});await fs.writeFile(workspace.resolveUserPath(archive),'archive');}};
  const editor:any={configuration:()=>({available:true}),capture:async(args:any)=>{
    captures++;assert.equal(args.includeUnits,false);assert.equal(args.includeDoodads,true);assert.equal(args.mode,'map');
    job.result={failed:false,outcome:'completed',source:workspace.resolveUserPath(args.archive),sourceSha256:createHash('sha256').update('archive').digest('hex'),sourceUnchanged:true,capture:{wholeMapVerified:true,artifactOwnershipVerified:true,artifact:{sha256:createHash('sha256').update(png).digest('hex')}},objectFilters:{verified:true,actual:{units:false,doodads:true}}};return job;
  },job:()=>job,readCaptureArtifact:async()=>{artifactReads++;return png;}};
  const native=new NativeMinimapWorkspace(modkit,map,editor),preview=new MapPreviewWorkspace(modkit,native);
  const request={directory:'Map',size:128,dryRun:false,stage:true,backup:true};
  return {root,workspace,preview,native,editor,job,request,counters:()=>({exports,captures,artifactReads})};
}

test('native minimap is the default; plan does not launch, owned capture stages standard pixels without changing terrain',async t=>{
  const f=await fixture(t);
  assert.equal((await f.preview.rebuildMinimap({...f.request,dryRun:true})).backend,'native');
  assert.deepEqual(f.counters(),{exports:0,captures:0,artifactReads:0});
  const started=await f.native.rebuild(f.request);assert.ok('jobId' in started);
  const staged=await f.native.rebuild({...f.request,jobId:started.jobId});assert.ok('transactionId' in staged);
  assert.equal(await fs.readFile(path.join(f.root,'Map','Minimap.tga'),'utf8'),'old');
  await f.workspace.binary.save(staged.transactionId!,{dryRun:false});
  const bytes=await fs.readFile(path.join(f.root,'Map','Minimap.tga'));assert.deepEqual([...bytes.subarray(18,21)],[90,70,30]);
  assert.equal(await fs.readFile(path.join(f.root,'Map','terrain.dat'),'utf8'),'terrain');
  assert.equal(await fs.readFile(path.join(f.root,'Map','Minimap.tga.sc2uimcp.bak'),'utf8'),'old');
});

test('missing native renderer never silently substitutes an overview',async t=>{
  const f=await fixture(t);f.editor.configuration=()=>({available:false});
  await assert.rejects(f.preview.rebuildMinimap(f.request),/NATIVE_EDITOR_UNAVAILABLE/);
  assert.deepEqual(f.counters(),{exports:0,captures:0,artifactReads:0});
});

test('unowned, incomplete and mismatched native captures cannot supply minimap pixels',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.native.rebuild({...f.request,jobId:f.job.id}),/OWNED_REBUILD_JOB/);
  const started=await f.native.rebuild(f.request);assert.ok('jobId' in started);
  const request={...f.request,jobId:started.jobId};
  f.job.state='running';await assert.rejects(f.native.rebuild(request),/NOT_COMPLETED/);f.job.state='completed';
  await assert.rejects(f.native.rebuild({...request,size:256}),/REQUEST_MISMATCH/);
  for(const change of [()=>f.job.result.capture.wholeMapVerified=false,()=>f.job.result.objectFilters.verified=false,()=>f.job.result.objectFilters.actual.units=true]){
    f.job.result.capture.wholeMapVerified=true;f.job.result.objectFilters={verified:true,actual:{units:false,doodads:true}};change();
    await assert.rejects(f.native.rebuild(request),/FULL_MAP_AND_FILTERS/);
  }
  assert.equal(f.counters().artifactReads,0);
  f.job.result.objectFilters={verified:true,actual:{units:false,doodads:true}};
  f.editor.readCaptureArtifact=async()=>Buffer.from('changed owned image');
  await assert.rejects(f.native.rebuild(request),/NATIVE_ARTIFACT_CHANGED/);
});

test('same-length terrain or exported archive edits invalidate native minimap and staged saves',async t=>{
  const f=await fixture(t),started=await f.native.rebuild(f.request);assert.ok('jobId' in started);
  const request={...f.request,jobId:started.jobId};
  await fs.writeFile(f.job.result.source,'changed');await assert.rejects(f.native.rebuild(request),/STALE_MINIMAP_ARCHIVE/);
  await fs.writeFile(f.job.result.source,'archive');
  const staged=await f.native.rebuild(request);assert.ok('transactionId' in staged);
  await fs.writeFile(path.join(f.root,'Map','terrain.dat'),'TERRAIN');
  await assert.rejects(f.workspace.binary.save(staged.transactionId!,{dryRun:false}),/STALE_MINIMAP_SOURCE/);
});
