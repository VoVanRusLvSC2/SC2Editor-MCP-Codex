import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {gameMpqCompatibilityBootstrap} from '../integrations/game/mpqCompatibility.js';

test('game launcher normalizes only MPQ read entry separators and preserves private SDK arguments',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-mpq-compat-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const shim=path.join(root,'compatibility.py'),server=path.join(root,'server.py');
 await fs.writeFile(shim,gameMpqCompatibilityBootstrap);
 const script=String.raw`import runpy,sys,json
module=runpy.run_path(sys.argv[1],run_name='compatibility_test')
normalize=module['normalize_mpq_read_arguments']
source=['mpqcli.exe','read','Scripts/AdminCommands.galaxy','Map.SC2Map']
read=normalize(source)
assert source[2]=='Scripts/AdminCommands.galaxy'
assert read[2]=='Scripts\\AdminCommands.galaxy'
assert read[3]=='Map.SC2Map'
for other in [['other.exe','read','Scripts/Test.galaxy','Map.SC2Map'],['mpqcli.exe','write','Scripts/Test.galaxy','Map.SC2Map']]:
    assert normalize(other) is other
print(json.dumps({'readPath':read[2]}))`;
 const probe=spawnSync(process.env.SC2_GAME_PYTHON??'python',['-c',script,shim],{encoding:'utf8',windowsHide:true});
 if(probe.error&&'code'in probe.error&&probe.error.code==='ENOENT'){t.skip('Optional game-testing Python is unavailable');return;}
 assert.equal(probe.status,0,probe.stderr);
 assert.equal(JSON.parse(probe.stdout).readPath,'Scripts\\AdminCommands.galaxy');
 await fs.writeFile(server,'import sys,json,subprocess\nprint(json.dumps({"args":sys.argv[1:],"path":sys.path[0],"reader":subprocess.check_output.__name__}))\n');
 const launch=spawnSync(process.env.SC2_GAME_PYTHON??'python',['-c',gameMpqCompatibilityBootstrap,server,'--work','private work','--binaries','private bin'],{encoding:'utf8',windowsHide:true});
 assert.equal(launch.status,0,launch.stderr);
 const result=JSON.parse(launch.stdout);
 assert.deepEqual(result.args,['--work','private work','--binaries','private bin']);
 assert.equal(result.path,root);
 assert.equal(result.reader,'read_compatible');
});
