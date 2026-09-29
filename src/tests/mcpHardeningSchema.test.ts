import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DataXsdRegistry} from '../modules/data/xsdRegistry.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {Workspace} from '../core/workspace.js';
import {projectPath} from '../app/paths.js';
import {galaxyReferences} from '../modules/data/crossReferences.js';
const run=promisify(execFile);
test('M28 QName/inline/group/facet generation is deterministic and failed replacement preserves previous index',async t=>{
 const base=projectPath('generated/mcp-hardening/xsd-probe-'+process.pid),output=path.join(base,'data-xsd-index'),input=path.join(base,'schema.xsd');assert.ok(base.startsWith(projectPath('generated')+path.sep));await fs.mkdir(base,{recursive:true});t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const source='<s:schema xmlns:s="http://www.w3.org/2001/XMLSchema" xmlns:t="urn:test" xmlns:f="urn:foreign" targetNamespace="urn:test"><s:simpleType name="simple_CEffectLink"><s:restriction base="s:string"><s:enumeration value="A"/></s:restriction></s:simpleType><s:complexType name="CEffectLink"><s:attribute name="value" type="t:simple_CEffectLink"/></s:complexType><s:attributeGroup name="Indexes"><s:attribute name="index" type="s:int"/></s:attributeGroup><s:complexType name="CEffectSet"><s:sequence minOccurs="0"><s:element name="EffectArray" maxOccurs="unbounded"><s:complexType><s:complexContent><s:extension base="t:CEffectLink"><s:attributeGroup ref="t:Indexes"/></s:extension></s:complexContent></s:complexType></s:element><s:element name="Foreign" type="f:CEffectLink"/></s:sequence></s:complexType></s:schema>';
 await fs.writeFile(input,source);const generate=()=>run(process.execPath,['--import','tsx',projectPath('scripts/index-data-xsd.ts'),input,'--output='+output],{cwd:projectPath(''),timeout:15000});await generate();const manifest=await fs.readFile(path.join(output,'manifest.json'),'utf8'),registry=new DataXsdRegistry(path.join(output,'manifest.json')),type=registry.describe('CEffectSet')!;
 assert.equal(registry.manifest()?.targetNamespace,'urn:test');assert.equal(type.fields.length,2);assert.equal(type.fields.some(f=>f.name==='index'),false);const inline=type.fields[0].inlineType!;assert.equal(inline.baseNamespace,'urn:test');assert.equal(registry.members(inline).find(f=>f.name==='value')?.typeNamespace,'urn:test');assert.equal(registry.linkDomain(inline),'Effect');assert.equal(registry.fieldType('CEffectSet',['Foreign']),undefined);assert.equal(registry.describe('simple_CEffectLink')?.enumValues[0],'A');assert.equal(type.fields[0].particle?.[0].minOccurs,'0');
 const shards=new Map<string,string>();for(const f of await fs.readdir(path.join(output,'types')))shards.set(f,await fs.readFile(path.join(output,'types',f),'utf8'));await generate();assert.equal(await fs.readFile(path.join(output,'manifest.json'),'utf8'),manifest);for(const [file,value]of shards)assert.equal(await fs.readFile(path.join(output,'types',file),'utf8'),value);
 await fs.writeFile(input,'<broken>');await assert.rejects(generate());assert.equal(await fs.readFile(path.join(output,'manifest.json'),'utf8'),manifest);
 const descriptor=registry.manifest()!.types.find(t=>t.name==='CEffectSet')!,shard=path.join(output,descriptor.shard),stat=await fs.stat(shard),modified={...type,fields:[{kind:'element',name:'Changed'}]};await fs.writeFile(shard,JSON.stringify(modified));await fs.utimes(shard,stat.atime,stat.mtime);assert.equal(registry.describe('CEffectSet')?.fields[0].name,'Changed');assert.equal(registry.sources().some(s=>s.file===shard),true);
});
test('M27 Data fields and references advertise truncation and selectable details',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-pages-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/EffectData.xml';await fs.mkdir(path.join(root,path.dirname(file)),{recursive:true});await fs.writeFile(path.join(root,file),'<Catalog><CEffectDamage id="Target"/><CEffectSet id="Many">'+Array.from({length:220},(_,i)=>'<EffectArray index="'+i+'" value="Target"/>').join('')+'</CEffectSet></Catalog>');const data=new DataWorkspace(new Workspace(root));const context=await data.context({ids:['Many'],includeReferences:false});assert.equal(context.objects[0].fields.length,200);assert.equal(context.objects[0].fieldPagination.total,220);assert.equal(context.objects[0].fieldPagination.truncated,true);const exact=await data.resolveFields({id:'Many',domain:'Effect',fields:['EffectArray[219]']});assert.equal(exact.objects[0].effective!.fields['EffectArray[219]'].value,'Target');const first=await data.referenceQuery({id:'Target',domain:'Effect',direction:'incoming',limit:10});assert.equal(first.total,220);assert.equal(first.truncated,true);assert.equal(first.next,10);const second=await data.referenceQuery({id:'Target',domain:'Effect',direction:'incoming',offset:10,limit:10});assert.notDeepEqual(first.items.map(r=>r.path),second.items.map(r=>r.path));
});
test('M22 Galaxy local shadow is dynamic instead of incorrectly resolving a global constant',()=>{
 const r=galaxyReferences('a.galaxy','const string TYPE="Marine"; void Run(){string TYPE=GetType();UnitCreate(1,TYPE,0,1,null,0);}');assert.equal(r.references.length,0);assert.equal(r.issues[0].code,'GALAXY_DYNAMIC_CATALOG_REFERENCE');
});

test('M27 query filters before pagination and returns accurate matching counts',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-query-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/UnitData.xml';await fs.mkdir(path.join(root,path.dirname(file)),{recursive:true});await fs.writeFile(path.join(root,file),'<Catalog>'+Array.from({length:220},(_,i)=>'<CUnit id="Unit'+i+'"/>').join('')+'<CUnit id="LastObject"/></Catalog>');const data=new DataWorkspace(new Workspace(root)),last=await data.query({text:'LastObject'});assert.equal(last.objects[0].id,'LastObject');assert.equal(last.pagination.total,1);const page=await data.query({text:'Unit2',offset:20,limit:5});assert.equal(page.objects.length,5);assert.equal(page.pagination.total,31);assert.equal(page.pagination.next,25);
});
