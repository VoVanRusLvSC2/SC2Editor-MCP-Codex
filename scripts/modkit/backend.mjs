// Public ModKit APIs only. This optional backend is loaded lazily by the MCP adapter.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import {performance} from 'node:perf_hooks';
import {createTerrainApi} from './terrain-api.mjs';

export async function createBackend({runtimeRoot,root,install,storage,dependencyRoots=[]}) {
  const debug=(...args)=>{if(process.env.SC2_MODKIT_DEBUG==='1')console.error('[ModKit]',...args);};
  const require=createRequire(path.join(runtimeRoot,'package.json'));
  const load=name=>import(pathToFileURL(require.resolve(name)).href);
  const sc2Require=createRequire(path.join(runtimeRoot,'starcraft2','package.json'));
  const [node,maps,scene,uv,world,viewer,local,casc,raster]=await Promise.all([
    load('@modkit/host/node'),load('@modkit/host/maps'),load('@modkit/scene/module'),
    load('@modkit/uv/module'),load('@modkit/scene/world'),load('@modkit/ui/world'),
    load('@modkit/blizzard-starcraft2/sources/local/node'),import(pathToFileURL(sc2Require.resolve('@modkit/blizzard-casc/installation-node')).href),
    load('@modkit/codec-kit/raster'),
  ]);
  const sources=new local.Sc2DesktopContentSources({installationDirectory:install,documentsDirectory:root,
    wizardDirectories:[],cascOnline:false,locale:'ruRU',cacheDirectory:path.join(storage,'cache'),
    indexCacheDirectory:path.join(storage,'index-cache'),
    sources:dependencyRoots.map(p=>({type:'mods',path:p}))});
  const budget={maxInputBytes:1_073_741_824n,maxDepth:256,maxNodes:1_048_576,maxScalarBytes:268_435_456,maxDiagnostics:1000};
  let host;
  let reader;
  let closed=false;
  let terrainApi;
  const terrain=()=>terrainApi??=Promise.all([load('@modkit/blizzard-starcraft2/map/format'),load('@modkit/blizzard-starcraft2/map/navigation'),load('@modkit/blizzard-starcraft2/map/overview')]).then(([f,n,o])=>createTerrainApi(f,n,o));
  const contexts=new Map();
  async function getHost() {
    if(closed)throw Error('MODKIT_BACKEND_CLOSED');
    if(!host)host=node.createModkit({extensions:[],trustedExtensions:['starcraft2','models','mpq','casc','.modkit-core-extensions/images','.modkit-core-extensions/models'].map(p=>path.join(runtimeRoot,p)),
      modules:[scene.sceneModule,uv.uvModule],roots:[root],intent:'full',budget,
      subjectCatalog:{contentSources:async()=>sources}}).then(async h=>{
      if(h.extensionFailures.length){await h.close();throw Error('MODKIT_EXTENSION_LOAD_FAILED: '+JSON.stringify(h.extensionFailures));}return h;
    }).catch(error=>{host=undefined;throw error;});
    return host;
  }
  async function context(target,revision,locales) {
    if(closed)throw Error('MODKIT_BACKEND_CLOSED');
    const key=JSON.stringify([target,locales]);
    let held=contexts.get(key);
    if(held?.revision!==revision){
      if(held){await held.value.dispose();contexts.delete(key);}
      // The loader owns dependency ordering, CASC/MPQ reads, invalidation and retained Data parses.
      debug('refresh');await sources.refresh('host');debug('open context',target);
      held={revision,value:await sources.openModContext({schemaVersion:1,target,locales})};
      debug('context opened');
      contexts.set(key,held);
      while(contexts.size>4){const [oldKey,old]=contexts.entries().next().value;contexts.delete(oldKey);await old.value.dispose();}
    }
    return held.value;
  }
  const chain=c=>({revision:c.revision,layers:c.layers.map(({id,sourceId,sourcePath,role,provenance})=>({id,sourceId,sourcePath,role,provenance})),unresolved:c.unresolved});
  return {
    async catalogFiles(){return [...(await load('@modkit/blizzard-starcraft2/data/catalog-analysis')).KNOWN_CATALOG_FILES];},
    async terrain(view,files,request){
      const api=await terrain();
      if(view!=='navigation'||request.catalog===false||!request.target)return api[view](files,request);
      const c=await context(request.target,request.revision,['ruRU','enUS']),asked=new Set(),answered=new Set();
      const result=await maps.analyzeWithCatalogEntities({workspace:{workspaceId:'sc2-mcp-navigation',gameId:'starcraft2'},
        analyze:async(catalog,round)=>({catalog,round,semantic:{catalogQueries:api.catalogQueries(files,catalog)}}),
        catalogEntities:async refs=>{
          if(asked.size+refs.length>4096)throw Error('MODKIT_NAVIGATION_CATALOG_REF_LIMIT');
          const entities=[];for(let i=0;i<refs.length;i+=64){const batch=refs.slice(i,i+64);for(const ref of batch)asked.add(ref.namespace+'/'+ref.entityId);
            const answer=await c.query({kind:'data.entities',refs:batch});if(!Array.isArray(answer?.entities))throw Error('MODKIT_NAVIGATION_CATALOG_ANSWER_REQUIRED');
            for(const e of answer.entities){answered.add(e.namespace+'/'+e.entityId);entities.push(e);}}
          return entities;
        }});
      const missing=[...asked].filter(k=>!answered.has(k)),pending=result.semantic.catalogQueries.filter(r=>!asked.has(r.namespace+'/'+r.entityId));
      return api.navigation(files,{...request,catalogSnapshot:result.catalog,
        catalogStatus:{entities:answered.size,footprints:result.catalog?.entities.filter(e=>e.namespace==='Footprint').length??0,rounds:result.round,
          unresolved:missing.slice(0,16),unresolvedCount:missing.length,pendingCount:pending.length,unresolvedDependencies:c.unresolved,complete:!missing.length&&!pending.length&&!c.unresolved.length}});
    },
    async data({target,revision,locales,view,refs,namespace}) {
      const c=await context(target,revision,locales);
      debug('data query',view);
      const answer=await c.query({kind:'data.'+view,...(namespace?{namespace}:{}),...(refs?{refs}:{})});
      debug('data answered');
      return {...chain(c),answer};
    },
    async preview({target,revision,locales,maxModels,maxModelBytes,camera,signal}) {
      const start=performance.now(),h=await getHost();
      await context(target,revision,locales);
      const original=await h.open(target,signal);
      let prepared,lease;
      try{
        if(!original.session)throw Error('MODKIT_MAP_OPEN_REFUSED: '+JSON.stringify(original.snapshot));
        const request={services:h.services,original:original.session,grant:{id:'sc2-mcp-map-preview',classes:['read-source']},
          budgets:budget,...maps.MAP_PREVIEW_COORDINATOR_LIMITS,
          catalogEnrichment:{...maps.MAP_PREVIEW_COORDINATOR_LIMITS.catalogEnrichment,locales},contentSources:sources,signal,
          resourcePlanResolver:node.createContentSourceMapPreviewResourcePlanResolver({contentSources:async()=>sources})};
        prepared=await maps.coordinateMapPreviewAssetSession(request);
        if(prepared.state==='selection-required'&&prepared.candidates.length===1)
          prepared=await maps.coordinateMapPreviewAssetSession({...request,selectionId:prepared.candidates[0].selectionId});
        if(prepared.state!=='opened')throw Error('MODKIT_MAP_PREVIEW_REFUSED: '+JSON.stringify(prepared));
        lease=await prepared.session.dataSource('common.view/world-scene-source',1);
        const model=await viewer.inspectCandidateWorld(lease.value,{maxLayers:16,maxItemsPerLayer:100000,maxPageItems:1024,
          maxModels,maxModelBytes,maxConcurrentModelAcquisitions:4,signal});
        const input={...viewer.candidateWorldWebGlInput(model,new Set(['regions','navigation','gateways'])),...(camera?{camera}:{})};
        const models=viewer.worldModelAssetStatus(model);
        const loadedModels=[...model.models?.values()??[]].filter(m=>m.state==='converted');
        const modelFacets={geometry:loadedModels.filter(m=>m.primitives?.length).length,
          materials:loadedModels.filter(m=>m.materials?.length).length,rigged:loadedModels.filter(m=>m.skeleton?.length).length,
          animated:loadedModels.filter(m=>m.animations?.length).length,textured:loadedModels.filter(m=>m.textures?.length).length};
        const cliffObjects=input.items.filter(i=>i.facet==='objects'&&i.id.includes(':cliff:'));
        const omitted=model.layers.filter(l=>l.page.state!=='available'||l.page.nextCursor!==undefined).map(l=>l.layer.layerId);
        const diagnostics=[...prepared.diagnostics,...model.terrainTextureDiagnostics??[],
          ...[...model.models?.values()??[]].flatMap(m=>m.diagnostics??[])];
        const grouped=new Map();
        for(const d of diagnostics){
          if(['x3.host/worker-shared-process','x3.host/permission-degraded','x3.host/map-preview-resource-timing'].includes(d.code))continue;
          const key=d.code+'|'+d.message;const held=grouped.get(key);
          if(held)held.occurrences++;else grouped.set(key,{severity:d.severity,code:d.code,message:String(d.message).slice(0,500),occurrences:1});
        }
        const shown=[...grouped.values()].sort((a,b)=>({error:0,warning:1,information:2}[a.severity]??3)-({error:0,warning:1,information:2}[b.severity]??3));
        return {input,summary:{backend:'ModKit',snapshotId:'sha256:'+createHash('sha256').update(model.snapshotId).digest('hex'),complete:model.info.complete&&!models.partial&&!omitted.length,
          models,modelFacets,cliffPieces:cliffObjects.length,rampPieces:cliffObjects.filter(i=>i.id.includes(':ramp-')).length,
          layers:model.layers.map(l=>({id:l.layer.layerId,kind:l.layer.kind,items:l.page.items.length})),omittedLayers:omitted,
          terrainTextures:model.terrainTextures?.size??0,loadMilliseconds:Math.round(performance.now()-start),
          performance:model.loadPerformance,diagnostics:shown.slice(0,16),diagnosticCount:diagnostics.length,distinctDiagnostics:shown.length,
          limitations:['ModKit world candidate; native SC2 visual parity is not certified','Optional lattice overview metadata unavailable in pinned public Core']}};
      }finally{
        await lease?.release();
        if(prepared?.state==='opened')await prepared.session.dispose();else await original.close();
      }
    },
    async png(input,{width,height,mode,signal}) {
      const plan=world.createWorldWebGlPlan(input);
      const frame=mode==='topdown'?world.renderWorldTopDown(plan,{maxSize:Math.max(width,height)}):
        await world.renderWorldHeadless(plan,{width,height,camera:input.camera,signal});
      return {bytes:await raster.encodePng(frame.width,frame.height,frame.rgba,signal),width:frame.width,height:frame.height,
        diagnostics:frame.diagnostics??[],limitations:mode==='topdown'?['Top-down world overview; object markers']:
          ['CPU renderer: no GPU shadows, splat normal/specular, tone mapping, screen effects or anisotropic filtering']};
    },
    async casc() {
      if(closed)throw Error('MODKIT_BACKEND_CLOSED');
      if(!reader)reader=casc.openCascInstallation(install,{directory:path.join(storage,'index-cache')},{online:false})
        .catch(error=>{reader=undefined;throw error;});
      return reader;
    },
    async close(){
      if(closed)return;closed=true;
      const work=[...contexts.values()].map(c=>c.value.dispose());contexts.clear();
      if(host)work.push(host.then(h=>h.close()));if(reader)work.push(reader.then(r=>r.close()));
      await Promise.allSettled(work);await sources.dispose();
    },
    async viewerScript(){return readFile(path.join(runtimeRoot,'sc2-mcp-world-viewer.js'),'utf8');},
  };
}
