import test from 'node:test';import assert from 'node:assert/strict';import{promises as fs}from'node:fs';import path from'node:path';import os from'node:os';
import{Workspace}from'../core/workspace.js';import{DataWorkspace}from'../modules/data/workspace.js';import{DataSchemaRegistry}from'../modules/data/schemaRegistry.js';
test('Mounted native dependency profiles activate standard catalogs but preserve explicit local/custom boundaries',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-catalog-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const map=path.join(root,'map'),core=path.join(root,'core.sc2mod'),liberty=path.join(root,'liberty.sc2mod');for(const p of [map,core,liberty])await fs.mkdir(path.join(p,'Base.SC2Data/GameData'),{recursive:true});
 await fs.writeFile(path.join(map,'DocumentInfo'),'<DocInfo><Dependencies><Value>file:Mods/Liberty.SC2Mod</Value></Dependencies></DocInfo>');
 await fs.writeFile(path.join(liberty,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Extra.xml"/></Includes>');
 await fs.writeFile(path.join(liberty,'Base.SC2Data/GameData/WaterData.xml'),'<Catalog><CWater id="Agria"/></Catalog>');
 await fs.writeFile(path.join(liberty,'Base.SC2Data/GameData/Other.xml'),'<Catalog><CWater id="Hidden"/></Catalog>');
 await fs.writeFile(path.join(liberty,'Base.SC2Data/GameData/Extra.xml'),'<Catalog><CWater id="Extra"/></Catalog>');
 const data=new DataWorkspace(new Workspace(map),DataSchemaRegistry.lazy());data.nativeCatalogFiles=new Set(['waterdata.xml']);data.addDependencyRoot(core,'mods/core.sc2mod');data.addDependencyRoot(liberty,'mods/liberty.sc2mod');
 assert.equal((await data.metadataEntry('Water','Agria')).available,true);assert.equal((await data.metadataEntry('Water','Hidden')).available,false);assert.equal((await data.metadataEntry('Water','Extra')).available,true);
 const plain=new DataWorkspace(new Workspace(map),DataSchemaRegistry.lazy());plain.nativeCatalogFiles=data.nativeCatalogFiles;plain.addDependencyRoot(liberty);assert.equal((await plain.metadataEntry('Water','Agria')).available,false);
 await fs.writeFile(path.join(map,'DocumentInfo'),'<DocInfo><Dependencies/></DocInfo>');assert.equal((await data.metadataEntry('Water','Agria')).available,false);
});
