/* global process, Buffer */
/** Real outer MCP verifier. SC2 is launched only with --live --map <saved map>. */
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const value=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const live=process.argv.includes('--live'),map=value('--map'),root=path.resolve(value('--workspace')??project);
const nativeUi=process.argv.includes('--native-ui'),extended=process.argv.includes('--extended');
if((nativeUi||extended)&&!live)throw Error('--native-ui/--extended require explicit --live');
if(live&&!map)throw Error('--live requires --map');
if(!process.env.SC2_GAME_TOOLKIT_HOME)throw Error('SC2_GAME_TOOLKIT_HOME is required');
const directory=path.join(project,'work','native-game-verification',randomUUID());await fs.mkdir(directory,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const source=live?path.resolve(root,map):undefined,before=source?hash(await fs.readFile(source)):null;
const child=spawn(process.execPath,[path.join(project,'dist/index.js')],{cwd:project,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,SC2_UI_ROOT:root,SC2_MCP_PROFILE:'game',SC2_GAME_ALLOW_LAUNCH:live?'1':'0'}});
const pending=new Map();let sequence=0,buffer='',stderr='';const steps=[];
const exited=new Promise(resolve=>child.once('exit',resolve));
child.stderr.on('data',b=>{stderr+=b;});
child.on('error',e=>{for(const p of pending.values())p.reject(e);pending.clear();});
child.on('exit',code=>{for(const p of pending.values())p.reject(Error('MCP exited '+code));pending.clear();});
child.stdout.setEncoding('utf8');child.stdout.on('data',b=>{buffer+=b;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;const r=JSON.parse(line),p=pending.get(r.id);if(!p)continue;pending.delete(r.id);if(r.error)p.reject(Error(JSON.stringify(r.error)));else p.resolve(r.result);}});
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
const body=r=>JSON.parse(r.content.find(c=>c.type==='text').text);
async function call(name,args={},allowedStatuses=[]){const result=await rpc('tools/call',{name,arguments:args});steps.push({name,args,result:{...result,content:result.content?.map(c=>c.type==='image'?{type:'image',mimeType:c.mimeType,sha256:hash(Buffer.from(c.data,'base64'))}:c)}});if(result.isError&&!allowedStatuses.includes(body(result).status))throw Error(JSON.stringify(body(result)));return result;}
const report={startedAt:new Date().toISOString(),mode:live?'live_private_game':'frontend_only',steps,sourceSha256:before};
try{
  report.server=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'native-game-verifier',version:'1'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const listed=await rpc('tools/list',{});report.tools=listed.tools.filter(t=>t.name.startsWith('game.')).map(t=>t.name);assert.equal(report.tools.length,5);
  const status=body(await call('game.status',{connect:true}));assert.equal(status.frontend.server.name,'sc2-game-toolkit');assert.equal(status.runtime.isError,false);assert.equal(body(status.runtime).attached,false);
  const operations=body(await call('game.tools'));assert.equal(operations.length,18);report.operationCount=operations.length;
  assert.equal(body(await call('game.tools',{name:'game.order'})).inputSchema.type,'object');
  if(nativeUi){const schema=body(await call('game.tools',{name:'game.ui.inspect'})).inputSchema.properties;assert.deepEqual(schema.scope.enum,['registered','native']);for(const name of ['name','path','text','visible_only'])assert.ok(schema[name]);report.nativeUiSchema=true;}
  if(live){
    const attached=body(await call('game.attach',{map,timeout:180}));assert.equal(attached.mapConfirmed,true);assert.equal(attached.hidden,true);report.handshake=true;
    await call('game.call',{method:'game.status'});
    await call('game.call',{method:'game.units.find',arguments:{limit:8}});
    const fixture=body(await call('game.call',{method:'game.fixture',arguments:{type:'Phoenix',owner:1,x:32,y:32}}));
    const unit=fixture.unit.id;assert.ok(unit);report.fixtureCreated=true;
    await call('game.call',{method:'game.units.inspect',arguments:{unit}});
    const selected=body(await call('game.call',{method:'game.selection.set',arguments:{units:[unit],player:1}}));assert.deepEqual(selected.selection,[unit]);report.selection=selected;
    await call('game.call',{method:'game.camera.set',arguments:{unit,player:1,distance:24}});
    const order=body(await call('game.call',{method:'game.order',arguments:{unit,action:'move',x:40,y:32}}));assert.equal(order.accepted,true);
    await call('game.call',{method:'game.wait',arguments:{condition:{kind:'at_point',unit,x:40,y:32,tolerance:1},timeout:12}});report.moveObserved=true;
    const ui=body(await call('game.call',{method:'game.ui.inspect',arguments:{limit:8}},['unsupported']));report.uiInspection={status:ui.status,reason:ui.reason??null};
    if(nativeUi){
      const inspect=async args=>body(await call('game.call',{method:'game.ui.inspect',arguments:{scope:'native',visible_only:true,...args}}));
      const menu=await inspect({name:'Menu',limit:2});assert.equal(menu.status,'ok');assert.equal(menu.truncated,true);assert.ok(menu.nextOffset>0);
      const next=await inspect({name:'Menu',offset:menu.nextOffset,limit:8});assert.equal(next.status,'ok');assert.ok(next.controls.length);assert.ok(next.controls.every(c=>!menu.controls.some(first=>first.id===c.id)));
      const button=next.controls.find(c=>c.name==='MenuButton'&&c.role==='button');assert.ok(button?.clickable&&button.visible&&button.enabled);assert.ok(button.bounds.right>button.bounds.left);
      const label=next.controls.find(c=>c.textAvailable&&c.text);assert.ok(label?.text);
      const textFiltered=await inspect({path:'GameUI',text:label.text,limit:8});assert.ok(textFiltered.controls.some(c=>c.text===label.text));
      const open=body(await call('game.call',{method:'game.ui.activate',arguments:{control:button.control}}));assert.equal(open.normalUIHandlerConfirmed,true);assert.equal(open.clickEvent.accepted,true);
      const returnPath='GameMenuDialogTemplate/MainPanel/ReturnButton/Button';
      const opened=await inspect({path:returnPath,name:'Button',limit:8}),resume=opened.controls.find(c=>c.role==='button'&&c.clickable);assert.ok(resume);
      const close=body(await call('game.call',{method:'game.ui.activate',arguments:{control:resume.control}}));assert.equal(close.normalUIHandlerConfirmed,true);assert.equal(close.clickEvent.accepted,true);
      const restored=await inspect({path:returnPath,limit:8});assert.equal(restored.total,0);
      report.nativeUi={status:'passed',pagination:true,textAndPathFilter:true,effectiveStateAndGeometry:true,normalOpenCloseHandlers:true,menuHiddenAfterResume:true};
    }
    await call('game.call',{method:'game.events'});
    const scenario=body(await call('game.call',{method:'game.test.run',arguments:{steps:[{method:'game.units.inspect',arguments:{unit},expect:{'unit.valid':true}},{method:'game.order',arguments:{unit,action:'stop'},expect:{accepted:true}}]}}));assert.equal(scenario.status,'passed');report.scenarioPassed=true;
    if(extended){
      const debug=body(await call('game.call',{method:'game.debug.inspect',arguments:{offset:0,limit:8}},['unsupported','inconclusive']));report.debugger={status:debug.status,coverage:debug.coverage??null};
      const recording=body(await call('game.call',{method:'game.record',arguments:{before_seconds:0.25,after_seconds:0.5,fps:4,audit_audio:false,action:{method:'game.order',arguments:{unit,action:'stop'}}}}));assert.equal(recording.status,'ok');report.recording={status:recording.status,video:recording.video??recording.path??null,audioChecked:false};
    }
    await call('game.call',{method:'game.diagnostics',arguments:{limit:32}});
    const capture=await call('game.call',{method:'game.capture',arguments:{include_ui:true}}),image=capture.content.find(c=>c.type==='image');assert.ok(image);
    const bytes=Buffer.from(image.data,'base64');assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));report.pngSha256=hash(bytes);await fs.writeFile(path.join(directory,'Game.png'),bytes);
    await call('game.call',{method:'game.fixture',arguments:{action:'cleanup'}});
    const removed=body(await call('game.call',{method:'game.units.inspect',arguments:{unit}}));assert.equal(removed.unit.valid,false);report.fixtureCleaned=true;
  }
  const detached=body(await call('game.detach'));assert.equal(detached.stopped,true);report.detached=true;
  report.sourceUnchanged=source?hash(await fs.readFile(source))===before:null;assert.notEqual(report.sourceUnchanged,false);
  report.outcome='passed';
}catch(e){report.outcome='failed';report.error=String(e);process.exitCode=1;}
finally{
  child.stdin.end();report.exitCode=await exited;report.finishedAt=new Date().toISOString();
  report.sourceUnchanged=source?hash(await fs.readFile(source))===before:null;
  if(report.sourceUnchanged===false){report.outcome='failed';report.error='Source map changed';process.exitCode=1;}
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2)+'\n');await fs.writeFile(path.join(directory,'stderr.log'),stderr);
  process.stdout.write(JSON.stringify({outcome:report.outcome,mode:report.mode,operationCount:report.operationCount,handshake:report.handshake??false,sourceUnchanged:report.sourceUnchanged??null,report:path.join(directory,'result.json'),error:report.error??null})+'\n');
}
