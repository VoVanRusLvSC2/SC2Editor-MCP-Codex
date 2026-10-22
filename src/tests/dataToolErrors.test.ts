import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {registerDataTools} from '../modules/data/tools.js';
import {DataSchemaRegistry} from '../modules/data/schemaRegistry.js';

test('strict Data rejection is an MCP error with diagnostics and no staged/saved file',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'data-tool-error-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const data=new DataWorkspace(new Workspace(root),DataSchemaRegistry.lazy()),handlers=new Map<string,(args:any)=>Promise<any>>();
 registerDataTools({registerTool:(name:string,_config:unknown,handler:any)=>handlers.set(name,handler)} as any,{workspace:data});
 const r=await handlers.get('data.apply')!({file:'Base.SC2Data/GameData/Test.xml',operations:[{op:'object.create',ctype:'CEffectDamage',id:'Bad',fields:[{name:'DefinitelyUnknownField',value:1}]}],dryRun:false,stage:true,validate:true,authoringPolicy:'strict'});
 assert.equal(r.isError,true);const body=JSON.parse(r.content[0].text);assert.equal(body.accepted,false);assert.equal(body.error.code,'DATA_AUTHORING_REJECTED');assert.ok(body.authoring.diagnostics.some((d:any)=>d.code==='DATA_AUTHOR_FIELD_UNKNOWN'));assert.deepEqual(data.workspace.draftFiles(),[]);
});
