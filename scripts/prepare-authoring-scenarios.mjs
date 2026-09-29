import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import console from 'node:console';
import process from 'node:process';
import {createProject} from '../dist/app/project.js';

const source=path.resolve('generated/mcp-hardening/editor-authoring-20260929/components');
const output=path.resolve(process.argv[2]??'generated/authoring-scenarios-20260929');
if(await fs.stat(output).then(()=>true,()=>false))throw new Error('SCENARIO_OUTPUT_EXISTS');
await fs.mkdir(output,{recursive:true});
const report={base:source,scenarios:{},editor:'NOT_RUN',runtime:'NOT_RUN'};
const open=async name=>{const root=path.join(output,name,'components');await fs.mkdir(path.dirname(root),{recursive:true});await fs.cp(source,root,{recursive:true});return {root,...await createProject(root,{loadUiSchema:false})};};
const record=async(name,root,checks)=>{const files=[];const walk=async dir=>{for(const e of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())await walk(full);else if(e.isFile()){const bytes=await fs.readFile(full);files.push({file:path.relative(root,full).replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex')});}}};await walk(root);report.scenarios[name]={...checks,components:root,files};};
const applyBatch=async(data,changes)=>data.batch({changes,dryRun:false,stage:false,backup:false});

{
 const {root,data}=await open('A');
 const changes=[
  {file:'Base.SC2Data/GameData/EffectData.xml',operations:[
   {op:'object.create',ctype:'CEffectDamage',id:'ScenarioAInitial',fields:[{name:'Amount',value:5}]},
   {op:'object.create',ctype:'CEffectDamage',id:'ScenarioAPeriodic',fields:[{name:'Amount',value:2}]},
   {op:'object.create',ctype:'CEffectApplyBehavior',id:'ScenarioAApply',fields:[{name:'Behavior',value:'ScenarioABuff'}]},
   {op:'object.create',ctype:'CEffectSet',id:'ScenarioAHit',fields:[{name:'EffectArray',index:0,value:'ScenarioAInitial'},{name:'EffectArray',index:1,value:'ScenarioAApply'}]},
  ]},
  {file:'Base.SC2Data/GameData/BehaviorData.xml',operations:[{op:'object.create',ctype:'CBehaviorBuff',id:'ScenarioABuff',fields:[{name:'Duration',value:4},{name:'Period',value:0.5},{name:'PeriodicEffect',value:'ScenarioAPeriodic'}]}]},
  {file:'Base.SC2Data/GameData/ValidatorData.xml',operations:[{op:'object.create',ctype:'CValidatorUnitCompareVital',id:'ScenarioALifeGate',fields:[{name:'Compare',value:'GT'},{name:'Value',value:0.2}]}]},
  {file:'Base.SC2Data/GameData/WeaponData.xml',operations:[{op:'object.create',ctype:'CWeaponLegacy',id:'ScenarioAWeapon',fields:[{name:'Effect',value:'ScenarioAHit'}]}]},
  {file:'Base.SC2Data/GameData/UnitData.xml',operations:[{op:'object.create',ctype:'CUnit',id:'ScenarioAUnit',fields:[{name:'WeaponArray',index:0,link:'ScenarioAWeapon'}]}]},
  {file:'Base.SC2Data/GameData/ModelData.xml',operations:[{op:'object.create',ctype:'CModel',id:'ScenarioAModel',fields:[{name:'Model',value:'Assets/Units/Terran/Marine/Marine.m3'}]}]},
  {file:'Base.SC2Data/GameData/ActorData.xml',operations:[{op:'object.create',ctype:'CActorModel',id:'ScenarioAVisual',fields:[{name:'Model',value:'ScenarioAModel'},{name:'On',attrs:{Terms:'Effect.ScenarioAInitial.Start; At Target',Send:'Create'}}]}]},
 ];
 const positive=await applyBatch(data,changes);
 const negative=await data.batch({changes:[{file:'Base.SC2Data/GameData/EffectData.xml',operations:[{op:'object.create',ctype:'CEffectSet',id:'ScenarioABroken',fields:[{name:'EffectArray',value:'MissingPrerequisite'}]}]}]})
   .then(()=>({status:'UNEXPECTED_PASS'}),e=>({status:'REJECTED',message:String(e)}));
 await record('A',root,{structural:positive.validation?.valid,authoring:positive.authoring.map(x=>({file:x.file,status:x.authoring.status,accepted:x.authoring.accepted,completeness:x.authoring.completeness})),negative,asset:'Marine.m3 path is schema-valid but asset presence and Editor rendering are NOT_RUN',compiler:'NOT_RUN'});
}
{
 const {root,data}=await open('B');
 const positive=await applyBatch(data,[
  {file:'Base.SC2Data/GameData/EffectData.xml',operations:[
   {op:'object.create',ctype:'CEffectDamage',id:'ScenarioBFirst',fields:[{name:'Amount',value:4},{name:'ImpactUnitValidator',value:'ScenarioBTargetGate'}]},
   {op:'object.create',ctype:'CEffectDamage',id:'ScenarioBSecond',fields:[{name:'Amount',value:7}]},
   {op:'object.create',ctype:'CEffectSet',id:'ScenarioBSet',fields:[{name:'EffectArray',index:0,value:'ScenarioBFirst'},{name:'EffectArray',index:1,value:'ScenarioBSecond'},{name:'ValidatorArray',index:0,value:'ScenarioBTargetGate'}]},
  ]},
  {file:'Base.SC2Data/GameData/ValidatorData.xml',operations:[{op:'object.create',ctype:'CValidatorUnitCompareVital',id:'ScenarioBTargetGate',fields:[{name:'Compare',value:'GT'},{name:'Value',value:0.3}]}]},
  {file:'Base.SC2Data/GameData/AbilData.xml',operations:[{op:'object.create',ctype:'CAbilEffectInstant',id:'ScenarioBAbility',fields:[{name:'Effect',index:0,value:'ScenarioBSet'},{name:'Cost',children:[{name:'Cooldown',attrs:{TimeUse:12}}]}]}]},
  {file:'Base.SC2Data/GameData/UnitData.xml',operations:[{op:'object.create',ctype:'CUnit',id:'ScenarioBUnit',fields:[{name:'AbilArray',index:0,link:'ScenarioBAbility'}]}]},
 ]);
 const negative=await data.batch({changes:[{file:'Base.SC2Data/GameData/AbilData.xml',operations:[{op:'object.create',ctype:'CAbilEffectInstant',id:'ScenarioBBad',fields:[{name:'Effect',value:'AbsentEffect'}]}]}]}).then(()=>({status:'UNEXPECTED_PASS'}),e=>({status:'REJECTED',message:String(e)}));
 await record('B',root,{structural:positive.validation?.valid,authoring:positive.authoring.map(x=>({file:x.file,status:x.authoring.status,accepted:x.authoring.accepted})),negative,compiler:'NOT_RUN'});
}
{
 const {root,script}=await open('C');
 const sourceCode='int ScenarioCSum(int limit) { int total = 0; int i = 0; while (i < limit) { total += i; i += 1; } if (total > 0) { return total; } else { return 0; } }\nvoid ScenarioCInit() { UnitCreate(1, "ScenarioAUnit", 0, 1, null, 0); }\n';
 const plan=await script.plan({operations:[{op:'file.create',file:'Scripts/ScenarioC.galaxy',source:sourceCode}]});
 await script.apply(plan.planId,false);await script.save('Scripts/ScenarioC.galaxy',false);
 const check=await script.validate();
 await record('C',root,{structural:check.valid,typecheck:check.typecheck,compiler:check.compiler,initConnection:'NOT_RUN: native map foundation does not include MapScript.galaxy',negative:'GALAXY_CALL_TYPE and GALAXY_RETURN_TYPE regression cases in src/tests/galaxyTypecheck.test.ts'});
}
{
 const {root,trigger}=await open('D');
 const condition={kind:'Condition',function:'WithinBounds',args:{'6342B1C3':{kind:'literal',type:'int',value:5},'89A1388B':{kind:'literal',type:'int',value:0},'0C271B21':{kind:'literal',type:'int',value:10}}};
 const block={kind:'Action',function:'IfThenElse',args:{},children:[{role:'if',call:condition},{role:'then',call:{kind:'Action',function:'Wait',args:{'00000419':{kind:'call',function:'00000001',args:{'00000001':{kind:'literal',type:'int',value:1}}},'00000420':{kind:'preset',id:'00000013'}}}},{role:'else',call:{kind:'Action',function:'DialogDestroyAll',args:{}}}]};
 const plan=await trigger.plan({create:{library:'A1000001',identifier:'ScenarioDBranch',category:'Authoring'},calls:[{kind:'Event',function:'TriggerAddEventMapInit',args:{}},block]});
 await trigger.applyPlan(plan.planId,false);await trigger.save(false);
 const check=await trigger.validate();
 await record('D',root,{structural:check.valid,compiler:check.compiler,loop:'NOT_IMPLEMENTED',localVariable:'NOT_IMPLEMENTED',customFunction:'NOT_IMPLEMENTED',negative:'GUI_CONDITION_REQUIRED and GUI_TYPE_MISMATCH regressions in src/tests/triggerAuthoringDiscovery.test.ts'});
}
{
 const {root,data,script}=await open('E');
 await fs.writeFile(path.join(root,'DocumentInfo'),'<DocInfo><Dependencies/></DocInfo>');
 const created=await applyBatch(data,[{file:'Base.SC2Data/GameData/UnitData.xml',operations:[{op:'object.create',ctype:'CUnit',id:'ScenarioEUnit'}]}]);
 const sourceCode='void ScenarioEUse() { UnitCreate(1, "ScenarioEUnit", 0, 1, null, 0); }\n';
 const plan=await script.plan({operations:[{op:'file.create',file:'Scripts/ScenarioE.galaxy',source:sourceCode}]});
 await script.apply(plan.planId,false);await script.save('Scripts/ScenarioE.galaxy',false);
 const renamed=await data.apply({file:'Base.SC2Data/GameData/UnitData.xml',operations:[{op:'object.rename',object:'ScenarioEUnit',newId:'ScenarioERenamed',updateReferences:true}],dryRun:false,stage:false,backup:false});
 const galaxy=await fs.readFile(path.join(root,'Scripts/ScenarioE.galaxy'),'utf8');
 if(!galaxy.includes('ScenarioERenamed'))throw new Error('SCENARIO_E_TYPED_RENAME_FAILED');
 await record('E',root,{structural:renamed.validation?.valid,authoring:created.authoring.map(x=>x.authoring.status),typedGalaxyRename:true,jointPlan:'NOT_IMPLEMENTED: sequential Data and Galaxy plans with shared rename coordinator',compiler:'NOT_RUN',negative:'cross-reference and stale-plan regressions in mcpHardening tests'});
}
await fs.writeFile(path.join(output,'REPORT.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,scenarios:Object.fromEntries(Object.entries(report.scenarios).map(([name,x])=>[name,{structural:x.structural,compiler:x.compiler,files:x.files.length}]))},null,2));
