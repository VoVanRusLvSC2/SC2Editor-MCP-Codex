// Current release selection; retained historical assertions have their own command.
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath,URL} from 'node:url';
import {readReleaseAcceptance} from '../dist/modules/testing/releaseAcceptance.js';
const args=process.argv.slice(2);
try{
 let root=fileURLToPath(new URL('../',import.meta.url)),index='docs/verification/index.json',integrityOnly=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--integrity-only')integrityOnly=true;
  else if(args[i]==='--root'||args[i]==='--index'){const value=args[++i];if(!value||value.startsWith('--'))throw Error('EVIDENCE_OPTION_VALUE_REQUIRED');if(args[i-1]==='--root')root=path.resolve(value);else index=value;}
  else throw Error('EVIDENCE_OPTION_UNKNOWN: '+args[i]);
 }
 const result=await readReleaseAcceptance(root,index);
 process.stdout.write(JSON.stringify({...result,ok:integrityOnly||result.ready,mode:integrityOnly?'integrity_only':'required_release_acceptance'})+'\n');
 if(!integrityOnly&&!result.ready)process.exitCode=2;
}catch(error){process.stdout.write(JSON.stringify({ok:false,integrity:false,ready:false,error:String(error),scope:'Read/digest/schema failure; no native execution'})+'\n');process.exitCode=1;}
