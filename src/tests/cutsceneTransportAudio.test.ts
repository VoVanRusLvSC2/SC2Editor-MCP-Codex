import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioPlayer} from '../modules/cutscenePreview/audioRuntime.js';
import {createPlaybackKernel} from '../modules/cutscenePreview/playback.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {mountTimeline,timelineMarkup} from '../modules/cutscenePreview/timeline.js';
import {previewPage} from '../modules/cutscenePreview/viewer.js';

const scene=()=>parsePreviewScene('<CutsceneState><CCutsceneNodeMasterSound guid="m" soundLink="Score"><CCutsceneElementObject duration="10000"/></CCutsceneNodeMasterSound></CutsceneState>','transport');
const transport=createPlaybackKernel();

test('presentation ends at the last enabled End Scene, preserving source lifetimes and branch endings',()=>{
 const s=scene();s.duration=5000000;s.endMarkers=[21938,73785,4000000];s.endEvents=[{time:21938},{time:73785},{time:4000000,scopeEnabled:false}];
 const before=JSON.stringify(s);assert.equal(transport.duration(s),73785);assert.equal(JSON.stringify(s),before);
 s.endEvents=[];assert.equal(transport.duration(s),5000000);
});
test('bookmarks handle unsorted input, simultaneous filter commands and eligible jump targets',()=>{
 const s=scene();s.previewFilters=['red'];s.bookmarks=[{time:800,name:'target',filter:'',filters:[['blue']],pause:false},{time:300,name:'jump',jump:'target',pause:false},{time:100,name:'first',addFilters:['blue'],removeFilters:['red'],pause:false},{time:100,name:'same',filters:[['blue']],pause:false},{time:500,name:'target',scopeEnabled:false,pause:false}] as NonNullable<typeof s.bookmarks>;
 const result=transport.advance(s,0,350);assert.equal(result.time,850);assert.equal(result.jumped,true);assert.deepEqual(result.filters,['blue']);assert.deepEqual(result.events.map(e=>e.name),['first','same','jump']);
});
test('backward jumps retain overshoot, ignore disabled targets and terminate malformed cycles',()=>{
 const s=scene();s.bookmarks=[{time:100,name:'start',pause:false},{time:300,name:'loop',jump:'start',pause:false}];
 const jumped=transport.advance(s,250,100);assert.equal(jumped.time,150);assert.equal(jumped.jumped,true);
 s.bookmarks[0].scopeEnabled=false;const unresolved=transport.advance(s,250,100);assert.equal(unresolved.time,350);assert.equal(unresolved.jumped,false);assert.equal(unresolved.events[1].type,'unresolved-jump');
 s.bookmarks[0].scopeEnabled=true;assert.equal(transport.advance(s,100,100000).limited,true);
});

test('2D stereo keeps authored gain before the first sample and across camera movement; seek resets looping master time',async()=>{
 const original=globalThis.AudioContext,params=()=>({value:1,setTargetAtTime(v:number){this.value=v;}}),node=()=>({connect(_n?:unknown){},disconnect(){}});
 let ctx:FakeContext,panners=0;const initialGains:number[]=[],offsets:number[]=[],gains:Array<ReturnType<typeof params>>=[];
 class FakeContext{
  currentTime=0;state='running';destination=node();listener=Object.fromEntries(['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'].map(k=>[k,params()]));
  // eslint-disable-next-line @typescript-eslint/no-this-alias -- Expose the mock clock to transport assertions.
  constructor(){ctx=this;}async resume(){}async close(){}async decodeAudioData(){return {length:480000,numberOfChannels:2,duration:10};}
  createGain(){const gain=params();gains.push(gain);return {...node(),gain};}createAnalyser(){return {...node(),fftSize:256,getFloatTimeDomainData(){}};}
  createBufferSource(){let connected:{gain:{value:number}};return {...node(),playbackRate:params(),connect(n:typeof connected){connected=n;},start(_t:number,offset:number){initialGains.push(connected.gain.value);offsets.push(offset);},stop(){},onended:undefined};}
  createPanner(){panners++;return {...node(),positionX:params(),positionY:params(),positionZ:params()};}
 }
 globalThis.AudioContext=FakeContext as unknown as typeof AudioContext;
 try{
  const s=scene();s.speech![0].asset='score';s.speech![0].volume=.15;s.speech![0].sound={gain:.5,pitch:1,loop:true,near:1,far:10};
  s.audio={score:{data:'data:audio/ogg;base64,AQ==',source:'test',sha256:'',format:'ogg',gain:3,pitch:1,loop:true,near:1,far:10}};
  const player=createAudioPlayer(s,createPreviewKernel());await player.unlock();const camera={id:'c',name:'c',eye:[0,0,0],target:[0,1,0],fov:45,vertical:true,near:.1,far:100,roll:0,curves:[]};
  player.update(1000,true,1,camera,{});assert.equal(initialGains[0],.075);assert.equal(panners,0);ctx!.currentTime=1;
  player.update(2000,true,1,{...camera,eye:[1000,1000,1000]},{});assert.equal(gains[1].value,.075);assert.equal(initialGains.length,1);assert.equal(player.masterTime(),2000);
  player.seek();assert.equal(player.masterTime(),undefined);assert.equal(player.status().voices,0);
  player.update(12000,true,1,camera,{});assert.equal(player.status().voices,0,'outside authored window');
  s.speech![0].end=20000;player.update(12000,true,1,camera,{});assert.equal(offsets[1],2);assert.equal(player.masterTime(),12000,'same loop sample offset must have a new scene anchor');
  player.seek();player.update(12025,true,1,camera,{});assert.equal(player.masterTime(),12025,'small explicit seek bypasses drift tolerance');
  player.setMuted(true);player.update(12025,true,1,camera,{});assert.equal(gains[0].value,0);player.close();
 }finally{globalThis.AudioContext=original;}
});

