import {Buffer} from "node:buffer";
import {setTimeout,clearTimeout} from "node:timers";
import process from "node:process";
import console from "node:console";
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
const baseline=process.argv.find(a=>a.startsWith('--baseline='))?.slice(11);
if(!baseline)throw new Error('Pass --baseline=<audit checkout path>; baseline is read-only');
const variants=[{name:'baseline',entry:path.join(path.resolve(baseline),'dist/index.js'),profiles:{data:'data',gui:'script',script:'script'}},{name:'current',entry:path.resolve('dist/index.js'),profiles:{data:'focused-data',gui:'focused-script',script:'focused-script'}}];
const rows=[];
for(const variant of variants)for(const scenario of ['linked-data','rename-external','gui-graft','gui-author','galaxy-body-connect']){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mcp-benchmark-'));
 await fs.mkdir(path.join(root,'Base.SC2Data/GameData'),{recursive:true});
 const sourceData='<Catalog><CUnit id="AuditSpawn"/></Catalog>';
 await fs.writeFile(path.join(root,'Base.SC2Data/GameData/UnitData.xml'),sourceData);
 const target='<TriggerData><Library Id="810D62ED"><Element Type="Trigger" Id="AAAA0001"><Identifier>Target</Identifier><Action Type="FunctionCall" Library="810D62ED" Id="AAAA0002"/></Element><Element Type="FunctionCall" Id="AAAA0002"><ScriptCode>Old();</ScriptCode></Element></Library></TriggerData>';
 await fs.writeFile(path.join(root,'Triggers'),target);
 await fs.writeFile(path.join(root,'source.xml'),'<TriggerData><Library Id="810D62ED"><Element Type="Trigger" Id="BBBB0001"><Identifier>Source</Identifier><Action Type="FunctionCall" Library="810D62ED" Id="BBBB0002"/></Element><Element Type="FunctionCall" Id="BBBB0002"><ScriptCode>New();</ScriptCode></Element></Library></TriggerData>');
 await fs.writeFile(path.join(root,'MapScript.galaxy'),'void InitMap(){}');
 await fs.writeFile(path.join(root,'a.galaxy'),scenario==='rename-external'?'void Run(){UnitCreate(1,"AuditSpawn",0,1,null,0);}':'void CustomInit(){}');
 const profile=scenario.includes('data')||scenario==='rename-external'?variant.profiles.data:scenario.includes('gui')?variant.profiles.gui:variant.profiles.script;
 const child=spawn(process.execPath,[variant.entry],{env:{...process.env,SC2_UI_ROOT:root,SC2_MCP_PROFILE:profile,SC2_MCP_MODULES:''},cwd:root,stdio:['pipe','pipe','pipe']});
 const pending=new Map();let buffer='',id=0,requests=0,responses=0,toolCalls=0;child.stderr.resume();
 child.stdout.on('data',d=>{buffer+=d;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);responses+=Buffer.byteLength(line)+1;try{const r=JSON.parse(line),p=pending.get(r.id);if(p){clearTimeout(p.timer);pending.delete(r.id);if(r.error)p.reject(new Error(JSON.stringify(r.error)));else p.resolve(r.result);}}catch(e){for(const p of pending.values())p.reject(e);}}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>reject(new Error('MCP_TIMEOUT')),15000);pending.set(n,{resolve,reject,timer});const line=JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n';requests+=Buffer.byteLength(line);child.stdin.write(line);});
 const call=async(name,args={})=>{toolCalls++;const r=await rpc('tools/call',{name,arguments:args});if(r.isError)throw new Error(r.content[0].text);return JSON.parse(r.content[0].text);};
 const save=async(file)=>call(variant.name==='baseline'?'ui.save':'modkit.save',{file,backup:false});
 const start=performance.now();let correct=false,available=true,error;
 try{
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'same-scenario-benchmark',version:'1'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const list=await rpc('tools/list',{}),coldMs=performance.now()-start;
  const listBytes=Buffer.byteLength(JSON.stringify(list));requests=0;responses=0;const begin=performance.now();
  if(scenario==='linked-data'){
   await call('data.context',{file:'Base.SC2Data/GameData/EffectData.xml',includeReferences:false,includeInherited:false});
   await call('data.apply',{file:'Base.SC2Data/GameData/EffectData.xml',operations:[{op:'object.create',ctype:'CEffectDamage',id:'Damage'},{op:'object.create',ctype:'CEffectSet',id:'Set',fields:[{name:'EffectArray',value:'Damage'}]}],dryRun:false});await save('Base.SC2Data/GameData/EffectData.xml');
   const xml=await fs.readFile(path.join(root,'Base.SC2Data/GameData/EffectData.xml'),'utf8');correct=xml.includes('id="Damage"')&&xml.includes('EffectArray value="Damage"');
  }else if(scenario==='rename-external'){
   await call('data.context',{ids:['AuditSpawn'],includeRaw:false});await call('data.apply',{operations:[{op:'object.rename',object:'AuditSpawn',newId:'Renamed',updateReferences:true}],dryRun:false});await save('Base.SC2Data/GameData/UnitData.xml');correct=(await fs.readFile(path.join(root,'a.galaxy'),'utf8')).includes('"Renamed"');
  }else if(scenario==='gui-graft'){
   await call('trigger.inspect');await call('trigger.graft',{sourceFile:'source.xml',sourceTrigger:'Source',targetTrigger:'Target',kind:'Action',index:0,dryRun:false});await call('trigger.save',{backup:false});const get=await call('trigger.get',{identifier:'Target'});correct=get.references.map(r=>r.id).join(',')==='AAAA0002,BBBB0002';
  }else if(scenario==='gui-author'){
   if(!list.tools.some(t=>t.name==='trigger.plan')){available=false;error='Tool not implemented in baseline';}
   else{const p=await call('trigger.plan',{targetTrigger:'Target',calls:[{kind:'Action',function:'DialogDestroyAll',args:{}}]});await call('trigger.apply',{planId:p.planId,dryRun:false});await call('trigger.save',{backup:false});correct=(await call('trigger.validate')).valid;}
  }else{
   const p=await call('script.plan',{operations:[{op:'function.body',file:'a.galaxy',name:'CustomInit',body:' int x = 1; '}]});await call('script.apply',{planId:p.planId,dryRun:false});await call('script.save',{file:'a.galaxy',backup:false});const connect=await call('script.connect',{file:'a.galaxy',init:'CustomInit'});await call('script.apply',{planId:connect.planId,dryRun:false});await call('script.save',{file:'MapScript.galaxy',backup:false});correct=(await fs.readFile(path.join(root,'a.galaxy'),'utf8')).includes('int x = 1;')&&(await fs.readFile(path.join(root,'MapScript.galaxy'),'utf8')).includes('CustomInit();');
  }
  const elapsedMs=performance.now()-begin;const beforeWarmRequests=requests,beforeWarmResponses=responses;const warmStart=performance.now();
  if(available)await call(scenario.startsWith('gui')?'trigger.inspect':scenario==='galaxy-body-connect'?'script.inspect':'data.context',{});
  rows.push({variant:variant.name,scenario,profile,tools:list.tools.length,toolsListJsonBytes:listBytes,available,correct,error,toolCalls:toolCalls-(available?1:0),requestBytes:beforeWarmRequests,responseBytes:beforeWarmResponses,elapsedMs:Number(elapsedMs.toFixed(2)),coldStartupMs:Number(coldMs.toFixed(2)),warmReadMs:available?Number((performance.now()-warmStart).toFixed(2)):null,warmReadRequestBytes:requests-beforeWarmRequests,warmReadResponseBytes:responses-beforeWarmResponses,modelTokens:'NOT_AVAILABLE'});
 }catch(e){rows.push({variant:variant.name,scenario,available,correct:false,error:String(e)});}
 finally{for(const p of pending.values())clearTimeout(p.timer);child.stdin.end();await new Promise(resolve=>{const timer=setTimeout(()=>child.kill(),1000);child.once('exit',()=>{clearTimeout(timer);resolve();});});await fs.rm(root,{recursive:true,force:true});}
}
await fs.mkdir('generated/mcp-hardening',{recursive:true});await fs.writeFile('generated/mcp-hardening/scenario-measurements.json',JSON.stringify({method:'Same isolated fixtures and honest batch operations; process cold startup and subsequent warm read measured separately. Baseline correctness failures are retained. No model tokens measured.',rows},null,2)+'\n');console.log(JSON.stringify(rows,null,2));
