import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {emitGuiGalaxy} from '../modules/trigger/runtime.js';
import {registry} from '../modules/trigger/authoring.js';
import {Workspace} from '../core/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';
const r=registry(),native=(name:string)=>(r.definitions??r.functions).find(f=>f.name===name)!,ret=native('Return'),set=native('SetVariable'),event=native('TriggerAddEventMapInit');
const ref=(type:string,id:string,library?:string)=>`Type="${type}" Id="${id}"${library===undefined?'':` Library="${library}"`}`;
const literal=(value:number)=>`<Value>${value}</Value><ValueType Type="int"/>`;
const call=()=>`<FunctionCall ${ref('FunctionCall','READ')}/>`;
function fragment(initial:string,assigned:number){return `<Element Type="Variable" Id="V"><Identifier>Counter</Identifier><VariableType><Type Value="int"/></VariableType><Value ${ref('Param','INITIAL')}/></Element><Element Type="Param" Id="INITIAL">${initial}</Element>
 <Element Type="FunctionDef" Id="F"><Identifier>Read</Identifier><FlagCall/><ReturnType><Type Value="int"/></ReturnType><FunctionCall ${ref('FunctionCall','RETURN')}/></Element>
 <Element Type="FunctionCall" Id="RETURN"><FunctionDef ${ref('FunctionDef',ret.id,'Ntve')}/><Parameter ${ref('Param','READ_VALUE')}/></Element><Element Type="Param" Id="READ_VALUE"><ParameterDef ${ref('ParamDef',ret.parameters[0].id,'Ntve')}/><Variable ${ref('Variable','V')}/></Element>
 <Element Type="Trigger" Id="T"><Identifier>Startup</Identifier><Event ${ref('FunctionCall','EVENT')}/><Action ${ref('FunctionCall','SET')}/></Element><Element Type="FunctionCall" Id="EVENT"><FunctionDef ${ref('FunctionDef',event.id,'Ntve')}/></Element>
 <Element Type="FunctionCall" Id="SET"><FunctionDef ${ref('FunctionDef',set.id,'Ntve')}/><Parameter ${ref('Param','DEST')}/><Parameter ${ref('Param','VALUE')}/></Element><Element Type="Param" Id="DEST"><ParameterDef ${ref('ParamDef',set.parameters[0].id,'Ntve')}/><Variable ${ref('Variable','V')}/></Element><Element Type="Param" Id="VALUE"><ParameterDef ${ref('ParamDef',set.parameters[1].id,'Ntve')}/>${literal(assigned)}</Element>`;}
