import test from 'node:test';
import assert from 'node:assert/strict';
import {minimapTga} from '../modules/map/minimap.js';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {Workspace} from '../core/workspace.js';
import {ModkitIntegration} from '../integrations/modkit/runtime.js';
import {MapPreviewWorkspace} from '../modules/map/preview.js';
import {generateFoundation} from '../modules/document/manifest.js';

test('minimap TGA keeps top-left rows, writes BGR pixels and the TGA 2 footer',()=>{
  const b=minimapTga(new Uint8Array([255,0,0,0,255,0,0,0,255,255,255,255]),2,2);
  assert.equal(b.readUInt16LE(12),2);assert.equal(b.readUInt16LE(14),2);
  assert.equal(b[17],32);assert.equal(b[16],24);
  assert.deepEqual([...b.subarray(18,30)],[0,0,255,0,255,0,255,0,0,255,255,255]);
  assert.equal(b.subarray(-18).toString('ascii'),'TRUEVISION-XFILE.\0');
  assert.deepEqual([...b.subarray(-26,-18)],Array(8).fill(0));
  assert.throws(()=>minimapTga(new Uint8Array(3),0,1),/BOUNDS/);
});

test('new terrain foundations use a complete TGA instead of the former legacy placeholder',()=>{
  const result=generateFoundation({kind:'map',destination:'Map',mapType:'arcade',map:{width:64,height:48},terrain:{enabled:true,tileSet:'Test',baseHeight:8},locales:['enUS'],dependencies:{mode:'custom',entries:[]},initialization:'empty'},'5.0.17.98310',1791718395,'minimap-test',{id:'Test',textures:['Dirt'],cliffs:['Cliff'],sourcePaths:[]});
  const bytes=result.files.get('Minimap.tga')!;
  assert.equal(bytes.length,18+64*64*3+26);
  assert.equal(bytes[17],32);
  assert.equal(bytes.subarray(-18).toString('ascii'),'TRUEVISION-XFILE.\0');
});

test('minimap rebuild commits with backups and rejects terrain edits made after staging',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-minimap-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'Map'));
  await fs.writeFile(path.join(root,'Map','MapInfo'),'map metadata');
  await fs.writeFile(path.join(root,'Map','Minimap.tga'),'old overview');
  const png=path.join(root,'.sc2mcp-output','preview.png');await fs.mkdir(path.dirname(png));
  await sharp({create:{width:128,height:128,channels:3,background:{r:20,g:60,b:100}}}).png().toFile(png);
  const workspace=new Workspace(root),integration=new ModkitIntegration(workspace,path.join(root,'missing-install')),preview=new MapPreviewWorkspace(integration);
  preview.preview=async()=>({inputRevision:(await integration.snapshot('Map')).revision,files:{png}} as any);
  const request={directory:'Map',size:128,dryRun:false,stage:false,backup:true,backend:'overview' as const};
  const saved=await preview.rebuildMinimap(request);
  assert.ok('saved' in saved);assert.equal(saved.saved,true);
  assert.equal(await fs.readFile(path.join(root,'Map','Minimap.tga.sc2uimcp.bak'),'utf8'),'old overview');
  await sharp({create:{width:128,height:128,channels:3,background:{r:40,g:80,b:120}}}).png().toFile(png);
  const staged=await preview.rebuildMinimap({...request,stage:true});
  assert.ok('transactionId' in staged);
  await fs.writeFile(path.join(root,'Map','terrain.dat'),'changed terrain');
  await assert.rejects(workspace.binary.save(staged.transactionId!,{dryRun:false}),/STALE_MINIMAP_SOURCE/);
});
