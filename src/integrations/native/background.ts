import {nativeReportPage} from './details.js';

export const nativeJobOperations=['start','open_document','execute','compile_current','export_galaxy','diagnostics','validate_document','save_reopen_document','cutscene_open','cutscene_seek','capture_frame','capture_terrain','export_map_image','capture_map_region','list_map_cameras','search_objects','export_video','check_document','read_data','data_links','check_resources','audit_data','doctor','query_audit','find_object_uses','compare_audits'] as const;
export type NativeJobOperation=typeof nativeJobOperations[number];
export const nativeQueuedMethods:Readonly<Record<string,NativeJobOperation>>={
 sc2_editor_start:'start',sc2_open_document:'open_document',sc2_convert_xml:'execute',sc2_compile_all:'compile_current',
 sc2_export_galaxy:'export_galaxy',sc2_diagnostics:'diagnostics',sc2_validate_document:'validate_document',sc2_save_reopen:'save_reopen_document',
 sc2_cutscene_open:'cutscene_open',sc2_cutscene_seek:'cutscene_seek',sc2_capture_frame:'capture_frame',sc2_capture_terrain:'capture_terrain',
 sc2_export_map_image:'export_map_image',sc2_capture_map_region:'capture_map_region',sc2_list_map_cameras:'list_map_cameras',
 sc2_search_objects:'search_objects',sc2_export_video:'export_video',sc2_check_map:'check_document',sc2_read_data:'read_data',
 sc2_data_links:'data_links',sc2_check_resources:'check_resources',sc2_audit_data:'audit_data',
 sc2_doctor:'doctor',sc2_query_audit:'query_audit',sc2_find_object_uses:'find_object_uses',sc2_compare_audits:'compare_audits',
};
export const nativeJobControls=['sc2_job_status','sc2_job_wait','sc2_job_cancel'] as const;
export const nativeJobTerminal=new Set(['SUCCEEDED','FAILED','CANCELLED','TIMED_OUT','INTERRUPTED']);
const nativeJobStates=new Set(['QUEUED','RUNNING',...nativeJobTerminal]);
export interface NativeSource {absolute:string;sha256:string}
export interface NativeBackgroundBinding {
 id:string;operation:NativeJobOperation;state:string;sources:NativeSource[];snapshots:NativeSource[];
 submissionReport:string;lastReport:string;terminalReport?:string;mutatesEditor:boolean;
}
export const nativeDocumentFree=(operation:string)=>['doctor','query_audit','find_object_uses','compare_audits'].includes(operation);
export const nativeFileOnly=(operation:string)=>['list_map_cameras','search_objects'].includes(operation);
export function nativeSubmission(args:Record<string,unknown>){
 if(Object.keys(args).some(key=>!['operation','arguments','timeout_seconds'].includes(key)))throw Error('NATIVE_JOB_SUBMISSION_ARGUMENTS: put operation arguments inside arguments');
 if(!(nativeJobOperations as readonly unknown[]).includes(args.operation))throw Error('NATIVE_JOB_OPERATION_NOT_ALLOWED');
 if(args.arguments!==undefined&&(!args.arguments||typeof args.arguments!=='object'||Array.isArray(args.arguments)))throw Error('NATIVE_JOB_ARGUMENT_OBJECT_REQUIRED');
 const input=structuredClone((args.arguments??{}) as Record<string,unknown>);
 if('output' in input||'overwrite' in input)throw Error('NATIVE_OUTPUT_OWNED: background artifacts are written inside this job');
 if('arguments' in input||'operation' in input||'job_id' in input)throw Error('NATIVE_JOB_NESTED_CONTROL_REFUSED');
 if(args.timeout_seconds!==undefined&&(typeof args.timeout_seconds!=='number'||!Number.isFinite(args.timeout_seconds)||args.timeout_seconds<1||args.timeout_seconds>14400))throw Error('NATIVE_JOB_TIMEOUT_RANGE');
 return {operation:args.operation as NativeJobOperation,input,timeout:args.timeout_seconds as number|undefined};
}
export function nativeControl(method:string,args:Record<string,unknown>){
 if(Object.keys(args).some(key=>!['job_id',...(method==='sc2_job_wait'?['wait_ms']:[])].includes(key)))throw Error('NATIVE_JOB_CONTROL_ARGUMENTS');
 if(typeof args.job_id!=='string'||!/^[a-f0-9]{32}$/.test(args.job_id))throw Error('NATIVE_JOB_ID_INVALID');
 if(args.wait_ms!==undefined&&(!Number.isInteger(args.wait_ms)||Number(args.wait_ms)<0||Number(args.wait_ms)>30000))throw Error('NATIVE_JOB_WAIT_RANGE');
 return {job_id:args.job_id,...(method==='sc2_job_wait'?{wait_ms:args.wait_ms??1000}:{})};
}
export function nativeJobIdentity(value:Record<string,any>,expected?:NativeBackgroundBinding){
 if(typeof value.jobId!=='string'||!/^[a-f0-9]{32}$/.test(value.jobId)||!nativeJobStates.has(value.status))throw Error('NATIVE_JOB_RESPONSE_UNCONFIRMED');
 if(expected&&(value.jobId!==expected.id||value.operation!==expected.operation))throw Error('NATIVE_JOB_RESPONSE_IDENTITY_MISMATCH');
 return {id:value.jobId as string,state:value.status as string};
}
export function observeNativeJob(binding:NativeBackgroundBinding,value:Record<string,any>,report:string){
 const next=nativeJobIdentity(value,binding);
 if(nativeJobTerminal.has(binding.state)&&next.state!==binding.state){
  if(nativeJobTerminal.has(next.state))throw Error('NATIVE_JOB_TERMINAL_STATE_CONFLICT');
  return; // A slower concurrent status reply must not regress a terminal result.
 }
 if(binding.state==='RUNNING'&&next.state==='QUEUED')return;
 binding.state=next.state;binding.lastReport=report;
 if(nativeJobTerminal.has(binding.state))binding.terminalReport=report;
}

