/* global process, Buffer, setTimeout */
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const value=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const manifests=process.argv.flatMap((arg,i)=>arg==='--manifest'?[process.argv[i+1]]:[]);
const workspace=value('--workspace'),live=process.argv.includes('--live');
const entry=path.resolve(value('--entry')??path.join(project,'dist/index.js'));
const view=value('--view');if(process.argv.includes('--view')&&(!view||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(view)))throw Error('--view requires a manifest game.views ID');
const repeat=Number(value('--repeat')??1);if(!Number.isInteger(repeat)||repeat<1||repeat>10)throw Error('--repeat requires 1..10');
if(!workspace||!manifests.length||manifests.some(file=>!file||file.startsWith('--')))throw Error('Usage: node scripts/run-map-tests.mjs --workspace <directory> --manifest <relative.json> [--manifest <next.json>] [--entry <compiled-index.js>] [--live]');
const child=spawn(process.execPath,[entry],{cwd:project,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,SC2_UI_ROOT:path.resolve(workspace),SC2_MCP_PROFILE:'game',SC2_GAME_ALLOW_LAUNCH:live?'1':'0'}});
let id=0,buffer='',stderr='';const pending=new Map();
child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-4096);});
child.stdout.setEncoding('utf8');child.stdout.on('data',b=>{buffer+=b;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line.trim())continue;const r=JSON.parse(line),p=pending.get(r.id);if(p){pending.delete(r.id);if(r.error)p.reject(Error(JSON.stringify(r.error)));else p.resolve(r.result);}}});
child.on('exit',code=>{for(const p of pending.values())p.reject(Error('MCP exited '+code+': '+stderr));pending.clear();});
child.on('error',e=>{for(const p of pending.values())p.reject(e);pending.clear();});
function rpc(method,params){return new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});}
async function call(name,args){const r=await rpc('tools/call',{name,arguments:args});const text=r.content.find(c=>c.type==='text')?.text;const b=JSON.parse(text??'{}');if(r.isError)throw Error(JSON.stringify(b));const image=r.content.find(c=>c.type==='image');if(image){const bytes=Buffer.from(image.data,'base64');if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid native PNG');b.deliveredImageSha256=createHash('sha256').update(bytes).digest('hex');const expected=b.checks?.find(c=>c.id===(args.viewId?'view:'+args.viewId:'game.capture'))?.evidence?.sha256;if(expected&&expected!==b.deliveredImageSha256)throw Error('Image digest mismatch');}return b;}
try{
 await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'map-test-runner',version:'1'}});
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 for(const manifest of manifests){
 const plan=await call('project.test.plan',{file:manifest});process.stdout.write(JSON.stringify({stage:'plan',manifest,...plan})+'\n');
 if(live){
  if(!plan.ready)throw Error('Test plan has required unresolved prerequisites');
  for(let iteration=1;iteration<=repeat;iteration++){
   const job=await call('project.test.run',{planId:plan.planId});let last='';
   while(true){
    const s=await call('project.test.status',{jobId:job.jobId}),summary=JSON.stringify({iteration,jobId:s.jobId,state:s.state,phase:s.phase,...(s.nativeProgress?{nativePhase:s.nativeProgress.phase,nativeState:s.nativeProgress.state,deadlineExceeded:s.nativeProgress.deadlineExceeded}:{})});
    if(summary!==last){process.stdout.write(summary+'\n');last=summary;}
    if(s.state==='completed'||s.state==='cancelled'){
     const report=await call('project.test.report',{jobId:job.jobId,limit:32});
     let next=report.nextOffset;while(next!==null){const page=await call('project.test.report',{jobId:job.jobId,offset:next,limit:32});if(page.nextOffset!==null&&page.nextOffset<=next)throw Error('Test report pagination did not advance');report.checks.push(...page.checks);next=page.nextOffset;}
     const selected=report.checks.find(c=>c.id===(view?'view:'+view:'game.capture'));
     if((process.argv.includes('--image')||view)&&selected?.status==='passed'){
      const delivered=await call('project.test.report',{jobId:job.jobId,limit:32,includeImage:true,...view?{viewId:view}:{}});
      if(delivered.deliveredImageSha256!==selected.evidence?.sha256)throw Error('Selected image digest mismatch');report.deliveredImageSha256=delivered.deliveredImageSha256;
     }else if(view)throw Error('Requested view has no passed native image: '+view);
     process.stdout.write(JSON.stringify(process.argv.includes('--verbose')?report:{iteration,jobId:report.jobId,outcome:report.outcome,current:report.current,sourceSha256:report.sourceSha256,report:report.report,deliveredImageSha256:report.deliveredImageSha256,checks:report.checks.map(({id,status,reason})=>({id,status,reason}))})+'\n');
     if(report.outcome!=='passed'||!report.evidenceValidForCurrentInputs)process.exitCode=1;
     break;
    }
    await new Promise(r=>setTimeout(r,1000));
   }
  }
 }
 }
}catch(e){process.stderr.write(String(e)+'\n');process.exitCode=1;}
finally{child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve);});}
