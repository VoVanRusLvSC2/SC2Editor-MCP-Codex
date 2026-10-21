import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {DialogPreviewWorkspace} from '../modules/uiPreview/dialogWorkspace.js';
import type {UiPreviewWorkspace} from '../modules/uiPreview/workspace.js';
import type {TriggerWorkspace} from '../modules/trigger/workspace.js';
import {compileScene} from '../modules/uiPreview/scene.js';
import type {PreviewSources,Definition} from '../modules/uiPreview/sources.js';

test('nested Galaxy UI includes resolve root paths first and preserve relative fallback',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-dialog-includes-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'Scripts/MAIN'),{recursive:true});await fs.mkdir(path.join(root,'Scripts/UI'),{recursive:true});
 await fs.writeFile(path.join(root,'Scripts/MAIN/A.galaxy'),'include "Scripts/UI/B"\n');
 await fs.writeFile(path.join(root,'Scripts/UI/B.galaxy'),'include "../CommonLabel"');
 await fs.writeFile(path.join(root,'Scripts/CommonLabel.galaxy'),'int d; void Build(){d=DialogCreate(200,100,c_anchorTopLeft,0,0,false);DialogSetVisible(d,PlayerGroupAll(),true);}');
 let files:string[]=[],dialogs=0;
 const ui={workspace:new Workspace(root),casc:{read:async()=>({bytes:Buffer.from(''),metadata:{sha256:'test',buildKey:'test'}}),refreshBuild:async()=>({build:{buildKey:'test'}})},preview:async(_args:unknown,override:{references:Array<{file:string}>;definition:{children:unknown[]}})=>{files=override.references.map(r=>r.file);dialogs=override.definition.children.length;return {};}} as unknown as UiPreviewWorkspace;
 const preview=new DialogPreviewWorkspace(ui,{} as TriggerWorkspace);await preview.preview({file:'Scripts/MAIN/A.galaxy',entrypoints:['Build']});
 assert.equal(dialogs,1);assert.ok(files.includes('Scripts/UI/B.galaxy'));assert.ok(files.includes('Scripts/CommonLabel.galaxy'));assert.ok(!files.some(f=>f.includes('MAIN/Scripts')));
});

test('complex hero-selection UI supports more than 128 frames and still has a hard limit',async()=>{
 const sources={value:(s:string|undefined)=>s,issues:[],race:'Terr',style:()=>({})} as unknown as PreviewSources;
 const leaf=(i:number):Definition=>({name:'Hero_'+i,type:'Frame',attrs:{},properties:[],children:[],source:'test'});
 const root:Definition={name:'Selection',type:'Frame',attrs:{},properties:[],children:Array.from({length:200},(_,i)=>leaf(i)),source:'test'};
 const scene=await compileScene(root,sources,{x:0,y:0,width:1920,height:1080},{});assert.equal(scene.length,201);
 root.children=Array.from({length:1024},(_,i)=>leaf(i));await assert.rejects(compileScene(root,sources,{x:0,y:0,width:1920,height:1080},{}),/FRAME_BUDGET/);
});
