import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

const load=async()=>await import(pathToFileURL(path.resolve('scripts/check-distribution-privacy.mjs')).href) as {checkDistributionPrivacy:(root:string,options?:{privateRoots:string[]})=>Promise<any>};
test('portable privacy audit detects renamed private sources and private test/debug artifacts',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-private-audit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const corpus=path.join(root,'external'),output=path.join(root,'package');await fs.mkdir(corpus);await fs.mkdir(output);
 await fs.writeFile(path.join(corpus,'controller.cpp'),'unique private implementation');await fs.writeFile(path.join(output,'renamed.cpp'),'unique private implementation');
 await fs.writeFile(path.join(output,'Fixture.SC2Map'),'instrumented map');await fs.writeFile(path.join(output,'symbols.pdb'),'debug');
 const {checkDistributionPrivacy}=await load(),r=await checkDistributionPrivacy(output,{privateRoots:[corpus]});
 assert.equal(r.passed,false);assert.equal(r.privateSourceFiles,1);assert.deepEqual(r.violations.map((v:any)=>v.file).sort(),['Fixture.SC2Map','renamed.cpp','symbols.pdb']);
 await fs.rm(output,{recursive:true});await fs.mkdir(output);await fs.writeFile(path.join(output,'bridge.js'),'external call adapter');
 assert.equal((await checkDistributionPrivacy(output,{privateRoots:[corpus]})).passed,true);
 await assert.rejects(checkDistributionPrivacy(corpus,{privateRoots:[corpus]}),/OUTPUT_INSIDE_PRIVATE/);
});

test('private versioned game installation and loose compiled runtime cannot enter a public package',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-game-package-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'.game-toolkit-runtime'));await fs.writeFile(path.join(root,'SC2GameBridge.dll'),'private binary');
 await fs.writeFile(path.join(root,'SC2GameToolkit-0.1.0-dev.zip'),'private release');
 const {checkDistributionPrivacy}=await load(),r=await checkDistributionPrivacy(root);
 assert.equal(r.passed,false);assert.deepEqual(r.violations.map((v:any)=>v.file).sort(),['.game-toolkit-runtime','SC2GameBridge.dll','SC2GameToolkit-0.1.0-dev.zip']);
});
