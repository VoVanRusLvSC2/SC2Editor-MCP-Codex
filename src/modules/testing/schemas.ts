import * as z from 'zod/v4';
import {actionCheckSchema} from './actionChecks.js';

const name=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const point=z.object({x:z.number().finite(),y:z.number().finite()}).strict();
const area=z.object({xmin:z.number().finite(),ymin:z.number().finite(),xmax:z.number().finite(),ymax:z.number().finite()}).strict().refine(a=>a.xmin<=a.xmax&&a.ymin<=a.ymax,'Area minima must not exceed maxima');
const view=z.object({id:name,required:z.boolean().default(true),camera:z.object({x:z.number().finite(),y:z.number().finite(),distance:z.number().positive().max(4096),pitch:z.number().min(0.1).max(89.9),yaw:z.number().finite()}).strict(),includeUI:z.boolean().default(false)}).strict();
const step=z.object({method:z.enum(['game.status','game.units.find','game.units.inspect','game.selection.set','game.camera.set','game.capture','game.order','game.wait','game.events','game.fixture','game.ui.inspect','game.ui.activate']),arguments:z.record(z.string(),z.unknown()).default({}),expect:z.record(z.string(),z.unknown()).optional(),id:name.optional()}).strict();
export const startupEventSchema=z.object({id:name,required:z.boolean().default(true),timeout:z.number().int().min(1).max(120).default(20),match:z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),z.union([z.string().max(512),z.number().finite(),z.boolean(),z.null()])).refine(m=>typeof m.kind==='string'&&m.kind.length>0&&typeof m.source==='string'&&m.source.length>0&&Object.keys(m).length<=16,'Match requires explicit nonempty kind/source and at most 16 exact scalar fields')}).strict();
export const testManifestSchema=z.object({
 version:z.literal(1),map:z.string().min(1),label:z.string().max(160).default('Map acceptance'),
 dependencies:z.array(z.object({id:z.string().min(1).max(256),file:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()).max(32).default([]),
 expectedGameBuild:z.string().max(80).optional(),
 editor:z.object({checks:z.array(z.enum(['load','compile','save_reopen'])).min(1).max(3).default(['load','compile']),required:z.boolean().default(true),expected:z.enum(['passed','compile_failed','load_failed']).default('passed'),diagnosticIncludes:z.string().min(3).max(256).optional(),scope:z.string().min(1).max(256).optional(),contextLabel:z.string().min(1).max(256).optional(),locale:z.string().regex(/^[a-z]{2}[A-Z]{2}$/).optional(),gameArtifact:z.enum(['source','native_saved']).default('source'),renderBackend:z.enum(['auto','legacy','vulkan']).default('auto')}).strict().optional(),
 game:z.object({required:z.boolean().default(true),timeout:z.number().int().min(10).max(300).default(180),renderBackend:z.enum(['auto','legacy','vulkan']).default('auto'),
  launchDiagnostics:z.boolean().default(true),
  ready:z.object({type:z.string().min(1),owner:z.number().int().min(0).max(15).optional(),area:area.optional(),state:z.object({life:z.number().finite().min(0).optional(),shields:z.number().finite().min(0).optional(),energy:z.number().finite().min(0).optional()}).strict().refine(s=>Object.keys(s).length>0,'Readiness state requires a vital').optional(),timeout:z.number().int().min(1).max(120).default(20)}).strict().optional(),
  startupEvents:z.array(startupEventSchema).max(16).default([]),
  points:z.record(name,point).default({}),
  routes:z.array(z.object({id:name,from:name,to:name,type:z.string().min(1),owner:z.number().int().min(0).max(15).default(1),mobility:z.literal('ground'),expected:z.enum(['arrive','blocked']).default('arrive'),timeout:z.number().int().min(1).max(120).default(20),tolerance:z.number().min(0.1).max(3).default(0.75),maxDeviation:z.number().finite().min(0.1).max(4096).optional(),bidirectional:z.boolean().default(true),required:z.boolean().default(true)}).strict()).max(16).default([]),
  scenarios:z.array(z.object({id:name,required:z.boolean().default(true),steps:z.array(step).min(1).max(32)}).strict()).max(16).default([]),
  actions:z.array(actionCheckSchema).max(16).default([]),
  views:z.array(view).max(8).default([]),
  diagnostics:z.object({required:z.boolean().default(false),expected:z.array(z.object({source:z.string().min(1),text:z.string().min(1),build:z.string().min(1)}).strict()).max(32).default([])}).strict().default({required:false,expected:[]}),
  capture:z.boolean().default(true)
 }).strict().optional()
}).strict().superRefine((m,c)=>{
 if(!m.editor&&!m.game)c.addIssue({code:'custom',message:'At least one Editor or game suite is required'});
 if(m.editor&&m.editor.expected!=='passed'&&!m.editor.diagnosticIncludes)c.addIssue({code:'custom',message:'Negative Editor fixtures require diagnosticIncludes to distinguish their expected error from unrelated failures'});
 if(m.editor?.expected==='compile_failed'&&!m.editor.checks.includes('compile')||m.editor?.expected==='load_failed'&&!m.editor.checks.includes('load'))c.addIssue({code:'custom',message:'Expected failure requires the corresponding Editor check'});
 if(m.editor?.gameArtifact==='native_saved'&&(!m.game||m.editor.expected!=='passed'||!m.editor.checks.includes('save_reopen')))c.addIssue({code:'custom',message:'native_saved requires a game suite and a successful save_reopen check'});
 const ids=new Set<string>();
 for(const d of m.dependencies){if(ids.has(d.id))c.addIssue({code:'custom',message:'Duplicate dependency: '+d.id});ids.add(d.id);}
 ids.clear();
 for(const e of m.game?.startupEvents??[]){if(ids.has(e.id))c.addIssue({code:'custom',message:'Duplicate check ID: '+e.id});ids.add(e.id);}
 for(const r of m.game?.routes??[]){if(!m.game?.points[r.from]||!m.game?.points[r.to])c.addIssue({code:'custom',message:'Route endpoint missing: '+r.id});if(r.from===r.to)c.addIssue({code:'custom',message:'Route endpoints must differ: '+r.id});if(ids.has(r.id))c.addIssue({code:'custom',message:'Duplicate check ID: '+r.id});ids.add(r.id);}
 for(const s of m.game?.scenarios??[]){if(ids.has(s.id))c.addIssue({code:'custom',message:'Duplicate check ID: '+s.id});ids.add(s.id);}
 for(const a of m.game?.actions??[]){if(ids.has(a.id))c.addIssue({code:'custom',message:'Duplicate check ID: '+a.id});ids.add(a.id);}
 for(const v of m.game?.views??[]){if(ids.has(v.id))c.addIssue({code:'custom',message:'Duplicate check ID: '+v.id});ids.add(v.id);}
});
export type TestManifest=z.infer<typeof testManifestSchema>;
export type CheckState='passed'|'failed'|'unsupported'|'inconclusive'|'not_checked';
export interface TestCheck {id:string;status:CheckState;required:boolean;reason?:string;evidence?:Record<string,unknown>}
export function testVerdict(checks:TestCheck[]):CheckState {
 const required=checks.filter(c=>c.required);
 if(checks.some(c=>c.status==='failed'))return 'failed';
 if(!required.length)return 'inconclusive';
 if(required.some(c=>c.status==='unsupported'))return 'unsupported';
 if(required.some(c=>c.status==='inconclusive'||c.status==='not_checked'))return 'inconclusive';
 return 'passed';
}