class Element{
 value='1';textContent='';className='';clientWidth=600;scrollLeft=0;dataset:Record<string,string>={};children:Element[]=[];attributes:Record<string,string>={};
 style:Record<string,unknown> & {setProperty:(k:string,v:string)=>void}={setProperty:(k,v)=>{this.style[k]=v;}};
 classList={add(_s:string){},toggle(_s:string,_on?:boolean){return false;},contains(){return false;}};
 onclick?:()=>void;onpointerdown?:(e:unknown)=>void;oninput?:()=>void;
 append(...n:Element[]){this.children.push(...n);}replaceChildren(){this.children=[];}setAttribute(k:string,v:string){this.attributes[k]=v;}
 querySelectorAll(selector:string):Element[]{return selector==='[data-time]'?[marker]:[];}
 addEventListener(){}setPointerCapture(){}closest(selector:string){return selector==='[data-time]'&&this.dataset.time?this:null;}
 getBoundingClientRect(){return {left:0};}
}
let marker:Element;
test('fit ruler shows exact final time and marker click seeks exactly once without pointer capture',()=>{
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldResize=globalThis.ResizeObserver;
 const nodes=new Map<string,Element>(),get=(id:string)=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)!;},seeks:number[]=[];
 marker=new Element();marker.dataset.time='73927';
 globalThis.document={getElementById:get,createElement:()=>new Element()} as unknown as Document;
 globalThis.window={addEventListener(){}} as unknown as Window & typeof globalThis;globalThis.ResizeObserver=undefined as unknown as typeof ResizeObserver;
 try{const s=scene();s.duration=90022;const timeline=mountTimeline(s,t=>seeks.push(t),()=>{},()=>{});timeline.update(73927);
  assert.equal(get('timeline-position').textContent,'01:13:927 / 01:30:022');assert.equal(get('timeline-ruler').children.at(-1)!.textContent,'01:30:022');
  assert.equal(get('timeline-content').style['--time-width'],'389px');assert.equal(Number.parseFloat(String(get('timeline-cursor').style.left))<600,true);
  get('timeline-scroll').onpointerdown!({target:marker,button:0,shiftKey:false,preventDefault(){throw Error('marker default click suppressed');}});assert.deepEqual(seeks,[]);marker.onclick!();assert.deepEqual(seeks,[73927]);
  get('timeline-end').onclick!();assert.equal(seeks.at(-1),90022);
 }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;globalThis.ResizeObserver=oldResize;}
});
test('player fits End Scene without rewriting JSON data, hides out-of-range clips and labels bookmark destinations',()=>{
 const s=scene();s.endMarkers=[9000];s.bookmarks=[{time:200,name:'jump',jump:'destination',pause:false}];s.shots=[{start:12000,end:15000,camera:'outside'}];
 const html=previewPage(s,{id:'orbit',name:'Orbit',eye:[0,-10,0],target:[0,0,0],fov:45,vertical:true,near:.1,far:100,roll:0,curves:[]},'director','solid');
 assert.ok(html.includes('jump → destination'));assert.ok(!timelineMarkup({...s,duration:9000}).includes('data-start="12000"'));
 const metadata=JSON.parse(html.match(/id="scene-data">([^<]+)/)![1]);assert.equal(metadata.duration,10000);assert.deepEqual(metadata.endMarkers,[9000]);assert.ok(html.includes('Материалы · без LUT'));
});
