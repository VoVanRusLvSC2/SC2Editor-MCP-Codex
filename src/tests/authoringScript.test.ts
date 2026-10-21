import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compileAuthorScript} from '../app/authoringScript.js';
import {compactResult,runMcpBatch,type BatchTool} from '../app/mcpBatch.js';

test('compact commands cover terrain, placement, Data, UI, cutscene and settings',()=>{
  const steps=compileAuthorScript([
    'terrain paint texture=AgriaDirt at=20,30 radius=8 strength=0.4',
    'objects unit id=Marine at=25,31 owner=1',
    'data find id=Marine',
    'ui status',
    'cutscene show file=Base.SC2Data/Cutscenes/Intro.SC2Cutscene',
    'settings players',
  ].join('\n'),'plan');
  assert.deepEqual(steps.map(s=>s.tool),['terrain.paint','placement.addUnit','data.peek','ui.list_files','cutscene.preview','settings.players.list']);
  assert.deepEqual(steps[0].args.area,{type:'circle',center:{x:20,y:30},radius:8});
  assert.deepEqual(steps[1].args.position,{x:25,y:31,z:0});
  assert.deepEqual(steps[2].args.ids,['Marine']);
});

test('logic defaults to guarded Galaxy source and GUI is explicit',()=>{
  const source='logic function file=Scripts/Waves.galaxy <<GALAXY\nvoid Wave() {\n  UIDisplayMessage(PlayerGroupAll(), c_messageAreaSubtitle, "Ready");\n}\nGALAXY';
  const steps=compileAuthorScript(source,'save');
  assert.deepEqual(steps.map(s=>s.tool),['script.plan','script.apply','script.save']);
  assert.match(String((steps[0].args.operations as Array<{source:string}>)[0].source),/UIDisplayMessage/);
  assert.deepEqual(steps[1].args.planId,{$from:'s1.planId'});
  assert.equal(steps[2].args.file,'Scripts/Waves.galaxy');
  assert.deepEqual(compileAuthorScript('gui plan file=plans/mission.json','plan').map(s=>s.tool),['trigger.plan_file']);
  assert.throws(()=>compileAuthorScript('logic gui file=x','plan'),/AUTHOR_GUI_EXPLICIT/);
});

test('save expands into existing apply and save tools, preserving stage boundary',()=>{
  const steps=compileAuthorScript('terrain raise rect=1,2,9,10 amount=2','save');
  assert.deepEqual(steps.map(s=>s.tool),['terrain.plan','terrain.apply','terrain.save']);
  assert.deepEqual(steps[0].args.operations,[{op:'height.raise',area:{type:'rectangle',minX:1,minY:2,maxX:9,maxY:10},amount:2}]);
  assert.deepEqual(steps[2].args.transactionId,{$from:'s1_apply.transactionId'});
  const cliff=compileAuthorScript('terrain cliff rect=2,4,12,16 level=2','plan')[0];
  assert.equal(cliff.tool,'terrain.cliff.paint');
  assert.deepEqual(cliff.args.area,{type:'rectangle',minX:2,minY:4,maxX:12,maxY:16});
  const ramp=compileAuthorScript('terrain ramp at=8,10 direction=east','plan')[0];
  assert.deepEqual(ramp.args.center,{x:8,y:10});
});

test('high-level recipes cover document, settings, AI, text and nested UI transaction',()=>{
  const commands=[
    'document empty kind=map width=64 height=64 destination=NewMap',
    'settings player id=2 control=Computer color=3',
    'ai wave id=WaveOne definition=TerranWave',
    'text set key=Mission/Title value="Defend the base" locale=ruRU',
  ];
  assert.deepEqual(compileAuthorScript(commands.join('\n'),'plan').map(s=>s.tool),['document.plan','settings.plan','ai.apply','text.apply']);
  const document=compileAuthorScript(commands[0],'plan')[0];
  assert.deepEqual(document.args.map,{width:64,height:64});
  const ui=compileAuthorScript('ui timer stylePrefix=MissionTimer','save');
  assert.deepEqual(ui.map(s=>s.tool),['ui.recipe_timer','ui.assets.save']);
  assert.deepEqual(ui[1].args.transactionId,{$from:'s1.transaction.transactionId'});
});

test('unsafe or unknown commands and malformed source fail before any tool runs',()=>{
  for(const source of ['modkit.save file=Objects','map export archive=x','terrain.paint __proto__.x=y','galaxy file file=Bad.galaxy <<END\nvoid X() {}'])
    assert.throws(()=>compileAuthorScript(source,'plan'));
  assert.throws(()=>compileAuthorScript('terrain pathing rect=1,1,3,3','save'),/AUTHOR_LIFECYCLE_UNSUPPORTED/);
  assert.throws(()=>compileAuthorScript('map create blueprintId=donor destinationDirectory=Test dryRun=false','plan'),/AUTHOR_PLAN_REQUIRES_DRY_RUN/);
});

test('compiled authoring uses existing schema validation and reference resolution',async()=>{
  const seen:Array<{tool:string;args:unknown}>=[];
  const fake=(tool:string,callback:(args:unknown)=>unknown):BatchTool=>({schema:{parse(value){return value;}},invoke:async(args)=>{seen.push({tool,args});return {content:[{type:'text',text:JSON.stringify(callback(args))}]};}});
  const tools=new Map<string,BatchTool>([
    ['script.plan',fake('script.plan',()=>({planId:'plan-1'}))],
    ['script.apply',fake('script.apply',()=>({staged:true}))],
    ['script.save',fake('script.save',()=>({saved:true}))],
  ]);
  const steps=compileAuthorScript('galaxy function file=Scripts/Test.galaxy <<END\nvoid Test() {}\nEND','save',tools);
  const result=await runMcpBatch(steps,tools,{});
  assert.equal(result.ok,true);
  assert.deepEqual(seen.map(s=>s.tool),['script.plan','script.apply','script.save']);
  assert.deepEqual(seen[1].args,{planId:'plan-1',dryRun:false});
});

test('compact receipts retain bounded Data and settings lookup results',()=>{
  assert.deepEqual(compactResult({objects:[{id:'Marine'}],pagination:{total:1}}),{pagination:{total:1},objects:[{id:'Marine'}]});
  assert.deepEqual(compactResult({version:39,players:[{id:1,control:'User'}]}),{version:39,players:[{id:1,control:'User'}]});
});
