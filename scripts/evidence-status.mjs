// Read-only inventory of digest-bound verification records. No native execution.
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath,URL} from 'node:url';
import {readEvidenceInventory} from '../dist/modules/testing/evidenceInventory.js';
const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
const root=path.resolve(option('--root')??fileURLToPath(new URL('../',import.meta.url)));
try{
 const report=await readEvidenceInventory(root,option('--index')??'docs/verification/index.json',{details:args.includes('--details')});
 process.stdout.write(JSON.stringify(report)+'\n');
 if(args.includes('--require-ready')&&!report.roadmapReady)process.exitCode=2;
}catch(error){process.stdout.write(JSON.stringify({integrity:false,roadmapReady:false,error:String(error),scope:'Index/read/digest failure; no native execution'})+'\n');process.exitCode=1;}
