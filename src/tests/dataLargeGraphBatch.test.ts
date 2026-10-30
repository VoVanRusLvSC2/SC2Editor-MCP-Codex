import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Workspace } from '../core/workspace.js';
import { SchemaRegistry } from '../schema/schemaRegistry.js';
import { DataWorkspace } from '../modules/data/workspace.js';
import type { DataOperation } from '../modules/data/types.js';

test('a connected Data graph over 500 objects is planned atomically with a bounded upper limit', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sc2-large-graph-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  await fs.writeFile(path.join(root, 'ComponentList.SC2Components'), '<Components/>');
  const data = new DataWorkspace(new Workspace(root, await SchemaRegistry.loadBundled()));
  const operations: DataOperation[] = Array.from({length:501}, (_,i) => ({op:'object.create', ctype:i===500?'CEffectDamage':'CEffectSet', id:'Graph'+i, fields:i===500?[{name:'Amount',value:1}]:[{name:'EffectArray',index:0,value:'Graph'+(i+1)}]}));
  const changes = [
    {file:'Base.SC2Data/GameData/GraphA.xml',operations:operations.slice(0,250)},
    {file:'Base.SC2Data/GameData/GraphB.xml',operations:operations.slice(250)},
  ];
  const result = await data.batch({changes,dryRun:true});
  assert.equal(result.accepted,true);
  await assert.rejects(fs.stat(path.join(root,changes[0].file)), {code:'ENOENT'});
  await assert.rejects(data.batch({changes:[{file:changes[0].file,operations:Array.from({length:1001},()=>operations[0])}],dryRun:false}), /DATA_BATCH_OPERATION_LIMIT/);
  await assert.rejects(fs.stat(path.join(root,changes[0].file)), {code:'ENOENT'});
});
