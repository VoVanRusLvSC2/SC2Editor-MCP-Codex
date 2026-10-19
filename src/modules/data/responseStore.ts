import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';

const MAX_REPORT_BYTES=128*1024*1024;
const MAX_RESPONSE_ITEMS=8;
type JsonObject=Record<string,unknown>;
const object=(value:unknown):JsonObject=>value&&typeof value==='object'&&!Array.isArray(value)?value as JsonObject:{};
const array=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const brief=(value:unknown,max=4000)=>{const text=(typeof value==='string'?value:JSON.stringify(value))??String(value);return text.length<=max?value:text.slice(0,max)+'… [truncated; see data.report.page]';};
const diagnostic=(value:unknown)=>{const d=object(value);return Object.fromEntries(['level','severity','code','message','file','path'].filter(k=>d[k]!==undefined).map(k=>[k,brief(d[k])]));};

export function compactDataValidation(value:unknown,offset=0,limit=MAX_RESPONSE_ITEMS){
 const report=object(value),diagnostics=array(report.diagnostics);
 return {valid:report.valid,errors:report.errors,warnings:report.warnings,levels:report.levels,
  validationScope:report.validationScope,semanticCoverage:report.semanticCoverage,
  diagnosticsTotal:diagnostics.length,diagnosticsOffset:offset,
  diagnostics:diagnostics.slice(offset,offset+limit).map(diagnostic),
  nextOffset:offset+limit<diagnostics.length?offset+limit:null};
}

export function compactDataBatch(value:unknown){
 const report=object(value),validation=report.validation,files=array(report.files),applied=array(report.applied),authoring=array(report.authoring);
 return {accepted:report.accepted,dryRun:report.dryRun,staged:report.staged,transactionId:report.transactionId,
  filesTotal:files.length,files:files.slice(0,MAX_RESPONSE_ITEMS).map(f=>{const row=object(f);return Object.fromEntries(['file','path','sha256','beforeSha256','afterSha256','bytes','changed'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));}),
  appliedTotal:applied.length,applied:applied.slice(0,MAX_RESPONSE_ITEMS).map(v=>brief(v)),aliases:report.aliases,
  validation:validation?compactDataValidation(validation):undefined,
  authoringTotal:authoring.length,authoring:authoring.slice(0,MAX_RESPONSE_ITEMS).map(v=>{const row=object(v),a=object(row.authoring);return {file:row.file,accepted:a.accepted,status:a.status,diagnosticsTotal:array(a.diagnostics).length,diagnostics:array(a.diagnostics).slice(0,3).map(diagnostic)};}),
  editor:report.editor,runtime:report.runtime};
}

/** Content-addressed local snapshots keep giant validation graphs off the MCP wire. */
export class DataResponseStore {
 readonly directory:string;
 constructor(root:string){this.directory=path.join(root,'.sc2mcp-output','data-reports');}
 async save(value:unknown){const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>MAX_REPORT_BYTES)throw Error('DATA_REPORT_TOO_LARGE');const reportId=createHash('sha256').update(bytes).digest('hex');await fs.mkdir(this.directory,{recursive:true});const file=path.join(this.directory,reportId+'.json.gz');try{await fs.access(file);}catch{await fs.writeFile(file,gzipSync(bytes));}return {reportId,reportFile:file,reportBytes:bytes.length};}
 async page(reportId:string,section:'diagnostics'|'validation.diagnostics'|'files'|'applied'|'authoring',offset:number,limit:number){
  if(!/^[0-9a-f]{64}$/.test(reportId))throw Error('DATA_REPORT_ID_INVALID');
  const bytes=gunzipSync(await fs.readFile(path.join(this.directory,reportId+'.json.gz')),{maxOutputLength:MAX_REPORT_BYTES});
  if(createHash('sha256').update(bytes).digest('hex')!==reportId)throw Error('DATA_REPORT_HASH_MISMATCH');
  const report=object(JSON.parse(bytes.toString('utf8'))),value=section==='validation.diagnostics'?object(report.validation).diagnostics:report[section];
  const rows=array(value),items=rows.slice(offset,offset+limit).map(item=>{const text=JSON.stringify(item);return text.length<=16000?item:{truncated:true,characters:text.length,preview:text.slice(0,4000),reportFile:path.join(this.directory,reportId+'.json.gz')};});
  return {reportId,section,total:rows.length,offset,items,nextOffset:offset+limit<rows.length?offset+limit:null,snapshot:true};
 }
}
