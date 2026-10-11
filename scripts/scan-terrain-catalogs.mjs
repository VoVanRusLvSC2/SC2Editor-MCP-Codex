#!/usr/bin/env node
/* global process, console, TextDecoder */
/** Scan already-extracted CASC / local SC2GameData files. Does NOT read CASC storage directly. */
import {lstatSync, realpathSync, readdirSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve, join, relative, basename, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectSurfaceCatalog, catalogRecordKind, catalogTokenDeclarations, inspectCatalogReferences,
  inspectCliffDoodadHeightCodes, inspectAuthoredCliffHeights} from '../dist/modules/terrain/surface/core/index.js';
const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i+=2){
  if(!['--root','--out'].includes(args[i])||!args[i+1]||Object.hasOwn(options,args[i])) throw new Error('Usage: catalog-scan.mjs --root EXTRACTED_ROOT --out REPORT.json');
  options[args[i]]=args[i+1];
}
if(!options['--root']||!options['--out']) throw new Error('Both --root and --out are required');
const root=realpathSync(resolve(options['--root'])), output=resolve(options['--out']);
if(!lstatSync(root).isDirectory()) throw new Error('INPUT_ROOT_MUST_BE_DIRECTORY');
// No overwrite, including an accidental attempt to write into an input catalog.
try {lstatSync(output);throw new Error('OUTPUT_ALREADY_EXISTS');} catch(e){if(e.code!=='ENOENT')throw e;}
const targets=new Set(['Water','TextureSheet','Texture','Terrain','TerrainTex','TerrainObject','Cliff','CliffMesh','Tile','PhysicsMaterial','Model','Actor'].map(s=>s+'Data.xml'));
const report={schema:'sc2-surface-catalog-scan/1',scope:'Only listed basenames under the supplied extracted root',
  selection:[...targets],cascStorageRead:false,dependencyOrderResolved:false,inheritanceResolved:false,
  assetExistenceChecked:false,engineValidated:false,inputBytes:0,documents:[],errors:[],skipped:[]};
let visited=0, selected=0;
function walk(dir,depth=0){
  if(depth>64)throw new Error('DIRECTORY_DEPTH_BUDGET');
  for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    if(++visited>200000)throw new Error('FILESYSTEM_ENTRY_BUDGET');
    const path=join(dir,entry.name), rel=relative(root,path).replaceAll('\\','/');
    const st=lstatSync(path);
    if(st.isSymbolicLink()){report.skipped.push({path:rel,reason:'SYMLINK_NOT_FOLLOWED'});continue;}
    if(st.isDirectory()){if(['.git','node_modules'].includes(entry.name))continue;walk(path,depth+1);continue;}
    if(!st.isFile()||!targets.has(basename(path)))continue;
    if(++selected>4096)throw new Error('CATALOG_FILE_COUNT_BUDGET');
    if(st.size>8*1024*1024){report.errors.push({path:rel,error:'XML_INPUT_BUDGET_EXCEEDED'});continue;}
    report.inputBytes+=st.size;
    if(report.inputBytes>256*1024*1024)throw new Error('TOTAL_CATALOG_BYTES_BUDGET');
    try{
      const bytes=readFileSync(path), xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      const encoding=xml.match(/^\s*<\?xml\s[^>]*encoding\s*=\s*["']([^"']+)/i)?.[1]?.toLowerCase();
      if(encoding&&!['utf-8','utf8','us-ascii','ascii'].includes(encoding))throw new Error('UNSUPPORTED_DECLARED_ENCODING:'+encoding);
      const parsed=inspectSurfaceCatalog(xml);
      const records=parsed.entries.map((entry,ordinal)=>{
        const details={ordinal,recordKind:catalogRecordKind(entry),entry,tokens:catalogTokenDeclarations(entry),references:inspectCatalogReferences(entry)};
        if(entry.type==='CCliffMesh'){
          try{details.authoredCliffHeights=inspectAuthoredCliffHeights(entry);}catch(e){details.inspectionError=String(e);}
        }
        if(entry.type==='CCliffDoodad'&&entry.fields.some(f=>f.name==='HeightCodes')){
          try{details.heightCodes=inspectCliffDoodadHeightCodes(entry);}catch(e){details.inspectionError=String(e);}
        }
        return details;
      });
      report.documents.push({path:rel,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,records});
    }catch(e){report.errors.push({path:rel,error:String(e)});}
  }
}
try{walk(root);}catch(e){report.errors.push({path:'<scan>',error:String(e)});}
report.selectedFiles=selected; report.processedFiles=report.documents.length;
report.status=report.errors.length||report.skipped.length?'PARTIAL_SELECTED_SCAN':'SELECTED_SCAN_FINISHED';
report.completenessClaim='No claim about all SC2 catalogs, active dependencies, engine fields, or unselected paths.';
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,processedFiles:report.processedFiles,selectedFiles:report.selectedFiles,errors:report.errors.length,skipped:report.skipped.length,output},null,2));
process.exitCode=report.errors.length||report.skipped.length?2:0;
