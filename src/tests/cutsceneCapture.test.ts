import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';
import type {McpServer} from '@modelcontextprotocol/server';
import {Workspace} from '../core/workspace.js';
import type {CutscenePreviewWorkspace} from '../modules/cutscenePreview/workspace.js';
import {createCaptureProtocol} from '../modules/cutscenePreview/captureProtocol.js';
import {createCaptureController} from '../modules/cutscenePreview/captureController.js';
import {registerCutsceneRenderTool,captureRequestSchema} from '../modules/cutscenePreview/captureTools.js';
import {captureBrowserArgs,type WebglCapture} from '../modules/cutscenePreview/headless.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {previewPage} from '../modules/cutscenePreview/viewer.js';
import {orbitCamera} from '../modules/cutscenePreview/render.js';

test('capture pipe correlates fragmented replies and rejects all pending work on process close',async()=>{
 const input=new PassThrough(),output=new PassThrough(),wire:string[]=[];input.on('data',b=>wire.push(b.toString()));const protocol=createCaptureProtocol(input,output,1000);
 const a=protocol.command('Page.enable',{},'session'),b=protocol.command('Runtime.enable');
 output.write('{"id":2,"result":{"ok":2}}\0{"id":1,');output.write('"result":{"ok":1}}\0');
 assert.deepEqual(await a,{ok:1});assert.deepEqual(await b,{ok:2});assert.equal(JSON.parse(wire[0].slice(0,-1)).sessionId,'session');
 const c=protocol.command('Page.navigate');const rejected=assert.rejects(c,/PIPE_CLOSED/);output.end();await rejected;await assert.rejects(protocol.command('Page.enable'),/PIPE_CLOSED/);protocol.close();
});

test('capture pipe has bounded command timeouts and reports protocol errors',async()=>{
 const input=new PassThrough(),output=new PassThrough(),protocol=createCaptureProtocol(input,output,10);input.resume();
 await assert.rejects(protocol.command('Runtime.evaluate'),/COMMAND_TIMEOUT/);
 const reply=protocol.command('Page.navigate');output.write('{"id":2,"error":{"message":"bad target"}}\0');await assert.rejects(reply,/bad target/);
 const malformed=protocol.command('Page.enable');output.write('broken\0');await assert.rejects(malformed,/PROTOCOL_JSON/);protocol.close();
 const largeIn=new PassThrough(),largeOut=new PassThrough(),bounded=createCaptureProtocol(largeIn,largeOut);largeIn.resume();const tooLarge=bounded.command('Runtime.evaluate');largeOut.write(Buffer.alloc(16*1024*1024+1,32));await assert.rejects(tooLarge,/PROTOCOL_BUDGET/);await assert.rejects(bounded.command('Page.enable'),/PROTOCOL_BUDGET/);bounded.close();
});

test('capture launch uses owned profile/pipe without disabling sandbox or forcing software rendering',()=>{
 const args=captureBrowserArgs('C:/tmp/owned');assert.ok(args.includes('--user-data-dir=C:/tmp/owned'));assert.ok(args.includes('--remote-debugging-pipe'));
 assert.ok(!args.some(v=>/swiftshader|disable-gpu-sandbox|no-sandbox|remote-debugging-port|remote-allow-origins/.test(v)));
 assert.equal(args.at(-1),'about:blank');
});

const stats={camera:{id:'camera',name:'Shot'},triangles:2,calls:3,localLights:4,textureAnisotropy:8,rttPasses:1,effectClamped:false};
test('serialized capture waits for readiness/video, uses exact dimensions and reports actual frame diagnostics',async()=>{
 let releaseReady!:()=>void,draws=0,releases=0,prepared:number[]=[];
 const make=vm.runInNewContext('('+createCaptureController.toString()+')',{setTimeout,Date});
 const capture=make({ready:new Promise<void>(resolve=>releaseReady=resolve),duration:1000,prepare:(...a:number[])=>{prepared=a;},draw:()=>{draws++;return stats;},media:()=>({failures:[],items:[{ready:2,seeking:draws<2,desired:1,frame:draws<2?0:1}]}),image:()=> 'data:image/png;base64,AAAA',error:()=>0,renderer:()=> 'Test GL',release:()=>releases++});
 const result=capture(750,1280,720);assert.deepEqual(prepared,[]);await assert.rejects(capture(750,1280,720),/BUSY/);releaseReady();const frame=await result;
 assert.deepEqual(prepared,[750,1280,720]);assert.equal(draws,3);assert.equal(frame.time,750);assert.equal(frame.camera.name,'Shot');assert.equal(frame.renderer,'Test GL');assert.equal(frame.textureAnisotropy,8);assert.equal(releases,1);assert.equal(frame.engineValidated,false);
});

