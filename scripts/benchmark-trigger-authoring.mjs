import fs from 'node:fs/promises';import {Buffer} from 'node:buffer';import path from 'node:path';import process from 'node:process';import console from 'node:console';import {performance} from 'node:perf_hooks';import assert from 'node:assert/strict';
import {Workspace} from '../dist/core/workspace.js';import {TriggerWorkspace} from '../dist/modules/trigger/workspace.js';import {GalaxyDocument} from '../dist/modules/script/document.js';
import {integer as I,real as F,boolean as B,variable as V,parameter as P,preset as E,call as C,action as A,event as Ev,condition as Cond} from '../dist/modules/trigger/builder.js';
const output=path.resolve(process.argv[2]??'work/trigger-ast-completion/benchmark'),cases=[];await fs.mkdir(output,{recursive:true});
const add=(a,b)=>C('ArithmeticInt',{val1:a,op:E('plus'),val2:b});
const setup=actions=>`include "TriggerLibs/NativeLib"\ntrigger gt_Start;\nbool gt_Start_Func(bool testConds, bool runActions) {\n    if (!runActions) { return true; }\n${actions}\n    return true;\n}\nvoid InitMap() {\n    libNtve_InitLib();\n    gt_Start = TriggerCreate("gt_Start_Func");\n    TriggerAddEventMapInit(gt_Start);\n}\n`;
cases.push({name:'small-init',plans:[{create:{identifier:'Start'},calls:[Ev('TriggerAddEventMapInit'),A('PlayerModifyPropertyInt',{p:I(1),prop:E('Minerals'),operation:E('SetTo'),val:I(500)}),A('PlayerModifyPropertyInt',{p:I(2),prop:E('Minerals'),operation:E('SetTo'),val:I(500)})]}],galaxy:setup('    PlayerModifyPropertyInt(1, c_playerPropMinerals, c_playerPropOperSet, 500);\n    PlayerModifyPropertyInt(2, c_playerPropMinerals, c_playerPropOperSet, 500);'),builder:`import {integer as I,preset as E,action as A,event as Ev} from './builder.js';
export const plans=[{create:{identifier:'Start'},calls:[Ev('TriggerAddEventMapInit'),
 A('PlayerModifyPropertyInt',{p:I(1),prop:E('Minerals'),operation:E('SetTo'),val:I(500)}),
 A('PlayerModifyPropertyInt',{p:I(2),prop:E('Minerals'),operation:E('SetTo'),val:I(500)})]}];
`});
const medium={create:{identifier:'Income'},variables:[{name:'Ticks',type:'int',initial:I(0)},{name:'Scores',type:'int',arraySizes:[8],initial:I(0)},{name:'i',type:'int',scope:'local'}],calls:[Ev('TriggerAddEventTimePeriodic',{dur:F(20),timeType:E('game')}),Cond('Comparison',{val1:V('Ticks'),op:E('lt'),val2:I(10)}),A('SetVariable',{var:V('Ticks'),val:add(V('Ticks'),I(1))}),{kind:'Action',function:'ForEachInteger',args:{var:V('i'),s:I(0),e:I(7),increment:I(1)},children:[{role:'actions',call:A('SetVariable',{var:V('Scores',[V('i')]),val:add(V('Scores',[V('i')]),I(25))})}]}]};
cases.push({name:'medium-array',plans:[medium],galaxy:`include "TriggerLibs/NativeLib"
int gv_Ticks;
int[8] gv_Scores;
trigger gt_Income;
bool gt_Income_Func(bool testConds, bool runActions) {
    int lv_i;
    if (testConds && !(gv_Ticks < 10)) { return false; }
    if (!runActions) { return true; }
    gv_Ticks = gv_Ticks + 1;
    for (lv_i = 0; lv_i <= 7; lv_i += 1) {
        gv_Scores[lv_i] = gv_Scores[lv_i] + 25;
    }
    return true;
}
void InitMap() {
    libNtve_InitLib();
    gt_Income = TriggerCreate("gt_Income_Func");
    TriggerAddEventTimePeriodic(gt_Income, 20.0, c_timeGame);
}
`,builder:`import {integer as I,real as F,variable as V,preset as E,call as C,action as A,event as Ev,condition as Cond} from './builder.js';
const add=(a,b)=>C('ArithmeticInt',{val1:a,op:E('plus'),val2:b});
export const plans=[{create:{identifier:'Income'},variables:[
 {name:'Ticks',type:'int',initial:I(0)},
 {name:'Scores',type:'int',arraySizes:[8],initial:I(0)},
 {name:'i',type:'int',scope:'local'}],calls:[
 Ev('TriggerAddEventTimePeriodic',{dur:F(20),timeType:E('game')}),
 Cond('Comparison',{val1:V('Ticks'),op:E('lt'),val2:I(10)}),
 A('SetVariable',{var:V('Ticks'),val:add(V('Ticks'),I(1))}),
 {kind:'Action',function:'ForEachInteger',args:{var:V('i'),s:I(0),e:I(7),increment:I(1)},children:[
 {role:'actions',call:A('SetVariable',{var:V('Scores',[V('i')]),val:add(V('Scores',[V('i')]),I(25))})}]}]}];
`});
const state=player=>V('States',[player],[{field:'score'}]);
const declarations={presets:[{name:'Mode',baseType:'int',values:[{name:'Easy',value:1},{name:'Hard',value:2}]}],structures:[{name:'PlayerState',fields:[{name:'score',type:'int'},{name:'history',type:'int',arraySizes:[4]}]}],variables:[{name:'PlayerCount',type:'int',constant:true,initial:I(8)},{name:'States',type:'struct',typeElement:{name:'PlayerState'},arraySizes:[{variable:'PlayerCount'}]},{name:'Mode',type:'preset',typeElement:{name:'Mode'},initial:{kind:'preset',name:'Easy'}},{name:'Ticks',type:'int',initial:I(0)},{name:'Active',type:'bool',initial:B(true)}],functions:[{name:'Award',kind:'Action',parameters:[{name:'player',type:'int'},{name:'amount',type:'int'}],calls:[A('SetVariable',{var:state(P('player')),val:add(state(P('player')),P('amount'))})]}]};
const complex={create:{identifier:'Tick'},variables:[{name:'i',type:'int',scope:'local'}],calls:[Ev('TriggerAddEventTimePeriodic',{dur:F(20),timeType:E('game')}),Cond('Comparison',{val1:V('Active'),op:E('eq'),val2:B(true)}),A('SetVariable',{var:V('Ticks'),val:add(V('Ticks'),I(1))}),{kind:'Action',function:'ForEachInteger',args:{var:V('i'),s:I(0),e:I(7),increment:I(1)},children:[{role:'actions',call:A('custom:Award',{player:V('i'),amount:I(25)})},{role:'actions',call:A('SetVariable',{var:V('States',[V('i')],[{field:'history',indices:[I(0)]}]),val:V('Ticks')})}]}]};
cases.push({name:'complex-record',plans:[declarations,complex],galaxy:`include "TriggerLibs/NativeLib"
const int gv_PlayerCount = 8;
const int ge_Mode_Easy = 1;
const int ge_Mode_Hard = 2;
struct gs_PlayerState {
    int lv_score;
    int[4] lv_history;
};
gs_PlayerState[gv_PlayerCount] gv_States;
int gv_Mode = ge_Mode_Easy;
int gv_Ticks;
bool gv_Active = true;
trigger gt_Tick;
void gf_Award(int lp_player, int lp_amount) {
    gv_States[lp_player].lv_score = gv_States[lp_player].lv_score + lp_amount;
}
bool gt_Tick_Func(bool testConds, bool runActions) {
    int lv_i;
    if (testConds && !(gv_Active == true)) { return false; }
    if (!runActions) { return true; }
    gv_Ticks = gv_Ticks + 1;
    for (lv_i = 0; lv_i <= 7; lv_i += 1) {
        gf_Award(lv_i, 25);
        gv_States[lv_i].lv_history[0] = gv_Ticks;
    }
    return true;
}
void InitMap() {
    libNtve_InitLib();
    gt_Tick = TriggerCreate("gt_Tick_Func");
    TriggerAddEventTimePeriodic(gt_Tick, 20.0, c_timeGame);
}
`,builder:`import {integer as I,real as F,boolean as B,variable as V,parameter as P,preset as E,call as C,action as A,event as Ev,condition as Cond} from './builder.js';
const add=(a,b)=>C('ArithmeticInt',{val1:a,op:E('plus'),val2:b});
const state=p=>V('States',[p],[{field:'score'}]);
export const plans=[{
 presets:[{name:'Mode',baseType:'int',values:[{name:'Easy',value:1},{name:'Hard',value:2}]}],
 structures:[{name:'PlayerState',fields:[{name:'score',type:'int'},{name:'history',type:'int',arraySizes:[4]}]}],
 variables:[{name:'PlayerCount',type:'int',constant:true,initial:I(8)},
 {name:'States',type:'struct',typeElement:{name:'PlayerState'},arraySizes:[{variable:'PlayerCount'}]},
 {name:'Mode',type:'preset',typeElement:{name:'Mode'},initial:{kind:'preset',name:'Easy'}},
 {name:'Ticks',type:'int',initial:I(0)},{name:'Active',type:'bool',initial:B(true)}],
 functions:[{name:'Award',kind:'Action',parameters:[{name:'player',type:'int'},{name:'amount',type:'int'}],
 calls:[A('SetVariable',{var:state(P('player')),val:add(state(P('player')),P('amount'))})]}]},
 {create:{identifier:'Tick'},variables:[{name:'i',type:'int',scope:'local'}],calls:[
 Ev('TriggerAddEventTimePeriodic',{dur:F(20),timeType:E('game')}),
 Cond('Comparison',{val1:V('Active'),op:E('eq'),val2:B(true)}),
 A('SetVariable',{var:V('Ticks'),val:add(V('Ticks'),I(1))}),
 {kind:'Action',function:'ForEachInteger',args:{var:V('i'),s:I(0),e:I(7),increment:I(1)},children:[
 {role:'actions',call:A('custom:Award',{player:V('i'),amount:I(25)})},
 {role:'actions',call:A('SetVariable',{var:V('States',[V('i')],[{field:'history',indices:[I(0)]}]),val:V('Ticks')})}]}]}];
`});
// Small IR interpreter for the operations in these three workloads. This is a
// semantic cross-check of the authoring input, not SC2 engine execution.
function simulate(plans){
 const globals={},structures=new Map(),presets=new Map(),functions=new Map(),minerals={};
 const scope={locals:{},params:{}};
 const reference=(v,ctx)=>{let owner=v.kind==='parameter'?ctx.params:Object.hasOwn(ctx.locals,v.name)?ctx.locals:globals,key=v.name;let value=owner[key];for(const index of v.indices??[]){owner=value;key=evaluate(index,ctx);value=owner[key];}for(const field of v.members??[]){owner=value;key=field.field;value=owner[key];for(const index of field.indices??[]){owner=value;key=evaluate(index,ctx);value=owner[key];}}return {owner,key,value};};
 const evaluate=(v,ctx)=>{if(v.kind==='literal')return v.value;if(v.kind==='variable'||v.kind==='parameter')return reference(v,ctx).value;if(v.kind==='preset'){if(v.preset)return presets.get(v.preset).values.find(m=>m.name===v.name).value;return v.name;}if(v.kind==='call'){if(v.function==='ArithmeticInt'){const a=evaluate(v.args.val1,ctx),b=evaluate(v.args.val2,ctx),op=evaluate(v.args.op,ctx);return op==='plus'?a+b:op==='minus'?a-b:op==='mult'?a*b:a/b;}throw new Error('SIM_EXPRESSION '+v.function);}throw new Error('SIM_VALUE '+v.kind);};
 const initialize=(v)=>{const scalar=()=>v.type==='struct'?Object.fromEntries(structures.get(v.typeElement.name).fields.map(f=>[f.name,initialize(f)])):v.initial?(v.type==='preset'?presets.get(v.typeElement.name).values.find(m=>m.name===v.initial.name).value:evaluate(v.initial,scope)):v.type==='bool'?false:0;const dims=(v.arraySizes??[]).map(s=>typeof s==='number'?s:globals[s.variable]);const array=i=>i<dims.length?Array.from({length:dims[i]},()=>array(i+1)):scalar();return array(0);};
 const check=(c,ctx)=>{const a=evaluate(c.args.val1,ctx),b=evaluate(c.args.val2,ctx),op=evaluate(c.args.op,ctx);return op==='eq'?a===b:op==='lt'?a<b:op==='gt'?a>b:op==='ne'?a!==b:false;};
 const execute=(c,ctx)=>{if(c.function==='SetVariable'){const target=reference(c.args.var,ctx);target.owner[target.key]=evaluate(c.args.val,ctx);return;}if(c.function==='ForEachInteger'){const target=reference(c.args.var,ctx),start=evaluate(c.args.s,ctx),end=evaluate(c.args.e,ctx),step=evaluate(c.args.increment,ctx);for(let i=start;i<=end;i+=step){target.owner[target.key]=i;for(const child of c.children??[])execute(child.call,ctx);}return;}if(c.function.startsWith('custom:')){const f=functions.get(c.function.slice(7)),params=Object.fromEntries(Object.entries(c.args).map(([k,v])=>[k,evaluate(v,ctx)]));for(const call of f.calls)execute(call,{locals:{},params});return;}if(c.function==='PlayerModifyPropertyInt'){const player=evaluate(c.args.p,ctx),val=evaluate(c.args.val,ctx);minerals[player]=val;return;}throw new Error('SIM_ACTION '+c.function);};
 for(const plan of plans){for(const s of plan.structures??[])structures.set(s.name,s);for(const p of plan.presets??[])presets.set(p.name,p);for(const f of plan.functions??[])functions.set(f.name,f);for(const v of plan.variables??[])if(v.scope!=='local')globals[v.name]=initialize(v);}
 for(const plan of plans.filter(p=>p.create)){const repeats=plan.calls.some(c=>c.function==='TriggerAddEventTimePeriodic')?4:1;for(let i=0;i<repeats;i++){const ctx={locals:Object.fromEntries((plan.variables??[]).filter(v=>v.scope==='local').map(v=>[v.name,initialize(v)])),params:{}};if(!plan.calls.filter(c=>c.kind==='Condition').every(c=>check(c,ctx)))continue;for(const c of plan.calls.filter(c=>c.kind==='Action'))execute(c,ctx);}}
 return Object.keys(minerals).length?{minerals}:globals.States?{ticks:globals.Ticks,scores:globals.States.map(s=>s.score),history:globals.States.map(s=>s.history[0])}:{ticks:globals.Ticks,scores:globals.Scores};
}
const traces=cases.map(c=>{const expected=c.name==='small-init'?{minerals:{1:500,2:500}}:{ticks:4,scores:Array(8).fill(100),...(c.name==='complex-record'?{history:Array(8).fill(4)}:{})},result=simulate(c.plans);assert.deepEqual(result,expected);return {name:c.name,check:'GUI_IR_SIMULATION_MATCHES_REFERENCE_TRACE',result,expected};});
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],results=[];
for(const c of cases){const dir=path.join(output,c.name);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'reference.galaxy'),c.galaxy);await fs.writeFile(path.join(dir,'authoring.mjs'),c.builder);await fs.writeFile(path.join(dir,'plans.json'),JSON.stringify(c.plans));const map=path.join(dir,'gui');await fs.mkdir(map,{recursive:true});const ws=new Workspace(map),tr=new TriggerWorkspace(ws);
 const samples={galaxy:[],gui:[]};let cold;
 for(let iteration=0;iteration<6;iteration++){
  await ws.applyRawTransaction(['Triggers'],()=>new Map([['Triggers','<TriggerData><Root/></TriggerData>']]),{dryRun:false,stage:false,summary:'Benchmark reset outside measured interval'});
  let start=performance.now();const doc=new GalaxyDocument(c.galaxy);assert.equal(doc.diagnostics.filter(d=>d.severity==='error').length,0);await fs.writeFile(path.join(dir,'written.galaxy'),c.galaxy);const galaxyMs=performance.now()-start;
  start=performance.now();for(const request of c.plans){const plan=await tr.plan(request);await tr.applyPlan(plan.planId,false);await tr.save(false);}assert.equal((await tr.validate()).valid,true);const guiMs=performance.now()-start;
  if(iteration===0)cold={galaxyMs,guiMs};else {samples.galaxy.push(galaxyMs);samples.gui.push(guiMs);}
 }
 const xml=await fs.readFile(path.join(map,'Triggers'),'utf8');await fs.writeFile(path.join(dir,'generated.xml'),xml);results.push({name:c.name,coldMs:cold,warmMedianMs:{galaxy:Number(median(samples.galaxy).toFixed(2)),gui:Number(median(samples.gui).toFixed(2))},samplesMs:samples,sourceBytes:{galaxy:Buffer.byteLength(c.galaxy),builder:Buffer.byteLength(c.builder),json:Buffer.byteLength(JSON.stringify(c.plans)),xml:Buffer.byteLength(xml)},inputFiles:{galaxy:path.join(dir,'reference.galaxy'),builder:path.join(dir,'authoring.mjs'),json:path.join(dir,'plans.json'),xml:path.join(dir,'generated.xml')}});
}
const report={date:'2026-10-11',method:'Same three workloads, one client/workspace per case, 1 cold + 5 warm repetitions; reset outside measured interval; structural Galaxy validation/write versus GUI plan/apply/save/XML graph validation. No SC2 compiler or engine, no LLM latency/billing measurement.',tokenization:'Separate tiktoken/o200k_base pass',cases:results,traces,compiler:'NOT_EXECUTED',converterUsed:false};await fs.writeFile(path.join(output,'timing-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(results.map(r=>({name:r.name,warmMedianMs:r.warmMedianMs,coldMs:r.coldMs,bytes:r.sourceBytes}))));
