import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {GalaxyDocument,editSpans} from '../src/modules/script/document.js';
const files=process.argv.slice(2);if(!files.length)throw new Error('Galaxy corpus paths required');const items=[];
for(const file of files){const source=await fs.readFile(file,'utf8'),start=performance.now(),d=new GalaxyDocument(source);items.push({file,bytes:Buffer.byteLength(source),sha256:createHash('sha256').update(source).digest('hex'),symbols:d.symbols.length,calls:d.calls().length,includes:d.includes.length,diagnostics:d.diagnostics,unchangedExact:editSpans(source,[])===source,milliseconds:performance.now()-start});}
const report={version:JSON.parse(await fs.readFile('package.json','utf8')).version,status:items.every(x=>x.unchangedExact&&!x.diagnostics.some(d=>d.severity==='error'))?'PASS':'FAIL',scope:'Lexical/structural parsing and unchanged source only; no compiler/runtime equivalence claim',items};await fs.writeFile('generated/galaxy-corpus-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.status==='FAIL')process.exitCode=1;
