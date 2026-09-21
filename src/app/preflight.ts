import {APP_VERSION} from './version.js';
import type {Project} from './project.js';
interface Check {name:string;status:'PASS'|'FAIL'|'NOT_APPLICABLE';errors:number;warnings:number;samples:unknown[]}
interface Report {valid:boolean;errors?:number;warnings?:number;diagnostics?:Array<{severity:string}>}
/** Offline prerequisites for testing a component directory, never engine acceptance. */
export async function projectPreflight(project:Project){
 const checks:Check[]=[];
 const check=async(name:string,run:()=>Promise<Report|undefined>)=>{try{const report=await run();checks.push(report?{name,status:report.valid?'PASS':'FAIL',errors:report.errors??report.diagnostics?.filter(d=>d.severity==='error').length??(report.valid?0:1),warnings:report.warnings??report.diagnostics?.filter(d=>d.severity==='warning').length??0,samples:report.diagnostics?.filter(d=>d.severity!=='info').slice(0,20)??[]}:{name,status:'NOT_APPLICABLE',errors:0,warnings:0,samples:[]});}catch(error){checks.push({name,status:'FAIL',errors:1,warnings:0,samples:[String(error)]});}};
 const many=async(files:string[],validate:(file:string)=>Promise<Report>)=>{if(!files.length)return undefined;const reports=await Promise.all(files.map(validate));return{valid:reports.every(r=>r.valid),errors:reports.reduce((n,r)=>n+(r.errors??r.diagnostics?.filter(d=>d.severity==='error').length??(r.valid?0:1)),0),warnings:reports.reduce((n,r)=>n+(r.warnings??r.diagnostics?.filter(d=>d.severity==='warning').length??0),0),diagnostics:reports.flatMap(r=>r.diagnostics??[])};};
 await check('map-and-terrain',async()=>{const r=await project.map.inspect();return{valid:r.valid,diagnostics:r.issues};});
 await check('ui',async()=>many(await project.workspace.listLayoutFiles(),file=>project.workspace.validate(file)));
 await check('cutscene',async()=>many(await project.cutscene.listFiles(),file=>project.cutscene.validate(file)));
 await check('text',async()=>project.text.validate());
 await check('data',async()=>project.data.validate());
 await check('browse',async()=>{const r=await project.browse.validate();return{valid:r.valid,warnings:r.warnings.length+r.unresolvedCount+r.duplicatesAcrossLayers.length,diagnostics:r.warnings.slice(0,20).map(message=>({severity:'warning',message}))};});
 await check('placement',async()=>{const raw=await project.workspace.readRaw('Objects');if(!raw.exists&&!raw.staged)return undefined;const r=await project.placement.validate();return{valid:r.valid,diagnostics:r.issues};});
 await check('ai',async()=>{const raw=await project.workspace.readRaw('CustomAI');return raw.exists||raw.staged?project.ai.validate():undefined;});
 await check('script',async()=>{const info=await project.script.inspect();return info.files.length?project.script.validate():undefined;});
 const pendingFiles=[...new Set([...project.workspace.draftFiles(),...project.workspace.binary.draftFiles()])].sort();
 return{version:APP_VERSION,readyForEditorTest:!pendingFiles.length&&checks.every(c=>c.status!=='FAIL'),validationScope:'Offline checks of known formats and available static rules only',standardFunctionCoverage:'PARTIAL',checks,pendingFiles,targetChecks:{windowsLauncher:'NOT_EXECUTED',editorSaveReopen:'NOT_EXECUTED',galaxyCompiler:'NOT_EXECUTED',gameRuntime:'NOT_EXECUTED'},requiredTargetTests:['Open/save/reopen the chosen map in SC2Editor and compare components','Compile the Galaxy entry chain','Run generated behavior, lighting/water/pathing/UI/cutscene probes'],limitations:['PASS does not establish full native semantics or support for every standard function','Warnings and unresolved dependencies still need review','No native clean-map/cliff/ramp/pathing/complex-water guarantee']};
}
