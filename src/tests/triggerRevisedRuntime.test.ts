import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';
import {emitGuiGalaxy} from '../modules/trigger/runtime.js';
import {registry,type GuiCall,type GuiValue} from '../modules/trigger/authoring.js';
const int=(value:number):GuiValue=>({kind:'literal',type:'int',value});
const count:GuiValue={kind:'variable',name:'Count'};
const compare=(op:string,value:number):GuiCall=>({kind:'Condition',function:'Comparison',args:{val1:count,op:{kind:'preset',name:op},val2:int(value)}});
const set=(value:number):GuiCall=>({kind:'Action',function:'SetVariable',args:{var:count,val:int(value)}});
test('revised GUI else-if chains remain exclusive, boolean groups and skip/increment execute correctly',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-gui-runtime-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Root/></TriggerData>');
 const ws=new Workspace(root),tr=new TriggerWorkspace(ws);
 const branch=(condition:GuiCall,value:number):GuiCall=>({kind:'Action',function:'IfThen',args:{},children:[{role:'if',call:condition},{role:'then',call:set(value)}]});
 const plan=await tr.plan({variables:[{name:'Count',type:'int',initial:int(0)}],functions:[{name:'Choose',kind:'Action',calls:[{kind:'Action',function:'IfThenMultiple',args:{},children:[{role:'IfThen',call:branch({kind:'Condition',function:'Not',args:{},children:[{role:'cond',call:compare('gt',0)}]},1)},{role:'IfThen',call:branch({kind:'Condition',function:'Or',args:{},children:[{role:'cond',call:compare('eq',1)},{role:'cond',call:compare('eq',0)}]},2)}]}]},{name:'Stop',kind:'Action',calls:[{kind:'Action',function:'IncrementInteger',args:{var:count,operator:{kind:'preset',name:'plus'},val:int(2)}},{kind:'Action',function:'SkipRemaining',args:{}},set(99)]}],calls:[]});
 await tr.applyPlan(plan.planId,false);
 const code=emitGuiGalaxy((await ws.readRaw('Triggers')).text,registry()).source;
 const js=code.replace(/^include .*$/gm,'').replace(/^(?:void|int|bool) \w+ \([^\n]*\);$/gm,'').replace(/^(?:void|int|bool) (\w+) \(([^\n]*)\) \{/gm,'function $1 ($2) {').replace(/^int (gv_\w+);$/gm,'var $1;');
 const ctx=vm.createContext({libNtve_InitLib:()=>{}});vm.runInContext(js+'\nInitGlobals();gf_Choose();',ctx);assert.equal(ctx.gv_Count,1);
 vm.runInContext('gf_Stop();',ctx);assert.equal(ctx.gv_Count,3);
});
test('abilcmd literals use ValueId for command index rather than stringifying the command',()=>{
 const r=registry(),order=(r.definitions??r.functions).find(f=>f.name==='Order')!,ret=(r.definitions??r.functions).find(f=>f.name==='Return')!;
 const xml=`<TriggerData><Root/><Element Type="FunctionDef" Id="F"><Identifier>Command</Identifier><FlagCall/><ReturnType><Type Value="order"/></ReturnType><FunctionCall Type="FunctionCall" Id="R"/></Element><Element Type="FunctionCall" Id="R"><FunctionDef Type="FunctionDef" Library="Ntve" Id="${ret.id}"/><Parameter Type="Param" Id="P"/></Element><Element Type="Param" Id="P"><ParameterDef Type="ParamDef" Library="Ntve" Id="${ret.parameters[0].id}"/><FunctionCall Type="FunctionCall" Id="O"/></Element><Element Type="FunctionCall" Id="O"><FunctionDef Type="FunctionDef" Library="Ntve" Id="${order.id}"/><Parameter Type="Param" Id="C"/></Element><Element Type="Param" Id="C"><ParameterDef Type="ParamDef" Library="Ntve" Id="${order.parameters[0].id}"/><Value>attack</Value><ValueId Id="2"/><ValueType Type="abilcmd"/><ValueTypeInfo Value="1"/></Element></TriggerData>`;
 assert.match(emitGuiGalaxy(xml,r).source,/Order\(AbilityCommand\("attack", 2\)\)/);
});

test('native empty GUI unit filter is a handle constructor, and unknown filter literals fail closed',()=>{
 const r=registry(),ret=(r.definitions??r.functions).find(f=>f.name==='Return')!;
 const xml=`<TriggerData><Root/><Element Type="FunctionDef" Id="F"><Identifier>Filter</Identifier><FlagCall/><ReturnType><Type Value="unitfilter"/></ReturnType><FunctionCall Type="FunctionCall" Id="R"/></Element><Element Type="FunctionCall" Id="R"><FunctionDef Type="FunctionDef" Library="Ntve" Id="${ret.id}"/><Parameter Type="Param" Id="P"/></Element><Element Type="Param" Id="P"><ParameterDef Type="ParamDef" Library="Ntve" Id="${ret.parameters[0].id}"/><Value>-;-</Value><ValueType Type="unitfilter"/></Element></TriggerData>`;
 assert.match(emitGuiGalaxy(xml,r).source,/return UnitFilter\(0, 0, 0, 0\);/);
 assert.throws(()=>emitGuiGalaxy(xml.replace('<Value>-;-</Value>','<Value>Ground;-</Value>'),r),/UNIT_FILTER_LITERAL_UNSUPPORTED/);
});

test('descending GUI integer loops visit all elements instead of skipping cleanup',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-gui-descending-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Root/></TriggerData>');
 const ws=new Workspace(root),tr=new TriggerWorkspace(ws);
 const plan=await tr.plan({variables:[{name:'Count',type:'int',initial:int(0)},{name:'Cursor',type:'int'}],functions:[{name:'Sweep',kind:'Action',calls:[{kind:'Action',function:'ForEachInteger',args:{var:{kind:'variable',name:'Cursor'},s:int(3),e:int(1),increment:int(-1)},children:[{role:'actions',call:{kind:'Action',function:'IncrementInteger',args:{var:count,operator:{kind:'preset',name:'plus'},val:int(1)}}}]}]}],calls:[]});
 await tr.applyPlan(plan.planId,false);
 const code=emitGuiGalaxy((await ws.readRaw('Triggers')).text,registry()).source;
 const js=code.replace(/^include .*$/gm,'').replace(/^(?:void|int|bool) \w+ \([^\n]*\);$/gm,'').replace(/^(?:void|int|bool) (\w+) \(([^\n]*)\) \{/gm,'function $1 ($2) {').replace(/^int (gv_\w+);$/gm,'var $1;');
 const ctx=vm.createContext({libNtve_InitLib:()=>{}});vm.runInContext(js+'\nInitGlobals();gf_Sweep();',ctx);assert.equal(ctx.gv_Count,3);assert.equal(ctx.gv_Cursor,0);
});
