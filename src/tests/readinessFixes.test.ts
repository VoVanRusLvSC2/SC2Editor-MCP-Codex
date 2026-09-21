import assert from 'node:assert/strict';
import test from 'node:test';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../core/workspace.js';
import {scanXml} from '../core/xmlScanner.js';
import {DataDocument} from '../modules/data/document.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {BrowseWorkspace} from '../modules/browse/workspace.js';
import {ScriptWorkspace} from '../modules/script/workspace.js';
import {TextSchemaRegistry} from '../modules/text/schemaRegistry.js';
import {createProject} from '../app/project.js';
import {projectPreflight} from '../app/preflight.js';
import {validateTextSources} from '../modules/text/validator.js';
async function fixture(t:{after(fn:()=>Promise<void>):void}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-ready-fix-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return new Workspace(root);}
test('XML rejects invalid literals/comments/tag whitespace and preserves valid original attribute spans',()=>{
 for(const source of ['<Catalog><!--invalid -- comment--></Catalog>','<Catalog><!--trailing---></Catalog>','<Catalog><CUnit id="A" value="\u0001"/></Catalog>','<Catalog>< CUnit id="A"/></Catalog>','<Catalog><CUnit id="A"/ ></Catalog>','<Catalog>]]></Catalog>','<![CDATA[outside]]><Catalog/>','<>'])assert.ok(scanXml(source).diagnostics.some(d=>d.severity==='error'),source);
 const source='<Catalog>\r\n<CUnit\r\n id = \'A&amp;B\' ><Unknown value="😀"/></CUnit>\r\n</Catalog>';
 const d=new DataDocument(source);assert.equal(d.diagnostics.length,0);d.renameObject('CUnit:A&B','New');assert.equal(d.source,source.replace("'A&amp;B'","'New'"));
 const invalid=new DataDocument('<Catalog><CUnit id="A" value="\u0001"/></Catalog>');const before=invalid.source;assert.throws(()=>invalid.renameObject('CUnit:A','B'),/INVALID_XML_SOURCE/);assert.equal(invalid.source,before);
});
test('staged native catalog is visible to Data and Browse before save, disappears on discard',async t=>{
 const w=await fixture(t);await fs.mkdir(w.resolveUserPath('Base.SC2Data/GameData'),{recursive:true});await fs.writeFile(w.resolveUserPath('Base.SC2Data/GameData.xml'),'<Includes/>');const data=new DataWorkspace(w),browse=new BrowseWorkspace(w,data);
 await w.applyRawTransaction(['Base.SC2Data/GameData.xml','Base.SC2Data/GameData/New.xml'],()=>new Map([['Base.SC2Data/GameData.xml','<Includes><Catalog path="GameData/New.xml"/></Includes>'],['Base.SC2Data/GameData/New.xml','<Catalog><CUnit id="StagedUnit"/></Catalog>']]),{dryRun:false,stage:true});
 assert.deepEqual((await data.context({activeOnly:true})).objects.map(o=>o.id),['StagedUnit']);assert.equal((await data.context({file:'Base.SC2Data/GameData/New.xml',activeOnly:true})).objects[0]?.engineActive,true);assert.equal((await browse.resolve({catalogType:'Unit',id:'StagedUnit'})).dependencyReady,true);w.discard('Base.SC2Data/GameData/New.xml');assert.equal((await data.context()).objects.length,0);
});
test('effective resolves active parents and records unresolved parents without inactive inherited values',async t=>{
 const w=await fixture(t);await fs.mkdir(w.resolveUserPath('Base.SC2Data/GameData'),{recursive:true});await fs.writeFile(w.resolveUserPath('Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Child.xml"/></Includes>');await fs.writeFile(w.resolveUserPath('Base.SC2Data/GameData/AInactive.xml'),'<Catalog><CUnit id="Base"><LifeMax value="999"/></CUnit></Catalog>');await fs.writeFile(w.resolveUserPath('Base.SC2Data/GameData/Child.xml'),'<Catalog><CUnit id="Child" parent="Base"/></Catalog>');const data=new DataWorkspace(w);const child=(await data.context({activeOnly:true})).objects[0]!;assert.deepEqual(child.effective?.templateChain.map(x=>x.id),['Child']);assert.equal(child.effective?.fields.LifeMax,undefined);assert.deepEqual(child.effective?.unresolvedParents,[{id:'Base',reason:'ACTIVE_PARENT_UNRESOLVED'}]);await fs.writeFile(w.resolveUserPath('Base.SC2Data/GameData/ActiveBase.xml'),'<Catalog><CUnit id="Base"><LifeMax value="42"/></CUnit></Catalog>');await fs.writeFile(w.resolveUserPath('Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Child.xml"/><Catalog path="GameData/ActiveBase.xml"/></Includes>');assert.equal((await data.context({ids:['Child'],activeOnly:true})).objects[0]?.effective?.fields.LifeMax.value,'42');
});
test('script connect rejects conditional and expression-bound init calls before staging',async t=>{
 const w=await fixture(t),s=new ScriptWorkspace(w);await fs.writeFile(w.resolveUserPath('Custom.galaxy'),'void CustomInit () {}');for(const body of ['if (false) { CustomInit(); }','while (false) { CustomInit(); }','if (false) CustomInit();','Other(CustomInit());']){await fs.writeFile(w.resolveUserPath('MapScript.galaxy'),`void InitMap () { ${body} }`);await assert.rejects(s.plan({operations:[{op:'connect',file:'Custom.galaxy',init:'CustomInit'}]}),/CONTROL_FLOW_UNVERIFIED/);assert.equal(w.draftFiles().length,0);}
});
test('empty Galaxy file creation is a dry-run existence change and stages/saves with the full group',async t=>{
 const w=await fixture(t),s=new ScriptWorkspace(w);await fs.writeFile(w.resolveUserPath('MapScript.galaxy'),'void InitMap () {}');const p=await s.plan({operations:[{op:'file.create',file:'Empty.galaxy',source:''},{op:'function.body',file:'MapScript.galaxy',name:'InitMap',body:' int x = 1; '}]});const dry=await s.apply(p.planId,true);assert.ok('files' in dry&&dry.files.find(f=>f.file==='Empty.galaxy')?.changed);assert.equal(w.hasDraft('Empty.galaxy'),false);await s.apply(p.planId,false);assert.equal(w.hasDraft('Empty.galaxy'),true);const saved=await s.save('Empty.galaxy',false);assert.deepEqual(saved.savedFiles.sort(),['Empty.galaxy','MapScript.galaxy']);assert.equal(await fs.readFile(w.resolveUserPath('Empty.galaxy'),'utf8'),'');assert.match(await fs.readFile(w.resolveUserPath('MapScript.galaxy'),'utf8'),/int x = 1/);assert.equal(w.draftFiles().length,0);
});
test('empty staged creation detects external competing creation and can be discarded',async t=>{
 const w=await fixture(t);await w.applyRawTransaction(['empty.SC2Layout'],()=>new Map([['empty.SC2Layout','']]),{requireMissing:true,dryRun:false,stage:true});assert.equal(w.hasDraft('empty.SC2Layout'),true);await fs.writeFile(w.resolveUserPath('empty.SC2Layout'),'external');await assert.rejects(w.save('empty.SC2Layout',{backup:false}),/STALE_TEXT_DRAFT/);w.discard('empty.SC2Layout');assert.equal(await fs.readFile(w.resolveUserPath('empty.SC2Layout'),'utf8'),'external');
});
test('inline styles use parsed logical entity values and quoted delimiters, retaining unknown-style diagnostics',async()=>{
 const schema=await TextSchemaRegistry.load(),styles=new Map([['styles.SC2Style','<StyleFile><Style name="A&amp;B"/><Style name="A&gt;B"/></StyleFile>']]);const valid=validateTextSources(styles,new Map([['enUS.SC2Data/LocalizedData/GameStrings.txt',"One=<s val=\"A&amp;B\"><s val='A>B'>text</s></s>\n"]]),schema);assert.equal(valid.diagnostics.filter(d=>d.code==='MISSING_INLINE_STYLE').length,0);const invalid=validateTextSources(styles,new Map([['enUS.SC2Data/LocalizedData/GameStrings.txt','Key=<s val="Missing&amp;Style">x</s>\n']]),schema);assert.equal(invalid.diagnostics.find(d=>d.code==='MISSING_INLINE_STYLE')?.message,"Key references unknown style 'Missing&Style'");
});

test('project preflight exposes incomplete standard coverage and blocks missing foundations and unsaved edits',async t=>{const w=await fixture(t),project=await createProject(w.root);let report=await projectPreflight(project);assert.equal(report.readyForEditorTest,false);assert.equal(report.standardFunctionCoverage,'PARTIAL');assert.equal(report.targetChecks.editorSaveReopen,'NOT_EXECUTED');assert.ok(report.checks.some(c=>c.name==='map-and-terrain'&&c.status==='FAIL'));await project.workspace.applyRawTransaction(['Pending.galaxy'],()=>new Map([['Pending.galaxy','void Pending () {}']]),{dryRun:false,stage:true});report=await projectPreflight(project);assert.deepEqual(report.pendingFiles,['Pending.galaxy']);assert.equal(report.readyForEditorTest,false);});

test('explicit native Includes discovers staged catalogs outside conventional GameData filenames',async t=>{const w=await fixture(t);await w.applyRawTransaction(['Base.SC2Data/GameData.xml','Base.SC2Data/Custom/Catalog.xml'],()=>new Map([['Base.SC2Data/GameData.xml','<Includes><Catalog path="Custom/Catalog.xml"/></Includes>'],['Base.SC2Data/Custom/Catalog.xml','<Catalog><CUnit id="CustomUnit"/></Catalog>']]),{dryRun:false,stage:true});const data=new DataWorkspace(w);assert.deepEqual((await data.context({activeOnly:true})).objects.map(o=>o.id),['CustomUnit']);assert.equal((await data.context({file:'Base.SC2Data/Custom/Catalog.xml',activeOnly:true})).objects[0]?.engineActive,true);});
