import {spawn,execFile} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Readable,Writable} from 'node:stream';
import {createCaptureProtocol} from './captureProtocol.js';

export interface WebglCapture {png:Buffer;frame:{time:number;width:number;height:number;camera:{id:string;name:string};renderer:string;triangles:number;drawCalls:number;localLights:number;eligibleLights?:number;omittedLights?:number;lightLimit?:number;textureAnisotropy?:number;rttPasses:number;effectClamped:boolean;engineValidated:false;allSupported:false}}
export const captureBrowserArgs=(profile:string)=>[`--user-data-dir=${profile}`,'--headless=new','--remote-debugging-pipe','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--mute-audio','about:blank'];
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function browserPath(){
 const candidates=process.env.SC2_PREVIEW_BROWSER?[process.env.SC2_PREVIEW_BROWSER]:process.platform==='win32'?['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',...(process.env.LOCALAPPDATA?[path.join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe')]:[])]:process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']:['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'];
 for(const file of candidates)if(path.isAbsolute(file)&&(await fs.stat(file).catch(()=>undefined))?.isFile())return file;
 throw Error('CUTSCENE_WEBGL_BROWSER_MISSING: install Edge/Chrome or configure absolute SC2_PREVIEW_BROWSER');
}

/** Invoked only by an authorized cutscene.render request. Never launched on registration. */
export async function captureWebglFrame(htmlFile:string,time:number,width:number,height:number):Promise<WebglCapture>{
 if(path.extname(htmlFile).toLowerCase()!=='.html'||!Number.isInteger(time)||time<0||time>1e9||!Number.isInteger(width)||!Number.isInteger(height)||width<160||height<120||width>1920||height>1080)throw Error('CUTSCENE_CAPTURE_REQUEST');
 const stat=await fs.stat(htmlFile);if(!stat.isFile()||stat.size>384*1024*1024)throw Error('CUTSCENE_CAPTURE_HTML_BUDGET');
 const executable=await browserPath(),temporary=await fs.realpath(os.tmpdir()),profile=await fs.mkdtemp(path.join(temporary,'sc2mcp-capture-'));
 const browser=spawn(executable,captureBrowserArgs(profile),{stdio:['ignore','ignore','ignore','pipe','pipe'],windowsHide:true});
 let terminal=false,spawnError:Error|undefined;const exited=new Promise<void>(resolve=>{browser.once('exit',()=>{terminal=true;resolve();});browser.once('error',e=>{spawnError=e;terminal=true;resolve();});});
 const protocol=createCaptureProtocol(browser.stdio[3] as Writable,browser.stdio[4] as Readable),deadline=Date.now()+150000;
 browser.once('exit',()=>protocol.fail(Error('CUTSCENE_WEBGL_BROWSER_EXITED')));browser.once('error',e=>protocol.fail(e));
 try{
  const {targetId}=await protocol.command('Target.createTarget',{url:'about:blank'}),{sessionId}=await protocol.command('Target.attachToTarget',{targetId,flatten:true});
  if(typeof sessionId!=='string')throw Error('CUTSCENE_CAPTURE_SESSION');
  const command=(method:string,params:Record<string,unknown>={},wait=15000)=>protocol.command(method,params,sessionId,Math.max(1,Math.min(wait,deadline-Date.now())));
  await command('Page.enable');await command('Runtime.enable');await command('Network.enable');
  // Generated players embed their resources. External traffic is unnecessary.
  await command('Network.setBlockedURLs',{urls:['http://*','https://*','ws://*','wss://*','ftp://*']});
  await command('Emulation.setDeviceMetricsOverride',{width:Math.max(width+400,1280),height:Math.max(height+300,800),deviceScaleFactor:1,mobile:false});
  const url=pathToFileURL(path.resolve(htmlFile));url.searchParams.set('capture','1');
  const navigation=await command('Page.navigate',{url:url.href});if(navigation.errorText)throw Error('CUTSCENE_CAPTURE_NAVIGATION: '+navigation.errorText);
  for(;;){
   if(spawnError)throw spawnError;if(terminal)throw Error('CUTSCENE_WEBGL_BROWSER_EXITED');if(Date.now()>=deadline)throw Error('CUTSCENE_CAPTURE_READY_TIMEOUT');
   const probe=await command('Runtime.evaluate',{expression:'({state:document.body?.dataset.loadState,capture:typeof window.__sc2mcpCapture,error:document.body?.dataset.loadState==="error"?document.getElementById("loading-label")?.textContent:undefined})',returnByValue:true});
   const state=probe.result?.value;if(state?.state==='error')throw Error('CUTSCENE_CAPTURE_LOAD_FAILED: '+String(state.error).slice(0,500));if(state?.state==='ready'&&state?.capture==='function')break;await sleep(100);
  }
  const result=await command('Runtime.evaluate',{expression:`window.__sc2mcpCapture(${time},${width},${height})`,awaitPromise:true,returnByValue:true},30000);
  if(result.exceptionDetails)throw Error('CUTSCENE_CAPTURE_FRAME_FAILED: '+String(result.exceptionDetails.exception?.description??result.exceptionDetails.text).slice(0,500));
  const value=result.result?.value;if(typeof value?.png!=='string'||!value.png.startsWith('data:image/png;base64,')||value.png.length>16*1024*1024)throw Error('CUTSCENE_CAPTURE_INVALID_PNG');
  const {png,...frame}=value;if(frame.time!==time||frame.width!==width||frame.height!==height)throw Error('CUTSCENE_CAPTURE_FRAME_MISMATCH');
  return {png:Buffer.from(png.slice(22),'base64'),frame};
 }finally{
  if(!terminal)await protocol.command('Browser.close',{},undefined,1000).catch(()=>{});
  await Promise.race([exited,sleep(1000)]);
  if(!terminal&&browser.pid){
   if(process.platform==='win32')await new Promise<void>(resolve=>execFile('taskkill',['/PID',String(browser.pid),'/T','/F'],{windowsHide:true,timeout:3000},()=>resolve()));
   else browser.kill('SIGKILL');
   await Promise.race([exited,sleep(3000)]);
  }
  protocol.close();
  // Only remove the fresh owned profile, after its process exits. Never follow a replacement junction.
  const actual=await fs.realpath(profile).catch(()=>undefined);
  if(terminal&&actual&&path.relative(temporary,actual)===path.basename(profile)&&path.basename(actual).startsWith('sc2mcp-capture-'))await fs.rm(actual,{recursive:true,force:true,maxRetries:2,retryDelay:100}).catch(()=>{});
 }
}
