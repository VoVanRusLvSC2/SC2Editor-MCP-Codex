import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {packArchive,extractArchive,readArchiveEntry,archiveBackendAvailable} from '../archive/archiveAdapter.js';
import {createMapInfo} from '../modules/document/codecs/mapInfoFactory.js';
import {routeBoundsCheck} from '../modules/testing/playableBounds.js';
import {testManifestSchema} from '../modules/testing/schemas.js';

test('native bounded component read returns exact neutral bytes without extraction or source mutation',{skip:!archiveBackendAvailable()},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-entry-read-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const components=path.join(root,'Components');await fs.mkdir(components);
 const info=createMapInfo(64,64,'Bounded read fixture',6,0);await fs.writeFile(path.join(components,'MapInfo'),info);
 await fs.writeFile(path.join(components,'Large.bin'),Buffer.alloc(1024*1024+1,7));
 const archive=path.join(root,'Map.SC2Map');await packArchive(components,archive,{backup:false});
 const digest=async()=>createHash('sha256').update(await fs.readFile(archive)).digest('hex'),before=await digest(),names=await fs.readdir(root);
 assert.deepEqual(await readArchiveEntry(archive,'mapinfo'),info);
 await assert.rejects(readArchiveEntry(archive,'Large.bin'),/ENTRY_READ_LIMIT/);
 await assert.rejects(readArchiveEntry(archive,'Missing'),/NOT_FOUND/);
 await assert.rejects(readArchiveEntry(archive,'../MapInfo'),/UNSAFE_ARCHIVE_NAME/);
 await assert.rejects(readArchiveEntry(archive,'(listfile)'),/READ_FORBIDDEN/);
 assert.deepEqual(await fs.readdir(root),names);assert.equal(await digest(),before);
});

test('route bounds use the real MapInfo interval and ignore unused named points',()=>{
 const bytes=createMapInfo(64,64,'Bounds',6,0);
 const input={version:1,map:'Map.SC2Map',game:{points:{a:{x:8,y:8},b:{x:55.9,y:55.9},unused:{x:-100,y:-100}},routes:[{id:'route',from:'a',to:'b',type:'Marine',mobility:'ground'}]}};
 assert.equal(routeBoundsCheck(testManifestSchema.parse(input),bytes).status,'passed');
 const invalid={...input,game:{...input.game,points:{...input.game.points,b:{x:56,y:30}}}};
 const check=routeBoundsCheck(testManifestSchema.parse(invalid),bytes);assert.equal(check.status,'failed');assert.deepEqual(check.evidence?.outside,['b']);
});

test('native Windows extraction keeps sibling staging below the observed path boundary',{skip:process.platform!=='win32'||!archiveBackendAvailable()},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-extract-path-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const entry='enUS.SC2Data/LocalizedData/TriggerStrings.txt',name='a'.repeat(36),components=path.join(root,'Components');
 await fs.mkdir(path.dirname(path.join(components,entry)),{recursive:true});
 const bytes=Buffer.from('Trigger/Name/Test=Preserved native strings\r\n');await fs.writeFile(path.join(components,entry),bytes);
 const archive=path.join(root,'Map.SC2Map');await packArchive(components,archive,{backup:false});
 const before=createHash('sha256').update(await fs.readFile(archive)).digest('hex');
 const parentLength=260-(1+name.length+'.sc2uimcp.'.length+6+1+entry.length);
 assert.ok(parentLength>root.length+1);const parent=path.join(root,'p'.repeat(parentLength-root.length-1));await fs.mkdir(parent);
 const destination=path.join(parent,name);assert.equal((destination+'.sc2uimcp.123456'+path.sep+entry).length,260);
 const result=await extractArchive(archive,destination);
 assert.deepEqual(await fs.readFile(path.join(destination,entry)),bytes);assert.equal(result.verification.entryCount,1);
 assert.equal(createHash('sha256').update(await fs.readFile(archive)).digest('hex'),before);
 assert.deepEqual(await fs.readFile(path.join(components,entry)),bytes);assert.deepEqual(await fs.readdir(parent),[name]);
});