test('capture rejects bounds, missing media and GL errors, and releases its state on failure',async()=>{
 let release=0,error=0,failures:string[]=[];
 const capture=createCaptureController({ready:Promise.resolve(),duration:1000,prepare(){},draw:()=>stats,media:()=>({failures,items:[]}),image:()=> 'data:image/png;base64,AAAA',error:()=>error,renderer:()=> 'Test GL',release(){release++;}});
 await assert.rejects(capture(1001,1280,720),/BOUNDS/);assert.equal(release,0);
 failures=['missing-video'];await assert.rejects(capture(500,1280,720),/VIDEO_FAILED/);assert.equal(release,1);
 failures=[];error=1282;await assert.rejects(capture(500,1280,720),/GL_ERROR: 1282/);assert.equal(release,2);
});

test('capture schema rejects executable/output overrides and bounds image work',()=>{
 assert.equal(captureRequestSchema.parse({file:'Test.SC2Cutscene'}).includeImage,true);
 for(const extra of [{time:NaN},{time:1e10},{width:1921},{height:1081},{browser:'evil.exe'},{output:'scene.html'}])assert.throws(()=>captureRequestSchema.parse({file:'Test.SC2Cutscene',...extra}));
});

test('MCP capture returns image and unique PNG paths while preserving HTML; failed captures write no PNG',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-capture-test-')),htmlFile=path.join(root,'scene.HTML'),reportFile=path.join(root,'scene.json'),html='<html>preserved player</html>';
 try{
  await fs.writeFile(htmlFile,html);let handler!:(a:ReturnType<typeof captureRequestSchema.parse>)=>Promise<any>,fault=false,previewArgs:any;
  const png=await sharp({create:{width:160,height:120,channels:4,background:'#123456'}}).png().toBuffer();
  const server={registerTool(name:string,_config:unknown,callback:typeof handler){assert.equal(name,'cutscene.render');handler=callback;}} as unknown as McpServer;
  const preview={workspace:new Workspace(root),async preview(a:unknown){previewArgs=a;return {htmlFile,reportFile};}} as unknown as CutscenePreviewWorkspace;
  registerCutsceneRenderTool(server,preview,async(_html,time,width,height)=>{if(fault)throw Error('browser test failure');return {png,frame:{time,width,height,camera:stats.camera,renderer:'Fake GL',triangles:2,drawCalls:3,localLights:4,rttPasses:1,effectClamped:false,engineValidated:false,allSupported:false}} satisfies WebglCapture;});
  const request=captureRequestSchema.parse({file:'Scene.SC2Cutscene',time:750,width:160,height:120});
  const first=await handler(request),second=await handler({...request,includeImage:false});assert.equal(first.isError,undefined);assert.equal(first.content[1].type,'image');assert.equal(second.content.length,1);
  const a=JSON.parse(first.content[0].text),b=JSON.parse(second.content[0].text);assert.notEqual(a.pngFile,b.pngFile);assert.equal(path.extname(a.pngFile),'.png');assert.equal(await fs.readFile(htmlFile,'utf8'),html);assert.deepEqual(await fs.readFile(a.pngFile),png);assert.equal(previewArgs.snapshots,false);assert.deepEqual(previewArgs.times,[750]);
  fault=true;const failed=await handler(request);assert.equal(failed.isError,true);assert.equal((await fs.readdir(root)).filter(f=>f.endsWith('.png')).length,2);
  fault=false;assert.equal((await handler(request)).isError,undefined,'failed calls release the capture slot');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('generated player exposes capture hook only in capture mode and serializes the same renderer',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="a"><CCutsceneElementObject duration="1000"/></CCutsceneNodeActor></CutsceneState>','capture');
 const html=previewPage(scene,orbitCamera(scene),'director','solid'),code=html.slice(html.lastIndexOf('<script>')+8,html.lastIndexOf('</script>'));
 new vm.Script(code);assert.ok(html.includes('__sc2mcpCapture'));assert.ok(code.includes('preserveDrawingBuffer'));assert.ok(code.includes('captureSize?.width'));assert.ok(code.includes('createCaptureController'));assert.ok(code.includes('videoStatus'));
});
