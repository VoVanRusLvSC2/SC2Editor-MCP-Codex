import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

test('M29 M30 real stdio profiles and Data/GUI workflows', {timeout:60000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-stdio-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const dataFile='Base.SC2Data/GameData/EffectData.xml';await fs.mkdir(path.join(root,path.dirname(dataFile)),{recursive:true});
 const data='<Catalog><CEffectDamage id="AuditDamage"/><CEffectSet id="AuditSet"><EffectArray value="AuditDamage"/></CEffectSet></Catalog>';
 await fs.writeFile(path.join(root,dataFile),data);await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="Local"><Root/></Library></TriggerData>');
 const measures:Array<Record<string,unknown>>=[];
 for(const profile of ['all','data','script','minimal','focused-data','focused-script','focused-authoring']){
  const child=spawn(process.execPath,['dist/index.js'],{env:{...process.env,SC2_UI_ROOT:root,SC2_MCP_PROFILE:profile,SC2_MCP_MODULES:''},stdio:['pipe','pipe','pipe']});
  const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();let buffer='',stderr='',id=0,requestBytes=0,responseBytes=0,calls=0;
  child.stderr.on('data',d=>{stderr+=d;});child.stdout.on('data',d=>{buffer+=d;let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);responseBytes+=Buffer.byteLength(line)+1;try{const r=JSON.parse(line),p=pending.get(r.id);if(p){pending.delete(r.id);if(r.error)p.reject(new Error(JSON.stringify(r.error)));else p.resolve(r.result);}}catch(e){for(const p of pending.values())p.reject(e as Error);}}});
  child.on('exit',()=>{for(const p of pending.values())p.reject(new Error('Server exit: '+stderr));});
  const call=(method:string,params:unknown):Promise<any>=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});const line=JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n';requestBytes+=Buffer.byteLength(line);calls++;child.stdin.write(line);});
  const tool=async(name:string,args:unknown={})=>{const r=await call('tools/call',{name,arguments:args});return {error:r.isError===true,value:r.isError===true ? r.content[0].text : JSON.parse(r.content[0].text)};};
  const begin=performance.now();
  try{
   await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'hardening-test',version:'1'}});
   child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
   const listed=await call('tools/list',{}),names=listed.tools.map((x:{name:string})=>x.name);
   assert.ok(names.includes('modkit.capabilities'));
   const cap=await tool('modkit.capabilities');assert.equal(cap.error,false);
   const coldMs=performance.now()-begin;
   if(profile==='minimal')assert.deepEqual(names,['modkit.save','modkit.discard','modkit.capabilities']);
   if(profile.startsWith('focused-'))assert.equal(names.some((x:string)=>x.startsWith('ui.')),false);
   if(profile==='focused-authoring'){
    assert.ok(names.includes('trigger.labels')&&names.includes('trigger.label_of'));
    const labels=await tool('trigger.labels',{query:'Debug'});assert.equal(labels.error,false);assert.ok(labels.value.labels.some((label:{id:string})=>label.id==='04C6B670'));
    const cinematic=await tool('trigger.describe_function',{name:'CinematicMode'});assert.equal(cinematic.error,false);assert.equal(cinematic.value.id,'E92E544E');
    const rejected=await tool('data.apply',{file:dataFile,operations:[{op:'object.delete',object:'AuditDamage'}]});assert.equal(rejected.error,true);
    const renamed=await tool('data.apply',{file:dataFile,operations:[{op:'object.rename',object:'AuditDamage',newId:'Renamed',updateReferences:true}],dryRun:false});assert.equal(renamed.error,false);
    const refs=await tool('data.references',{id:'Renamed',domain:'Effect',direction:'incoming'});assert.equal(refs.value.total,1);
    assert.equal(await fs.readFile(path.join(root,dataFile),'utf8'),data);
    const invalid=await tool('data.references',{limit:-1});assert.equal(invalid.error,true);
    const plan=await tool('trigger.plan',{create:{library:'Local',identifier:'Start'},calls:[{kind:'Event',function:'TriggerAddEventMapInit',args:{}},{kind:'Action',function:'CinematicMode',args:{C016C6E2:{kind:'preset',id:'00000538'},'8F9FC828':{kind:'nativeCall',function:'PlayerGroupAll'},'5755FC77':{kind:'literal',type:'fixed',value:0}}},{kind:'Action',function:'GlobalCinematicSetting',args:{E095DC31:{kind:'preset',id:'00000545'}}},{kind:'Action',function:'DialogDestroyAll',args:{}}]});assert.equal(plan.error,false);
    assert.equal((await tool('trigger.apply',{planId:plan.value.planId})).error,false);
    assert.equal((await tool('trigger.inspect')).value.count,0);
    assert.equal((await tool('trigger.apply',{planId:plan.value.planId,dryRun:false})).error,false);
    assert.equal((await tool('trigger.validate')).value.valid,true);
    assert.equal((await tool('trigger.inspect')).value.count,1);
    await tool('trigger.discard');assert.equal((await tool('trigger.inspect')).value.count,0);
    assert.equal((await tool('trigger.apply',{planId:plan.value.planId,dryRun:false})).error,false);
    assert.equal((await tool('trigger.save',{backup:false})).error,false);
    assert.match(await fs.readFile(path.join(root,'Triggers'),'utf8'),/<Identifier>Start<\/Identifier>/);
   }
   measures.push({profile,tools:names.length,toolsListJsonBytes:Buffer.byteLength(JSON.stringify(listed)),requestBytes,responseBytes,calls,coldMs:Number(coldMs.toFixed(2)),elapsedMs:Number((performance.now()-begin).toFixed(2)),tokens:'NOT_MEASURED'});
  }finally{child.stdin.end();await new Promise<void>(resolve=>{const timer=setTimeout(()=>child.kill(),3000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
 }
 await fs.mkdir('generated/mcp-hardening',{recursive:true});await fs.writeFile('generated/mcp-hardening/stdio-measurements.json',JSON.stringify(measures,null,2)+'\n');
 t.diagnostic(JSON.stringify(measures));
});
