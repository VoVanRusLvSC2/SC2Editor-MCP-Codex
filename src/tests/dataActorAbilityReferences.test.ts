import test from 'node:test';
import assert from 'node:assert/strict';
import {scanXml} from '../core/xmlScanner.js';
import {actorEvents} from '../modules/data/actorEvents.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
test('main Actor ability selectors are typed Abil references while animation labels remain opaque',()=>{
 const xml='<Catalog><CActorUnit id="HeroActor"><On Terms="Abil.Strike.SourceCastStart" Send="AnimPlay MCP_Strike_cast Attack"/><On Terms="Abil.Strike.SourceCastStop; ValidateUnit Special" Send="AnimClear MCP_Strike_cast"/><On Terms="Abil.*.SourceChannelStop" Send="AnimClear Any"/></CActorUnit></Catalog>',p=scanXml(xml),r=actorEvents(xml,p.nodes.find(n=>n.tag==='CActorUnit')!,p.nodes,raw=>raw);
 assert.deepEqual(r.references.map(e=>[e.domain,e.value,e.unknown]),[['Abil','Strike',false],['Abil','Strike',false],['Abil','*',true]]);
 for(const e of r.references)assert.equal(xml.slice(e.start,e.end),e.raw);
 assert.equal(r.references.some(e=>e.raw.includes('MCP_')),false);
 assert.ok(!r.issues.some(i=>i.code==='ACTOR_MESSAGE_SIGNATURE_UNKNOWN'));
});
test('unknown animation message forms keep coverage unknown instead of hiding possible catalog consumers',()=>{
 for(const send of ['AnimPlay Name Attack; Create Other','AnimPlay Name Attack ExtraCatalogId','AnimFutureName ActorOrModel','AnimClear Name Other']){
  const xml='<Catalog><CActorUnit id="Main"><On Terms="Abil.Strike.SourceCastStart" Send="'+send+'"/></CActorUnit></Catalog>',p=scanXml(xml),r=actorEvents(xml,p.nodes.find(n=>n.tag==='CActorUnit')!,p.nodes,raw=>raw);assert.ok(r.issues.some(i=>i.code==='ACTOR_MESSAGE_SIGNATURE_UNKNOWN'),send);
 }
});
test('ability rename updates main Actor phase references without renaming independent animation labels',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-main-actor-reference-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/Test.xml';
 await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),'<Catalog><CAbilEffectTarget id="Strike"/><CActorUnit id="Main"><On Terms="Abil.Strike.SourceCastStart" Send="AnimPlay MCP_StableBinding_cast Attack"/><On Terms="Abil.Strike.SourceCastStop" Send="AnimClear MCP_StableBinding_cast"/></CActorUnit></Catalog>');
 await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Test.xml"/></Includes>');
 const data=new DataWorkspace(new Workspace(root)),r=await data.apply({file,operations:[{op:'object.rename',object:{domain:'Abil',id:'Strike'},newId:'Renamed',updateReferences:true}],dryRun:false,stage:true});assert.equal(r.authoring.accepted,true);
 const source=(await data.workspace.readRaw(file)).text;assert.ok(source.includes('Abil.Renamed.SourceCastStart'));assert.ok(source.includes('Abil.Renamed.SourceCastStop'));assert.ok(source.includes('MCP_StableBinding_cast'));assert.ok(!source.includes('Abil.Strike.'));
});
