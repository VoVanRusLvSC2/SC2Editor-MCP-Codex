import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {ModkitIntegration} from '../../integrations/modkit/runtime.js';
import {minimapTga} from './minimap.js';
import type {MinimapRequest,NativeMinimapWorkspace} from './nativeMinimap.js';
import { VerifiedArtifactCache } from "../../core/verifiedArtifacts.js";

export interface MapPreviewRequest {
  directory:string; output:'html'|'png'|'both';mode:'topdown'|'render';width:number;height:number;
  maxModels:number;maxModelMiB:number;locales:string[];
  camera?:{azimuth:number;elevation:number;zoom:number;target:[number,number,number]};
}
/** Tagged binary/maps keep world data compact without turning buffers into JSON number arrays. */
export function encodeWorld(input:unknown):string{
  return JSON.stringify(input,(_key,value)=>{
    if(value instanceof Map)return {$modkit:'map',value:[...value]};
    if(ArrayBuffer.isView(value))return {$modkit:value.constructor.name,value:Buffer.from(value.buffer,value.byteOffset,value.byteLength).toString('base64')};
    if(value instanceof ArrayBuffer)return {$modkit:'ArrayBuffer',value:Buffer.from(value).toString('base64')};
    if(typeof value==='bigint')return {$modkit:'bigint',value:String(value)};
    return value;
  }).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
}
export const worldReviver=`(_key,v)=>{
  if(!v||typeof v!=='object'||!v.$modkit)return v;
  if(v.$modkit==='map')return new Map(v.value);
  if(v.$modkit==='bigint')return BigInt(v.value);
  const types={Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array};
  if(v.$modkit==='ArrayBuffer'||types[v.$modkit]){
    const raw=atob(v.value),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    return v.$modkit==='ArrayBuffer'?bytes.buffer:new types[v.$modkit](bytes.buffer);
  }return v;
}`;
export class MapPreviewWorkspace {
  private cache?: {
    key: string;
    backend: object;
    value: { input: Record<string, any>; summary: Record<string, any> };
  };
  private readonly artifacts = new VerifiedArtifactCache<Record<string, unknown>>();
  constructor(readonly modkit:ModkitIntegration,readonly nativeMinimap?:NativeMinimapWorkspace){}
  async rebuildMinimap(request:MinimapRequest){
    if(request.backend!=='overview'){
      if(!this.nativeMinimap)throw Error('MINIMAP_NATIVE_EDITOR_UNAVAILABLE: overview must be selected explicitly');
      return this.nativeMinimap.rebuild(request);
    }
    if(request.jobId)throw Error('MINIMAP_OVERVIEW_HAS_NO_NATIVE_JOB');
    if(![64,128,256,512].includes(request.size))throw Error('MINIMAP_SIZE');
    const workspace=this.modkit.workspace;
    // Reject archives: authoring is a guarded component transaction, never an archive rewrite.
    if(!(await fs.stat(workspace.resolveUserPath(request.directory))).isDirectory())throw Error('MINIMAP_COMPONENT_DIRECTORY_REQUIRED');
    const before=await this.modkit.snapshot(request.directory);
    const rendered=await this.preview({directory:request.directory,output:'png',mode:'topdown',width:request.size,height:request.size,maxModels:1,maxModelMiB:16,locales:['enUS']});
    if(rendered.inputRevision!==before.revision)throw Error('MINIMAP_SOURCE_CHANGED');
    const {default:sharp}=await import('sharp');
    const {data,info}=await sharp(rendered.files.png!).resize(request.size,request.size,{fit:'contain',background:{r:0,g:0,b:0}}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
    if(info.channels!==3)throw Error('MINIMAP_PIXEL_FORMAT');
    const bytes=minimapTga(data,info.width,info.height),file=workspace.binary.key(path.join(request.directory,'Minimap.tga'));
    const previous=await workspace.binary.read(file,false);
    const verify=async()=>{if((await this.modkit.snapshot(request.directory)).revision!==before.revision)throw Error('STALE_MINIMAP_SOURCE');};
    const transaction=await workspace.binary.apply([file],()=>new Map([[file,bytes]]),{...request,expectedSha256:{[file]:createHash('sha256').update(previous.bytes).digest('hex')},verify});
    return {...transaction,file,width:info.width,height:info.height,sha256:createHash('sha256').update(bytes).digest('hex'),inputRevision:before.revision,preview:rendered.files.png,backend:'overview',renderer:'ModKit top-down overview',limitations:['Draft only: approximate overview, not standard textured SC2 terrain.','In-game terrain and fog rendering require their own observation.']};
  }
  async preview(request: MapPreviewRequest) {
    return this.modkit.exclusive(async () => {
      const started = performance.now(),
        snapshot = await this.modkit.snapshot(request.directory),
        backend = await this.modkit.port();
      const key = JSON.stringify([
        snapshot.revision,
        request.maxModels,
        request.maxModelMiB,
        request.locales,
      ]);
      const sameBackend = this.cache?.backend === backend;
      if (!sameBackend) this.artifacts.clear();
      const cacheHit = sameBackend && this.cache?.key === key;
      const model = cacheHit
        ? this.cache!.value
        : await backend.preview({
            ...snapshot,
            ...request,
            camera: undefined,
            maxModelBytes: request.maxModelMiB * 1024 * 1024,
            signal: AbortSignal.timeout(180000),
          });
      this.cache = { key, backend, value: model };
      const input = {
        ...model.input,
        camera: request.camera ?? {
          azimuth: Math.PI / 4,
          elevation: 1,
          zoom: 1.45,
          target: [0, 0, 0],
        },
      };
      const outputId = createHash("sha256")
        .update(
          key +
            JSON.stringify(request.camera ?? null) +
            request.mode +
            request.width +
            request.height,
        )
        .digest("hex")
        .slice(0, 24);
      const directory = this.modkit.workspace.resolveUserPath(
        path.join(".sc2mcp-output", "map-preview", outputId),
      );
      await fs.mkdir(directory, { recursive: true });
      const files: { html?: string; png?: string } = {};
      const artifactHits: { html?: boolean; png?: boolean } = {};
      let pngInfo: unknown;
      if (request.output !== "png") {
        files.html = this.modkit.workspace.resolveUserPath(path.join(directory, "Map.html"));
        artifactHits.html = !!(await this.artifacts.get(outputId + ":html", files.html));
        if (!artifactHits.html) {
          const data = encodeWorld(input);
          if (Buffer.byteLength(data) > 192 * 1024 * 1024)
            throw Error("MAP_PREVIEW_HTML_BYTE_LIMIT");
          const compressed = gzipSync(data, { level: 6 }).toString("base64"),
            script = await backend.viewerScript();
          files.html = this.modkit.workspace.resolveUserPath(path.join(directory, "Map.html"));
          const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ModKit · Карта</title>
<style>html,body{margin:0;background:#101923;color:#dbeafa;font:14px system-ui}header{padding:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}button{padding:7px 12px;background:#28495f;border:1px solid #527387;color:white;border-radius:4px}canvas{display:block;width:100%;height:75vh;touch-action:none}footer,details{padding:10px;color:#a9bdd0}pre{white-space:pre-wrap;max-height:30vh;overflow:auto}</style>
<header><b>Карта · ModKit</b><button id="reset">Общий план</button><button id="top">Сверху</button><label><input type="checkbox" data-facet="objects" checked>Объекты</label><label><input type="checkbox" data-facet="water" checked>Вода</label><span id="status">Загрузка…</span></header><canvas></canvas><footer>Мышь: перемещение · ПКМ/Shift: вращение · колесо: масштаб · щелчок: координаты и ID объекта. <span id="picked"></span></footer><details><summary>Диагностика и ограничения</summary><pre id="diagnostics"></pre></details>
<script id="world" type="application/octet-stream">${compressed}</script><script id="summary" type="application/json">${encodeWorld(model.summary)}</script><script>${script.replaceAll("</script", "<\\/script")}</script>
<script>(async()=>{const summary=JSON.parse(document.getElementById('summary').textContent);document.getElementById('diagnostics').textContent=JSON.stringify(summary,null,2);try{const raw=atob(document.getElementById('world').textContent),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const decoded=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();ModkitMapViewer.mount(JSON.parse(decoded,${worldReviver}),summary)}catch(error){document.getElementById('status').textContent=String(error);console.error(error)}})()</script></html>`;
          await fs.writeFile(files.html, html, "utf8");
          this.artifacts.remember(outputId + ":html", files.html, Buffer.from(html), {});
        }
      }
      if (request.output !== "html") {
        files.png = this.modkit.workspace.resolveUserPath(path.join(directory, "Map.png"));
        const artifact = await this.artifacts.get(outputId + ":png", files.png);
        artifactHits.png = !!artifact;
        if (artifact) pngInfo = artifact;
        else {
          const png = await backend.png(input, {
            width: request.width,
            height: request.height,
            mode: request.mode,
            signal: AbortSignal.timeout(45000),
          });
          files.png = this.modkit.workspace.resolveUserPath(path.join(directory, "Map.png"));
          await fs.writeFile(files.png, png.bytes);
          pngInfo = {
            width: png.width,
            height: png.height,
            mode: request.mode,
            limitations: png.limitations,
            diagnostics: png.diagnostics.slice(0, 8),
          };
          this.artifacts.remember(
            outputId + ":png",
            files.png,
            png.bytes,
            pngInfo as Record<string, unknown>,
          );
        }
      }
      return {
        ...model.summary,
        source: snapshot.source,
        inputRevision: snapshot.revision,
        cacheHit,
        artifactHits,
        files,
        png: pngInfo,
        elapsedMilliseconds: Math.round(performance.now() - started),
        editorUsed: false,
      };
    });
  }
}
