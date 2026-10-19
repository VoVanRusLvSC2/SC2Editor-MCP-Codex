import type {McpServer} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {promises as fs} from 'node:fs';
import type {ModkitIntegration} from './runtime.js';
import type {MapPreviewWorkspace} from '../../modules/map/preview.js';

const locales=z.array(z.string().regex(/^[a-z]{2}[A-Z]{2}$/)).min(1).max(4).default(['ruRU','enUS']);
const annotations={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
const text=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
export async function modkitToolResult(work:()=>Promise<unknown>){try{return text(await work());}catch(e){return {isError:true,...text({error:e instanceof Error?e.message:String(e)})};}}
export function registerModkitIntegrationTools(server:McpServer,integration:ModkitIntegration,enabled:{data:boolean;map:boolean},preview:MapPreviewWorkspace){
  server.registerTool('modkit.runtime',{description:'Report optional pinned ModKit runtime, Data/map/CASC adapters and setup requirements. Does not launch SC2.',inputSchema:z.object({}).strict(),annotations},()=>modkitToolResult(()=>integration.provenance()));
  if(enabled.data)server.registerTool('data.modkit.query',{
    description:'Read effective Data through the original ModKit SC2 ModContext and installed CASC/dependencies. Selected entities/fields or paged IDs; source provenance and unresolved mods remain explicit. Existing data.plan/apply writer is separate. Committed bytes only.',
    inputSchema:z.object({directory:z.string().min(1).default('.'),view:z.enum(['entities','authoring','ids','exists']).default('entities'),
      refs:z.array(z.object({namespace:z.string().min(1).max(128),entityId:z.string().min(1).max(256)}).strict()).min(1).max(16).optional(),
      namespace:z.string().min(1).max(128).optional(),fields:z.array(z.string().min(1).max(128)).max(32).optional(),
      offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(20),locales}).strict(),annotations,
  },args=>modkitToolResult(async()=>{
    if(args.view==='ids'&&!args.namespace)throw Error('MODKIT_DATA_NAMESPACE_REQUIRED');
    if(args.view!=='ids'&&!args.refs)throw Error('MODKIT_DATA_REFS_REQUIRED');
    return integration.dataQuery(args);
  }));
  if(enabled.map)server.registerTool('map.preview',{
    description:'Preview a packed SC2Map or component directory using the actual ModKit world renderer: terrain, native cliffs, water, models and textures through its canonical mod/CASC loader. Self-contained interactive WebGL HTML; optional PNG and MCP image. CPU render has explicit visual limits. Reads committed bytes; does not use SC2 Editor.',
    inputSchema:z.object({directory:z.string().min(1).default('.'),output:z.enum(['html','png','both']).default('html'),
      mode:z.enum(['topdown','render']).default('render'),width:z.number().int().min(128).max(768).default(512),height:z.number().int().min(128).max(768).default(384),
      maxModels:z.number().int().min(1).max(512).default(128),maxModelMiB:z.number().int().min(16).max(128).default(64),locales,
      camera:z.object({azimuth:z.number().finite(),elevation:z.number().min(.01).max(Math.PI/2),zoom:z.number().min(.1).max(40),target:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()])}).strict().optional(),
      includeImage:z.boolean().default(false)}).strict(),annotations,
  },async args=>{
    try{
      if(args.includeImage&&args.output==='html')throw Error('MAP_PREVIEW_IMAGE_REQUIRES_PNG_OUTPUT');
      const result=await preview.preview(args),content:Array<{type:'text';text:string}|{type:'image';mimeType:'image/png';data:string}>=[{type:'text',text:JSON.stringify(result)}];
      if(args.includeImage&&result.files.png){const bytes=await fs.readFile(result.files.png);if(bytes.length>3*1024*1024)throw Error('MAP_PREVIEW_MCP_IMAGE_LIMIT');content.push({type:'image',mimeType:'image/png',data:bytes.toString('base64')});}
      return {content};
    }catch(error){return {isError:true,...text({error:error instanceof Error?error.message:String(error)})};}
  });
}
