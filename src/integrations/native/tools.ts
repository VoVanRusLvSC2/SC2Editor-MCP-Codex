import type {McpServer} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {nativeOperations,type NativeEditorBridge} from './bridge.js';
import {nativeRelease} from './release.js';
const deadlineSeconds=z.number().int().min(30).max(7200).default(1200);
const renderBackend=z.enum(['auto','legacy','vulkan']).default('auto');
const archive=z.string().min(1).describe('Saved SC2Map/SC2Mod inside the workspace. Export components through map.export first.');
const text=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
const run=async(work:()=>unknown|Promise<unknown>)=>{try{return text(await work());}catch(error){return {isError:true,...text({error:error instanceof Error?error.message:String(error)})};}};
export function registerNativeEditorTools(server:McpServer,bridge:NativeEditorBridge){
  server.registerTool('editor.tools',{description:'List all advertised native Toolkit operations compactly; name returns the exact upstream JSON schema. Includes native XML conversion, object search, cutscene PNG/video/audio and Editor checks. Discovery does not start an Editor. Availability is separate from verified acceptance.',inputSchema:z.object({name:z.string().optional()}).strict()},a=>run(()=>bridge.tools(a.name)));
  server.registerTool('editor.call',{description:'Queue any of the 31 allowlisted original Toolkit operations. Input archives/scenes/Triggers are private workspace copies; output is job-owned. Discover arguments with editor.tools(name). Eligible pure Data inspections reuse a verified unchanged loaded archive; every request still calls native and reports documentReuse. sc2_submit_job accepts nested operation/arguments and returns a separate native job ID; observe it with sc2_job_status/wait/cancel, then poll the outer editor.job. Submission is not execution success. Status/cancel bypass the parent work queue. Never attaches to a visible Editor or writes the supplied source.',inputSchema:z.object({method:z.enum(nativeOperations),arguments:z.record(z.string(),z.unknown()).default({}),deadlineSeconds}).strict()},a=>run(()=>bridge.call(a.method,a.arguments,a.deadlineSeconds)));
  server.registerTool('editor.data.audit',{description:'Submit an original Editor audit of all effective Data catalogs on a private saved archive. limit bounds finding samples, never traversal. Returns an outer editor.job ID; its submitted result contains nativeJob.id for editor.call sc2_job_status/wait/cancel. Inspect terminal state, catalogTraversalComplete, referenceAndFileValidationComplete, validationPassed and bounded counts separately. Unknown/optional references and file presence do not certify gameplay or presentation. Complete JSONL artifacts stay in the private Toolkit worker.',inputSchema:z.object({archive,limit:z.number().int().min(1).max(500).default(50),deadlineSeconds:z.number().int().min(30).max(14400).default(3600)}).strict()},a=>run(()=>bridge.call('sc2_submit_job',{operation:'audit_data',arguments:{map:a.archive,limit:a.limit},timeout_seconds:a.deadlineSeconds},a.deadlineSeconds)));
  server.registerTool('editor.status',{description:`Report optional SC2NativeToolkit ${nativeRelease.version} backend (native protocol ${nativeRelease.nativeProtocol}) and queued native checks. connect=true initializes its retained MCP frontend, without starting an Editor.`,
    inputSchema:z.object({connect:z.boolean().default(false)}).strict()},a=>run(()=>bridge.status(a.connect)));
  server.registerTool('editor.check',{description:'Queue original SC2 Editor checks on a private saved archive: load/Data diagnostics, GUI-to-Galaxy native compile, save-close-disk-reopen component comparison. Starts an owned hidden Editor when needed. Returns a job ID immediately; poll editor.job. Does not change the source or test gameplay. Unknown native logs remain unknown.',
    inputSchema:z.object({archive,checks:z.array(z.enum(['load','compile','save_reopen'])).min(1).max(3).default(['load','compile']),
      scope:z.string().min(1).optional(),contextLabel:z.string().min(1).optional(),locale:z.string().regex(/^[a-z]{2}[A-Z]{2}$/).optional(),
      includeDiffs:z.boolean().default(false),renderBackend,deadlineSeconds}).strict()},a=>run(()=>bridge.check(a)));
  server.registerTool('editor.cameras',{description:'Queue a read-only list of saved map camera IDs, localized names, targets and original parameters, without starting an Editor. Bounded pagination; full evidence stays local. Does not evaluate trigger-created cameras or cutscenes. Poll editor.job.',
    inputSchema:z.object({archive,locale:z.string().regex(/^[a-z]{2}[A-Z]{2}$/).optional(),offset:z.number().int().min(0).max(500000).default(0),limit:z.number().int().min(1).max(100).default(40)}).strict()},a=>run(()=>bridge.cameras(a)));
  server.registerTool('editor.capture',{description:'Queue a native Terrain PNG on a private map. viewport optionally selects cameraId with original camera readback; map exports the whole map at size horizontal pixels and native aspect; region crops that export. includeUnits/includeDoodads independently filter map/region models, default true; inspect matching native objectFilters readback. Saved placements do not execute triggers. Review water separately. ModKit map.preview stays the fast default. Poll editor.job.',
    inputSchema:z.object({archive,mode:z.enum(['viewport','map','region']).default('viewport'),
      cameraId:z.string().min(1).max(256).optional(),
      includeUnits:z.boolean().optional(),includeDoodads:z.boolean().optional(),
      bounds:z.object({left:z.number().finite(),bottom:z.number().finite(),right:z.number().finite(),top:z.number().finite()}).strict().refine(v=>v.left<v.right&&v.bottom<v.top,'Bounds must have positive area').optional(),
      size:z.union([z.literal(512),z.literal(1024),z.literal(2048),z.literal(4096)]).default(2048),renderBackend,deadlineSeconds}).strict().refine(a=>!a.cameraId||a.mode==='viewport','cameraId requires viewport mode').refine(a=>a.mode!=='viewport'||a.includeUnits===undefined&&a.includeDoodads===undefined,'Object filters require map or region mode')},a=>run(()=>bridge.capture(a)));
  server.registerTool('editor.diagnostics',{description:'Queue current original Messages/Console diagnostics from the retained owned Editor. Does not start a map; an unopened session fails explicitly. Old/new messages and compiler diagnostics are distinct. Poll editor.job.',
    inputSchema:z.object({}).strict()},()=>run(()=>bridge.diagnostics()));
  server.registerTool('editor.job',{description:'Read compact native-job progress/result and evidence paths. Optional details pages the complete owned report through an RFC 6901 JSON pointer; large values remain explicit previews. No filesystem/shell access needed for deep Toolkit metadata. deadlineExceeded is advisory; active handlers are never force-killed. includeImage returns a bounded native PNG.',
    inputSchema:z.object({jobId:z.string().uuid(),includeImage:z.boolean().default(false),details:z.object({path:z.string().max(512).default(''),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(12).default(12)}).strict().optional()}).strict()},async a=>{
      try{const job=bridge.job(a.jobId),result=text({...job,...(a.details?{details:await bridge.details(a.jobId,a.details.path,a.details.offset,a.details.limit)}:{})}),capture=job.result?.capture;
        if(a.includeImage&&job.state==='completed'&&capture){
          const file=capture.preview?.path??capture.artifact?.path;
          if(file){
            const bytes=await bridge.readCaptureArtifact(a.jobId);if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('NATIVE_IMAGE_NOT_PNG');
            return {content:[...result.content,{type:'image' as const,mimeType:'image/png',data:bytes.toString('base64')}]};
          }
        }
        return result;
      }catch(error){return {isError:true,...text({error:error instanceof Error?error.message:String(error)})};}
    });
  server.registerTool('editor.stop',{description:'Gracefully close only the bridge-owned Toolkit frontend/hidden Editor after all jobs finish. Never attaches to the user visible Editor; refuses to abort active native handlers.',
    inputSchema:z.object({}).strict()},()=>run(()=>bridge.stop()));
}
