import type {McpServer} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {NativeEditorBridge} from './bridge.js';
const deadlineSeconds=z.number().int().min(30).max(7200).default(1200);
const archive=z.string().min(1).describe('Saved SC2Map/SC2Mod inside the workspace. Export components through map.export first.');
const text=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
const run=async(work:()=>unknown|Promise<unknown>)=>{try{return text(await work());}catch(error){return {isError:true,...text({error:error instanceof Error?error.message:String(error)})};}};
export function registerNativeEditorTools(server:McpServer,bridge:NativeEditorBridge){
  server.registerTool('editor.status',{description:'Report optional SC2NativeToolkit 0.8 backend and queued native checks. connect=true initializes its retained MCP frontend, without starting an Editor.',
    inputSchema:z.object({connect:z.boolean().default(false)}).strict()},a=>run(()=>bridge.status(a.connect)));
  server.registerTool('editor.check',{description:'Queue original SC2 Editor checks on a private saved archive: load/Data diagnostics, GUI-to-Galaxy native compile, save-close-disk-reopen component comparison. Starts an owned hidden Editor when needed. Returns a job ID immediately; poll editor.job. Does not change the source or test gameplay. Unknown native logs remain unknown.',
    inputSchema:z.object({archive,checks:z.array(z.enum(['load','compile','save_reopen'])).min(1).max(3).default(['load','compile']),
      scope:z.string().min(1).optional(),contextLabel:z.string().min(1).optional(),locale:z.string().regex(/^[a-z]{2}[A-Z]{2}$/).optional(),
      includeDiffs:z.boolean().default(false),deadlineSeconds}).strict()},a=>run(()=>bridge.check(a)));
  server.registerTool('editor.capture',{description:'Queue a native Terrain PNG on a private map. viewport captures the current native view; map exports overhead; region crops the full export and requires bounds. Region is not an independent close-up. Water/category exclusions have incomplete acceptance. ModKit map.preview remains the fast default. Poll editor.job.',
    inputSchema:z.object({archive,mode:z.enum(['viewport','map','region']).default('viewport'),
      bounds:z.object({left:z.number().finite(),bottom:z.number().finite(),right:z.number().finite(),top:z.number().finite()}).strict().refine(v=>v.left<v.right&&v.bottom<v.top,'Bounds must have positive area').optional(),
      size:z.union([z.literal(512),z.literal(1024),z.literal(2048),z.literal(4096)]).default(2048),deadlineSeconds}).strict()},a=>run(()=>bridge.capture(a)));
  server.registerTool('editor.diagnostics',{description:'Queue current original Messages/Console diagnostics from the retained owned Editor. Does not start a map; an unopened session fails explicitly. Old/new messages and compiler diagnostics are distinct. Poll editor.job.',
    inputSchema:z.object({}).strict()},()=>run(()=>bridge.diagnostics()));
  server.registerTool('editor.job',{description:'Read compact native-job progress/result and local evidence paths. deadlineExceeded is advisory; active original Editor handlers are never force-killed. includeImage returns a bounded native PNG after a capture completes.',
    inputSchema:z.object({jobId:z.string().uuid(),includeImage:z.boolean().default(false)}).strict()},async a=>{
      try{const job=bridge.job(a.jobId),result=text(job),capture=job.result?.capture;
        if(a.includeImage&&job.state==='completed'&&capture){
          const file=capture.preview?.path??capture.artifact?.path;
          if(file){const real=await fs.realpath(file),root=await fs.realpath(bridge.work),relative=path.relative(root,real);
            if(path.isAbsolute(relative)||relative.startsWith('..'))throw Error('NATIVE_IMAGE_OUTSIDE_WORKER');
            if((await fs.stat(real)).size>6*1024*1024)throw Error('NATIVE_IMAGE_TOO_LARGE: use the artifact file');
            const bytes=await fs.readFile(real);if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('NATIVE_IMAGE_NOT_PNG');
            return {content:[...result.content,{type:'image' as const,mimeType:'image/png',data:bytes.toString('base64')}]};
          }
        }
        return result;
      }catch(error){return {isError:true,...text({error:error instanceof Error?error.message:String(error)})};}
    });
  server.registerTool('editor.stop',{description:'Gracefully close only the bridge-owned Toolkit frontend/hidden Editor after all jobs finish. Never attaches to the user visible Editor; refuses to abort active native handlers.',
    inputSchema:z.object({}).strict()},()=>run(()=>bridge.stop()));
}
