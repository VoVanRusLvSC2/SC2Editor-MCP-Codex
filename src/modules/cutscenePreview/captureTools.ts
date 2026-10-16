import type {McpServer} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {CutscenePreviewWorkspace} from './workspace.js';
import {captureWebglFrame} from './headless.js';

export const captureRequestSchema=z.object({
 file:z.string().min(1).max(1024),time:z.number().int().nonnegative().max(1e9).default(0),
 width:z.number().int().min(160).max(1920).default(1280),height:z.number().int().min(120).max(1080).default(720),
 camera:z.string().min(1).max(128).default('director'),locale:z.enum(['enUS','ruRU']).default('enUS'),
 textureMaxSize:z.union([z.literal(512),z.literal(1024),z.literal(2048)]).default(1024),
 lightPreset:z.string().min(1).max(128).default('DefaultLight'),postprocess:z.boolean().default(true),
 filters:z.array(z.string().min(1).max(128)).max(32).optional(),showGuides:z.boolean().default(true),
 ticksPerSecond:z.number().positive().max(1e9).optional(),includeImage:z.boolean().default(true),
 packages:z.array(z.string().regex(/^(mods|campaigns)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.sc2(mod|campaign)$/)).min(1).max(12).optional()
}).strict();
let busy=false;
export function registerCutsceneRenderTool(server:McpServer,preview:CutscenePreviewWorkspace,capture:typeof captureWebglFrame=captureWebglFrame){
 server.registerTool('cutscene.render',{
  description:'Capture one cutscene frame from the same local WebGL2 player used for interactive preview, returning PNG directly to the AI. Background Edge/Chrome, fresh temporary profile, no SC2 Editor. time uses native ticks (normally milliseconds). Full requested pixel dimensions; renderer/camera/light/RTT diagnostics included. Native engine visual parity is unvalidated. Embedded resources only; browser must be installed. Writes a separate PNG, never replaces the player. includeImage=false returns paths and metadata.',
  inputSchema:captureRequestSchema,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}
 },async a=>{
  if(busy)return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:'CUTSCENE_RENDER_BUSY'})}]};busy=true;
  try{
   const {time,includeImage,...request}=a,result=await preview.preview({...request,times:[time],snapshots:false});
   const htmlFile=preview.workspace.resolveUserPath(result.htmlFile);
   if(path.extname(htmlFile).toLowerCase()!=='.html')throw Error('CUTSCENE_CAPTURE_HTML_EXTENSION');
   const stat=await fs.stat(htmlFile);if(!stat.isFile()||stat.size>384*1024*1024)throw Error('CUTSCENE_CAPTURE_HTML_BUDGET');
   const digest=async()=>createHash('sha256').update(await fs.readFile(htmlFile)).digest('hex'),before=await digest();
   const captured=await capture(htmlFile,time,a.width,a.height);
   if(captured.png.length>12*1024*1024||!captured.png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('CUTSCENE_CAPTURE_PNG_BUDGET_OR_FORMAT');
   const metadata=await sharp(captured.png,{limitInputPixels:1920*1080}).metadata();
   if(metadata.format!=='png'||metadata.width!==a.width||metadata.height!==a.height||captured.frame.time!==time||captured.frame.width!==a.width||captured.frame.height!==a.height)throw Error('CUTSCENE_CAPTURE_DIMENSIONS');
   if(await digest()!==before)throw Error('CUTSCENE_CAPTURE_PLAYER_CHANGED');
   const parsed=path.parse(htmlFile),pngFile=preview.workspace.resolveUserPath(path.join(parsed.dir,parsed.name+'.webgl-'+time+'-'+randomUUID()+'.png'));
   if(pngFile===htmlFile)throw Error('CUTSCENE_CAPTURE_OUTPUT_COLLISION');await fs.writeFile(pngFile,captured.png,{flag:'wx'});
   return {content:[{type:'text' as const,text:JSON.stringify({pngFile,htmlFile,reportFile:result.reportFile,playerSha256:before,bytes:captured.png.length,renderer:'WebGL2',frame:captured.frame,engineValidated:false,allSupported:false})},...(includeImage?[{type:'image' as const,mimeType:'image/png',data:captured.png.toString('base64')}]:[])]};
  }catch(e){return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:e instanceof Error?e.message:String(e)})}]};}
  finally{busy=false;}
 });
}
