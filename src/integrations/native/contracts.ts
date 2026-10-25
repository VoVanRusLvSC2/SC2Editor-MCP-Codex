import * as z from 'zod/v4';
import {nativeQueuedMethods} from './background.js';

// Client-side contracts for the pinned public 1.0 API, not an alternate SDK.
// https://github.com/VoVanRusLvSC2/SC2EditorToolkit/blob/v1.0.0/docs/MCP_CONTRACT.md
const text=z.string().min(1),number=z.number().finite(),boolean=z.boolean();
const fields:Record<string,z.ZodType>={
 editor_path:text,template:text,map:text,startup_module:z.enum(['triggers','terrain','default']),render_backend:z.enum(['auto','legacy','vulkan']),
 scope:text,context_label:text,locale:text,triggers_xml:text,triggers_file:text,trigger_strings:text,game_strings:text,marker:z.string(),expect_text:z.array(z.string()).max(100),compile:boolean,
 output:text,overwrite:boolean,scene:text,camera:text,map_camera_id:text,time_ms:number.min(0).max(600000),allow_empty:boolean,
 size:z.union([z.literal(512),z.literal(1024),z.literal(2048),z.literal(4096)]),include_units:boolean,include_doodads:boolean,query:z.string().max(256),kinds:z.array(z.enum(['unit','doodad','point','camera','other'])).min(1).max(100000),owner:z.number().int().min(0).max(255),offset:z.number().int().min(0).max(500000),limit:z.number().int().min(1).max(500),
 bounds:z.object({left:number,bottom:number,right:number,top:number}).strict(),baseline_template:text,include_diffs:boolean,
 start_ms:number.min(0).max(600000),end_ms:number.min(0).max(600000),fps:z.number().int().min(1).max(60),keep_frames:boolean,include_audio:boolean,
 catalog:text,object_id:text,field_offset:z.number().int().min(0).max(100000),field_limit:z.number().int().min(1).max(500),include_xml:boolean,
 report_id:z.string().length(32),before_report_id:z.string().length(32),after_report_id:z.string().length(32),section:z.enum(['objects','findings']),kind:text,finding_status:z.enum(['present','missing','unknown']),target_catalog:text,target_id:text,
 job_id:text,wait_ms:z.number().int().min(0).max(30000),operation:z.enum(Object.values(nativeQueuedMethods) as [string,...string[]]),arguments:z.record(z.string(),z.unknown()),timeout_seconds:number.min(1).max(14400),
};
const startup='editor_path render_backend template map',context='scope context_label locale';
const definitions:Record<string,[string,string?]>={
 sc2_modules:[''],sc2_editor_start:['template editor_path render_backend startup_module','template'],sc2_open_document:['map editor_path render_backend','map'],
 sc2_convert_xml:[startup+' '+context+' startup_module triggers_xml triggers_file trigger_strings game_strings marker expect_text compile','template'],
 sc2_compile_all:[context],sc2_export_galaxy:['output overwrite'],sc2_diagnostics:[''],
 sc2_validate_document:[startup+' baseline_template'],sc2_save_reopen:[startup+' baseline_template include_diffs output overwrite'],sc2_check_map:[startup+' '+context+' baseline_template save_reopen include_diffs'],
 sc2_audit_data:[startup+' limit'],sc2_read_data:[startup+' catalog object_id field_offset field_limit include_xml','catalog object_id'],sc2_data_links:[startup+' catalog object_id','catalog object_id'],sc2_check_resources:[startup+' catalog object_id','catalog object_id'],
 sc2_cutscene_open:[startup+' scene'],sc2_cutscene_seek:['camera time_ms'],sc2_capture_frame:['camera time_ms output overwrite allow_empty'],sc2_capture_terrain:[startup+' map_camera_id output overwrite allow_empty'],
 sc2_export_map_image:[startup+' size include_units include_doodads output overwrite'],sc2_capture_map_region:[startup+' bounds size include_units include_doodads output overwrite','bounds'],
 sc2_list_map_cameras:['map locale'],sc2_search_objects:['map locale query kinds owner bounds offset limit'],sc2_export_video:[startup+' scene camera start_ms end_ms fps keep_frames include_audio output overwrite'],
 sc2_doctor:['editor_path render_backend'],sc2_query_audit:['report_id section catalog object_id kind finding_status offset limit','report_id'],sc2_find_object_uses:['report_id target_catalog target_id catalog object_id offset limit','report_id target_catalog target_id'],sc2_compare_audits:['before_report_id after_report_id section catalog object_id offset limit','before_report_id after_report_id'],
 sc2_submit_job:['operation arguments timeout_seconds','operation'],sc2_job_status:['job_id','job_id'],sc2_job_wait:['job_id wait_ms','job_id'],sc2_job_cancel:['job_id','job_id'],
};
fields.save_reopen=boolean;
export const nativeArgumentSchemas=Object.fromEntries(Object.entries(definitions).map(([name,[allowed,required='']])=>{
 const requiredKeys=new Set(required.split(' '));
 const shape=Object.fromEntries(allowed.split(' ').filter(Boolean).map(key=>{const schema=key==='offset'&&['sc2_query_audit','sc2_find_object_uses','sc2_compare_audits'].includes(name)?z.number().int().min(0).max(10000000):fields[key];return[key,requiredKeys.has(key)?schema:schema.optional()];}));
 return[name,z.object(shape).strict()];
}));
export function parseNativeArguments(method:string,args:Record<string,unknown>):Record<string,unknown>{
 const schema=nativeArgumentSchemas[method];if(!schema)throw Error('NATIVE_OPERATION_NOT_ALLOWED');
 const value=schema.parse(args);
 if(method==='sc2_convert_xml'&&value.triggers_xml!==undefined&&value.triggers_file!==undefined)throw Error('NATIVE_ARGUMENT_CONFLICT: supply triggers_xml or triggers_file, not both');
 if(method==='sc2_submit_job'){
  const target=Object.entries(nativeQueuedMethods).find(([,operation])=>operation===value.operation)?.[0];
  if(!target)throw Error('NATIVE_JOB_OPERATION_NOT_ALLOWED');value.arguments=parseNativeArguments(target,(value.arguments??{}) as Record<string,unknown>);
 }
 return value;
}
