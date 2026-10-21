import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareEditorLoad} from '../modules/map/editorLoad.js';
import {versionMarker,readVersion} from '../modules/document/codecs/metadata.js';
import {Workspace} from '../core/workspace.js';
import {MapWorkspace} from '../modules/map/workspace.js';
import {scanXml} from '../core/xmlScanner.js';

function fixture(){return new Map([
 ['Objects',Buffer.from('<PlacedObjects Version="27"><ObjectUnit Id="1" Position="1,2,0" UnitType="Marine" Player="1"/><ObjectDoodad Id="2" Position="3,4,8" Type="AgriaTree" Variation="1"/><ObjectDoodad Id="3" Position="4,5,8" Type="AgriaTree"/></PlacedObjects>')],
 ['Preload.xml',Buffer.from('<Preload><Movie id="UserMovie" Future="keep"/><Actor id="AgriaTree" Variations="2"/></Preload>')],
 ['ComponentList.SC2Components',Buffer.from('<Components/>')],
 ['t3Terrain.xml',Buffer.from('<terrain><heightMap tileSet="Agria"/></terrain>')],
 ['MapInfo.version',versionMarker('mapi',{major:5,minor:0,patch:17,build:98310},1792517421,1)],
 ]);}
test('native preload includes all placed identities, merges variations, preserves manual entries and is idempotent',()=>{
 const f=fixture(),r=prepareEditorLoad(f),xml=r.next.get('Preload.xml')!.toString(),p=scanXml(xml);
 for(const [tag,id] of [['Actor','SYSTEM_ActorConfig'],['Actor','AgriaTree'],['Unit','Marine'],['Terrain','Agria']])assert.equal(p.nodes.filter(n=>n.tag===tag&&n.attrs.id===id).length,1);
 assert.equal(p.nodes.find(n=>n.attrs.id==='AgriaTree')!.attrs.Variations,'0,1,2');
 assert.ok(xml.includes('<Movie id="UserMovie" Future="keep"/>'));assert.ok(r.next.get('Objects')!.equals(f.get('Objects')!));
 assert.equal(readVersion(r.next.get('Objects.version')!).tag,'plob');
 assert.ok(r.next.get('ComponentList.SC2Components')!.toString().includes('Type="plob"'));
 assert.deepEqual(prepareEditorLoad(r.next).changed,[]);
});
test('load preparation rejects malformed preload or marker without fabricating metadata',()=>{
 const f=fixture();f.set('Preload.xml',Buffer.from('<Bad/>'));assert.throws(()=>prepareEditorLoad(f),/PRELOAD_XML_INVALID/);
 f.set('Preload.xml',Buffer.from('<Preload/>'));f.set('Objects.version',f.get('MapInfo.version')!);assert.throws(()=>prepareEditorLoad(f),/VERSION_TAG/);
 f.delete('Objects.version');f.delete('MapInfo.version');assert.throws(()=>prepareEditorLoad(f),/VERSION_SOURCE_REQUIRED/);
});
test('MCP map preparation is dry-run by default, preserves placement and saves all load metadata together',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-editor-load-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const f=fixture();for(const [file,bytes] of f)await fs.writeFile(path.join(root,file),bytes);
 const map=new MapWorkspace(new Workspace(root));await map.prepareEditor();await assert.rejects(fs.stat(path.join(root,'Objects.version')));
 await map.prepareEditor('',false);assert.equal((await fs.readFile(path.join(root,'Preload.xml'),'utf8')).includes('SYSTEM_ActorConfig'),true);
 assert.ok((await fs.readFile(path.join(root,'Objects'))).equals(f.get('Objects')!));
 assert.equal(readVersion(await fs.readFile(path.join(root,'Objects.version'))).tag,'plob');
 const again=await map.prepareEditor('',false);assert.deepEqual(again.editorLoad!.changed,[]);
});
