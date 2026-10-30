import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {SchemaRegistry} from '../schema/schemaRegistry.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {DataAuthoringError} from '../modules/data/authoringValidation.js';

test('atomic Data rejection retains diagnostics from every failing catalog and writes nothing',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-batch-diagnostics-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'ComponentList.SC2Components'),'<Components/>');
 const data=new DataWorkspace(new Workspace(root,await SchemaRegistry.loadBundled()));
 const files=['Base.SC2Data/GameData/One.xml','Base.SC2Data/GameData/Two.xml'];
 await assert.rejects(()=>data.batch({changes:files.map((file,index)=>({file,operations:[{op:'object.create',ctype:'CEffectDamage',id:'Damage'+index,fields:[{name:'UnknownField'+index,value:1}]}]})),dryRun:false,stage:false}),error=>{
  assert.ok(error instanceof DataAuthoringError);
  assert.equal(error.verdict.accepted,false);
  for(const file of files)assert.ok(error.verdict.diagnostics.some(x=>x.file===file&&x.code==='DATA_AUTHOR_FIELD_UNKNOWN'));
  return true;
 });
 for(const file of [...files,'Base.SC2Data/GameData.xml'])await assert.rejects(fs.stat(path.join(root,file)),{code:'ENOENT'});
});