const read=(library:string)=>`<Element Type="FunctionCall" Id="READ"><FunctionDef ${ref('FunctionDef','F',library)}/></Element>`;
const library=(id:string,body:string)=>`<Library Id="${id}"><Root/>${body}</Library>`;
function graph(){return '<TriggerData><Root><Item Type="Library" Id="B"/><Item Type="Library" Id="A"/></Root>'+library('A',fragment(literal(3),13))+library('B',fragment(call(),11)+read('A'))+fragment(call(),17)+read('B')+'</TriggerData>';}
function javascript(source:string){return source.replace(/^include .*$/gm,'').replace(/^(?:void|int|bool|trigger) \w+ \([^\n]*\);$/gm,'').replace(/^(?:void|int|bool|trigger) (\w+) \(([^\n]*)\) \{/gm,(_m,name,args)=>'function '+name+' ('+args.replace(/\b(?:bool|int|trigger)\s+/g,'')+') {').replace(/^(?:int|bool|trigger) (\w+)(?: = ([^;]+))?;$/gm,(_m,name,value)=>'var '+name+(value===undefined?'':' = '+value)+';');}
test('qualified libraries preserve duplicate IDs/names, dependency values and explicit Root callback order',()=>{
 const generated=emitGuiGalaxy(graph(),r),registered:string[]=[],ctx=vm.createContext({libNtve_InitLib:()=>{},TriggerCreate:(name:string)=>({name}),TriggerAddEventMapInit:(trigger:{name:string})=>registered.push(trigger.name)});
 assert.deepEqual(generated.libraries,['B','A']);vm.runInContext(javascript(generated.source)+'\nInitMap();',ctx);
 assert.equal(ctx.libA_gv_Counter,3);assert.equal(ctx.libB_gv_Counter,3);assert.equal(ctx.gv_Counter,3);assert.deepEqual(registered,['libB_gt_Startup_Func','libA_gt_Startup_Func','gt_Startup_Func']);
 vm.runInContext('libB_gt_Startup_Func(false, true);libA_gt_Startup_Func(false, true);gt_Startup_Func(false, true);libA_InitLib();',ctx);
 assert.equal(ctx.libA_gv_Counter,13);assert.equal(ctx.libB_gv_Counter,11);assert.equal(ctx.gv_Counter,17);assert.equal(registered.length,3);
});
test('explicit empty library references remain map-root references from inside a library',()=>{
 const xml=graph().replace(library('B',fragment(call(),11)+read('A')),library('B',fragment(call(),11).replace('<Variable Type="Variable" Id="V"/></Element><Element Type="Param" Id="VALUE">','<Variable Type="Variable" Id="V" Library=""/></Element><Element Type="Param" Id="VALUE">')+read('A')));
 const code=emitGuiGalaxy(xml,r).source;assert.match(code,/bool libB_gt_Startup_Func[\s\S]*?gv_Counter = 11;/);
});
test('array initializers fill each declared cell once, with library-owned state',()=>{
 const xml='<TriggerData><Root><Item Type="Library" Id="A"/></Root>'+library('A','<Element Type="Variable" Id="V"><Identifier>Cells</Identifier><VariableType><Type Value="int"/><ArraySize Dim="0" Value="1"/><ArraySize Dim="1" Value="2"/></VariableType><Value Type="Param" Id="I"/></Element><Element Type="Param" Id="I">'+literal(7)+'</Element>')+'</TriggerData>';
 const code=emitGuiGalaxy(xml,r).source,js=javascript(code).replace('int[2][3] libA_gv_Cells;','var libA_gv_Cells = Array.from({length:2}, ()=>Array(3).fill(0));'),ctx=vm.createContext({libNtve_InitLib:()=>{}});vm.runInContext(js+'\nInitMap();',ctx);
 assert.equal(JSON.stringify(ctx.libA_gv_Cells),'[[7,7,7],[7,7,7]]');vm.runInContext('libA_gv_Cells[1][2]=9;libA_InitVariables();',ctx);assert.equal(ctx.libA_gv_Cells[1][2],9);
});
test('library record reference parameters keep structref syntax and member mutation',()=>{
 const body='<Element Type="Structure" Id="S"><Identifier>Row</Identifier><Variable Type="Variable" Id="FIELD"/></Element><Element Type="Variable" Id="FIELD"><Identifier>Value</Identifier><VariableType><Type Value="int"/></VariableType></Element>'+
 '<Element Type="FunctionDef" Id="F"><Identifier>Write</Identifier><FlagAction/><Parameter Type="ParamDef" Id="P"/><FunctionCall Type="FunctionCall" Id="C"/></Element><Element Type="ParamDef" Id="P"><Identifier>row</Identifier><ParamFlagReference/><ParameterType><Type Value="struct"/><TypeElement Type="Structure" Id="S"/></ParameterType></Element>'+
 `<Element Type="FunctionCall" Id="C"><FunctionDef ${ref('FunctionDef',set.id,'Ntve')}/><Parameter Type="Param" Id="DEST"/><Parameter Type="Param" Id="VAL"/></Element><Element Type="Param" Id="DEST"><ParameterDef ${ref('ParamDef',set.parameters[0].id,'Ntve')}/><Parameter Type="ParamDef" Id="P"/><StructMember Type="Param" Id="M"/></Element><Element Type="Param" Id="M"><Variable Type="Variable" Id="FIELD"/></Element><Element Type="Param" Id="VAL"><ParameterDef ${ref('ParamDef',set.parameters[1].id,'Ntve')}/>${literal(23)}</Element>`;
 const xml='<TriggerData><Root><Item Type="Library" Id="A"/></Root>'+library('A',body)+'</TriggerData>',code=emitGuiGalaxy(xml,r).source;assert.match(code,/void libA_gf_Write \(structref<libA_gs_Row> lp_row\)/);assert.match(code,/lp_row\.lv_Value = 23;/);
 const js=javascript(code.replace(/struct libA_gs_Row \{[\s\S]*?\n\};/,'').replaceAll('structref<libA_gs_Row> ','')),ctx=vm.createContext({libNtve_InitLib:()=>{},row:{lv_Value:0}});vm.runInContext(js+'\nlibA_gf_Write(row);',ctx);assert.equal(ctx.row.lv_Value,23);
});
test('foreign formal bindings, scoped duplicates, absent libraries and initialization cycles reject',()=>{
 const xml=graph();assert.throws(()=>emitGuiGalaxy(xml.replace(`<ParameterDef ${ref('ParamDef',set.parameters[0].id,'Ntve')}/>`,`<ParameterDef ${ref('ParamDef',set.parameters[0].id,'A')}/>`),r),/FORMAL_BINDING/);
 assert.throws(()=>emitGuiGalaxy(xml.replace('</TriggerData>','<Element Type="Variable" Id="V"/></TriggerData>'),r),/DUPLICATE_ELEMENT/);
 assert.throws(()=>emitGuiGalaxy(xml.replace('Library="A"/>','Library="Missing"/>'),r),/FOREIGN_LIBRARY_UNSUPPORTED/);
 assert.throws(()=>emitGuiGalaxy(xml.replace(fragment(literal(3),13),fragment(call(),13)+read('B')),r),/INITIALIZATION_CYCLE/);
 assert.throws(()=>emitGuiGalaxy(xml.replace('<Item Type="Library" Id="B"/>',''),r),/LIBRARY_ROOT/);
});
test('reviewed self-contained libraries import atomically without rewriting GUI or localization IDs',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-library-runtime-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const before='<TriggerData><Root/></TriggerData>',script='void InitMap () {}',xml=graph();
 for(const [file,value]of Object.entries({'Triggers':before,'MapScript.galaxy':script,'reviewed.xml':xml,'labels.json':JSON.stringify({'FunctionDef/Name/lib_A_F':'Read'})}))await fs.writeFile(path.join(root,file),value);
 const ws=new Workspace(root),tr=new TriggerWorkspace(ws),hash=(s:string)=>createHash('sha256').update(s).digest('hex'),args={file:'reviewed.xml',stringsFile:'labels.json',expectedSourceSha256:hash(before),expectedRuntimeSha256:hash(script),dryRun:false,stage:true};
 const result=await tr.importRevised(args);assert.equal(result.compiler,'NOT_EXECUTED');assert.equal(result.counts.libraries.length,2);assert.equal(await fs.readFile(path.join(root,'Triggers'),'utf8'),before);assert.equal((await ws.readRaw('Triggers')).text,xml);
 await tr.save(false);assert.equal(await fs.readFile(path.join(root,'Triggers'),'utf8'),xml);assert.match(await fs.readFile(path.join(root,'MapScript.galaxy'),'utf8'),/libA_gf_Read/);assert.match(await fs.readFile(path.join(root,'enUS.SC2Data/LocalizedData/TriggerStrings.txt'),'utf8'),/FunctionDef\/Name\/lib_A_F=Read/);
});
