import * as z from 'zod/v4';
import {createHash} from 'node:crypto';
import {Workspace} from '../core/workspace.js';
import {folderPath,genreFolders,missionFolders,organizationSchema,organizeTriggerXml} from '../modules/trigger/organization.js';
import type {TriggerWorkspace} from '../modules/trigger/workspace.js';

export const projectOrganizationSchema=z.object({genre:organizationSchema.shape.genre,target:z.enum(['galaxy','gui']).default('galaxy'),folders:z.array(folderPath).max(40).default([]),files:z.array(z.object({file:z.string().regex(/^Scripts\/[A-Za-z0-9_/-]+\.galaxy$/),system:folderPath}).strict()).max(40).default([]),scaffold:z.boolean().default(true),dryRun:z.boolean().default(true),stage:z.boolean().default(true)}).strict();
const manifestFile='.sc2mcp/organization.json';
export async function organizeProject(workspace:Workspace,trigger:TriggerWorkspace,input:z.input<typeof projectOrganizationSchema>){
 const a=projectOrganizationSchema.parse(input);
 if(a.target==='gui')return trigger.organize({genre:a.genre,folders:a.folders,dryRun:a.dryRun,stage:a.stage});
 const roots=a.genre==='mission'||a.genre==='coop'?[...missionFolders]:['FUNCTIONS','MAIN','GAMEPLAY'];
 const prior=await workspace.readRaw(manifestFile);
 const previous=prior.text?JSON.parse(prior.text) as {version:number;systems:string[];files:Array<{file:string;system:string}>}:null;
 if(previous&&previous.version!==1)throw new Error('ORGANIZATION_MANIFEST_VERSION');
 const explicit=[...a.folders,...a.files.map(f=>f.system)];
 const systems=[...new Set(explicit.length?explicit:previous?.systems.length?previous.systems:roots)];
 const sources=new Map<string,string>();
 if(a.scaffold){
  for(const system of systems)sources.set('Scripts/'+system+'/Module.galaxy',`// ${system}: ${system==='FUNCTIONS'?'Helpers shared by multiple systems':'Logic and state owned by this system'}.\n// Keep dedicated helpers here. Shared helpers belong in FUNCTIONS.\n`);
  sources.set('Scripts/Mission.galaxy',systems.filter(s=>s!=='MAIN').concat(systems.includes('MAIN')?['MAIN']:[]).map(s=>`include "${s}/Module"`).join('\n')+'\n');
 }
 const owned=[...new Map([...(previous?.files??[]),...Array.from(sources.keys(),file=>({file,system:file==='Scripts/Mission.galaxy'?(systems.includes('MAIN')?'MAIN':systems[0]):file.slice(8,-14)})),...a.files].map(f=>[f.file,f])).values()];
 const manifest={version:1,genre:a.genre,logicDefault:'galaxy',systems:[...new Set([...systems,...previous?.systems??[]])],files:owned,entryFile:a.scaffold?'Scripts/Mission.galaxy':null};
 const files=[...new Set([manifestFile,...sources.keys(),...owned.map(f=>f.file)])];
 const transaction=await workspace.applyRawTransaction(workspace.coupledDraftFiles(files),values=>{
  for(const file of owned)if(!values.get(file.file)&&!sources.has(file.file))throw new Error('ORGANIZATION_SOURCE_FILE_MISSING: '+file.file);
  const old=values.get(manifestFile);if(old){const previous=JSON.parse(old);if(previous.version!==1)throw new Error('ORGANIZATION_MANIFEST_VERSION');}
  if((old??'')!==prior.text)throw new Error('ORGANIZATION_MANIFEST_STALE');
  const next=new Map(values);
  for(const [file,source]of sources)if(!values.get(file))next.set(file,source);
  next.set(manifestFile,JSON.stringify(manifest,null,2)+'\n');return next;
 },{dryRun:a.dryRun,stage:a.stage,backup:true,summary:'Organize Galaxy systems and preserve existing source files'});
 const issues:string[]=[];
 return {manifest:manifestFile,...manifest,issues,suggestedSystems:genreFolders[a.genre],transaction,activation:'Scaffold is not connected to InitMap. Add initialization with script.plan connect after implementing the owning functions.',compiler:'NOT_EXECUTED'};
}
export async function checkProjectOrganization(workspace:Workspace){
 const raw=await workspace.readRaw(manifestFile);if(!raw.exists&&!raw.staged){const gui=await workspace.readRaw('Triggers');if(gui.exists||gui.staged){try{const checked=organizeTriggerXml(gui.text,{});return {status:checked.issues.length?'fail':'pass',missingFolders:[],suggestedFolders:checked.created.map(f=>f.path),issues:checked.issues,scope:'GUI ownership; folder count is advisory and executable logic is unchanged'};}catch(error){return {status:'fail',issues:[error instanceof Error?error.message:String(error)]};}}return {status:'not_checked',reason:'No organization manifest; use project.organize.'};}
 const value=JSON.parse(raw.text) as {version:number;genre:string;systems:string[];files:Array<{file:string;system:string}>};
 if(value.version!==1)throw new Error('ORGANIZATION_MANIFEST_VERSION');const issues:string[]=[];
 for(const file of value.files){if(!value.systems.includes(file.system))issues.push('UNKNOWN_SYSTEM: '+file.file);const source=await workspace.readRaw(file.file);if(!source.exists&&!source.staged)issues.push('MISSING_SOURCE: '+file.file);}
 return {status:issues.length?'fail':'pass',issues,systems:value.systems,manifestSha256:createHash('sha256').update(raw.text).digest('hex'),scope:'Manifest ownership and file existence; no engine execution'};
}
