import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {SchemaRegistry} from '../schema/schemaRegistry.js';
import {DataWorkspace} from '../modules/data/workspace.js';

test('native signed movement-plane deltas preserve stock lift semantics with bounded integers',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-plane-delta-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'ComponentList.SC2Components'),'<Components/>');
 const data=new DataWorkspace(new Workspace(root,await SchemaRegistry.loadBundled()));
 const file='Base.SC2Data/GameData/Lift.xml';
 const good=await data.batch({changes:[{file,operations:[{op:'object.create',ctype:'CBehaviorBuff',id:'Lift',fields:[{name:'Modification',children:[{name:'PlaneDelta',index:'Ground',value:-1},{name:'PlaneDelta',index:'Air',value:1}]}]}]}],dryRun:true});
 assert.equal(good.accepted,true);
 for(const value of ['-129','128','0.5'])await assert.rejects(data.batch({changes:[{file,operations:[{op:'object.create',ctype:'CBehaviorBuff',id:'Bad',fields:[{name:'Modification',children:[{name:'PlaneDelta',index:'Ground',value}]}]}]}],dryRun:true}),/DATA_AUTHORING_REJECTED/);
 await assert.rejects(data.batch({changes:[{file,operations:[{op:'object.create',ctype:'CUnit',id:'BadUnsigned',fields:[{name:'AlliedPushPriority',value:-1}]}]}],dryRun:true}),/DATA_AUTHORING_REJECTED/);
});