/** Native completeness and bounded returned pages are deliberately separate. */
export function nativeExtendedSummary(value:Record<string,any>){
 const fields=['outcome','errorInfo','reportId','report_id','indexArtifact','projectRevision','projectRevisionComplete','dependencyManifest','nativeResolvedPhysicalPathsVerified','beforeReportId','afterReportId','adapterComparable','comparable','sameEditorAdapter','sameProjectRevision','before','after','fullObservations','totalChanges','section','payloadOmitted','graphicsReady','editorStarted','complete','catalog','objectId','object_id','fieldCount','totalFields','fieldOffset','fieldLimit','field_offset','field_limit','offset','limit','nextOffset','total','totalMatches','totalObjects','count','dataSpace','selectionVerified','effectiveValuesVerified','dataArtifact','xmlArtifact','reportArtifact','resourceValidationPassed','resourceScope','previewRequested','assetLookup','sourceUnchanged','sourceSha256','mapRevision','output','sourceBytes','scope','editorRequired','coordinateMeaning','catalogTraversalComplete','referenceAndFileValidationComplete','allObservedTypedTargetsPresent','validationPassed','counts','objectsArtifact','findingsArtifact'];
 fields.push('fieldValuesRecorded','fieldValueCoverage','fieldValueEncodingVersion','comparisonCoverageComplete');
 const result:Record<string,unknown>={};
 for(const key of fields)if(Object.hasOwn(value,key)&&value[key]!==undefined)result[key]=Buffer.byteLength(JSON.stringify(value[key]))<=2000?value[key]:nativeReportPage(value,'/'+key,0,1);
 for(const key of ['fields','relatedObjects','objects','cameras','resourceErrors','checks','catalogs','findings','dataSources','coverage','items','uses','changes','added','removed','modified','checks'])if(Object.hasOwn(value,key))result[key+'Page']=nativeReportPage(value,'/'+key,0,8);
 const rows=Array.isArray(value.items)?value.items:Array.isArray(value.changes)?value.changes:undefined;
 if(rows&&rows.length>8){result.nativeNextOffset=value.nextOffset;result.nextOffset=Number(value.offset??0)+8;result.inlineReturned=8;result.nativeReturned=rows.length;result.responseTruncated=true;}
 return result;
}
