import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compileAuthorScript} from '../app/authoringScript.js';
import {compactResult,runMcpBatch,type BatchTool} from '../app/mcpBatch.js';

test("empty document save uses the guarded planner/materializer and player.set preserves omitted fields", () => {
  const source =
    "document empty destination=Map width=32 height=32 terrain.enabled=true terrain.tileSet=Agria";
  const planned = compileAuthorScript(source, "plan");
  assert.deepEqual(
    planned.map((step) => step.tool),
    ["document.plan"],
  );
  const saved = compileAuthorScript(source, "save");
  assert.deepEqual(
    saved.map((step) => step.tool),
    ["document.plan", "document.create"],
  );
  assert.deepEqual(saved[1].args, {
    planId: { $from: "s1.id" },
    dryRun: false,
    output: "components",
  });
  assert.throws(() => compileAuthorScript(source, "stage"), /AUTHOR_DOCUMENT_NO_STAGING/);
  const player = compileAuthorScript("settings player.set id=1 color=2", "plan")[0];
  assert.equal(player.tool, "settings.plan");
  const operation = (player.args.operations as any[])[0];
  assert.equal(operation.op, "player.set");
  assert.equal(operation.playerId, 1);
  assert.deepEqual({ ...operation.patch }, { color: 2 });
});

test("one compact scene request carries several native tick samples without repeated scene preparation calls", () => {
  const steps = compileAuthorScript(
    "cutscene show file=Scene.SC2Cutscene times=0,1000,2500 snapshots=false",
    "plan",
  );
  assert.equal(steps.length, 1);
  assert.equal(steps[0].tool, "cutscene.preview");
  assert.deepEqual(steps[0].args.times, [0, 1000, 2500]);
  assert.equal(steps[0].args.snapshots, false);
  assert.throws(
    () => compileAuthorScript("cutscene show file=Scene.SC2Cutscene times=0,,1000", "plan"),
    /AUTHOR_CUTSCENE_TIMES/,
  );
});

test('compact card review stays read-only and rejection receipts preserve bounded diagnostics',()=>{
 const steps=compileAuthorScript('data card.check unit=Hero','save');assert.deepEqual(steps.map(s=>s.tool),['data.card.check']);
 const rejected=compactResult({accepted:false,error:{code:'DATA_CARD_BINDING_REJECTED'},cardReview:{conflictCount:1}}) as any;assert.equal(rejected.cardReview.conflictCount,1);assert.equal(rejected.accepted,false);
 const lookup=compactResult({bindingAccepted:false,status:'review_required',conflictCount:1,conflicts:[{code:'CARD_SHARED_BUTTON_FACE'}]}) as any;assert.equal(lookup.bindingAccepted,false);assert.equal(lookup.conflicts[0].code,'CARD_SHARED_BUTTON_FACE');assert.equal(Object.hasOwn(lookup,'accepted'),false);
 const reviews=compactResult({cardReviews:Array.from({length:8},(_,operation)=>({operation})),cardReviewCount:8}) as any;assert.equal(reviews.cardReviews.length,4);assert.equal(reviews.cardReviewCount,8);assert.equal(reviews.cardReviewsTruncated,true);
});

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

test('compact variation assignments retain the existing placement plan/apply/save boundary',()=>{
 const steps=compileAuthorScript('objects variants assignments=\'[{"objectId":12,"variation":1},{"objectId":15,"variation":0}]\'','save');
 assert.deepEqual(steps.map(s=>s.tool),['placement.setVariations','placement.apply','modkit.save']);assert.deepEqual(steps[0].args.assignments,[{objectId:12,variation:1},{objectId:15,variation:0}]);assert.deepEqual(steps[1].args.planId,{$from:'s1.id'});assert.equal(steps[1].args.stage,true);assert.equal(steps[2].args.file,'Objects');
});

test('save expands into existing apply and save tools, preserving stage boundary',()=>{
  const unit=compileAuthorScript('objects unit id=Marine at=25,31 owner=1','save');assert.deepEqual(unit[1].args.planId,{$from:'s1.id'});
  const ability=compileAuthorScript('data ability.instant id=Pulse effect=PulseSearch button=Pulse energy=25 cooldown=5','save');assert.deepEqual(ability.map(s=>s.tool),['data.ability.instant','modkit.save']);assert.equal(ability[0].args.dryRun,false);assert.equal(ability[1].args.file,'Base.SC2Data/GameData/UnitData.xml');
  const target=compileAuthorScript('data ability.target id=TargetPulse sourceAbility=Snipe effect=PulseDamage button=Pulse range=6','save');assert.deepEqual(target.map(s=>s.tool),['data.ability.target','modkit.save']);assert.equal(target[0].args.range,6);assert.equal(target[0].args.sourceAbility,'Snipe');
  const timed=compileAuthorScript('data ability.target id=Channel sourceAbility=Snipe effect=Persistent button=Channel castIntroTime=1 castOutroTime=0 finishTime=2','save');assert.equal(timed[0].args.castOutroTime,0);assert.equal(timed[0].args.finishTime,2);
  const animation=compileAuthorScript('data actor.ability_animation id=PulseMotion actor=HeroActor unit=Hero ability=Pulse cast="Stand Victory" loopCast=true','save');assert.deepEqual(animation.map(s=>s.tool),['data.actor.ability_animation','modkit.save']);assert.equal(animation[0].args.cast,'Stand Victory');assert.equal(animation[0].args.loopCast,true);assert.equal(animation[1].args.file,'Base.SC2Data/GameData/ActorData.xml');
  const growth=compileAuthorScript('data hero.veterancy id=HeroXP unit=Hero levelEffect=LevelUp xp=0,50,150 lifeDelta=100 damageDelta=5','save');assert.deepEqual(growth.map(s=>s.tool),['data.hero.veterancy','modkit.save']);assert.deepEqual(growth[0].args.levels,[{xp:0,lifeDelta:0,damageDelta:0},{xp:50,lifeDelta:100,damageDelta:5},{xp:150,lifeDelta:100,damageDelta:5}]);
  assert.throws(()=>compileAuthorScript('data hero.veterancy id=HeroXP unit=Hero levelEffect=LevelUp xp=0,,150','save'),/AUTHOR_VETERANCY_THRESHOLDS/);
  const steps=compileAuthorScript('terrain raise rect=1,2,9,10 amount=2','save');
  assert.deepEqual(steps.map(s=>s.tool),['terrain.plan','terrain.apply','terrain.save']);
  assert.deepEqual(steps[0].args.operations,[{op:'height.raise',area:{type:'rectangle',minX:1,minY:2,maxX:9,maxY:10},amount:2}]);
  assert.deepEqual(steps[1].args.planId,{$from:'s1.id'});
  assert.deepEqual(steps[2].args.planId,{$from:'s1.id'});
  const cliff=compileAuthorScript('terrain cliff rect=2,4,12,16 level=2','plan')[0];
  assert.equal(cliff.tool,'terrain.cliff.paint');
  assert.deepEqual(cliff.args.area,{type:'rectangle',minX:2,minY:4,maxX:12,maxY:16});
  const ramp=compileAuthorScript('terrain ramp at=8,10 direction=east','plan')[0];
  assert.deepEqual(ramp.args.center,{x:8,y:10});
  const repair=compileAuthorScript('terrain cliff.repair rect=2,4,12,16','save');
  assert.deepEqual(repair.map(s=>s.tool),['terrain.cliff.repair','terrain.apply','terrain.save']);
  assert.deepEqual(repair[0].args.area,{type:'rectangle',minX:2,minY:4,maxX:12,maxY:16});
  assert.deepEqual(compileAuthorScript('terrain load.inspect','plan').map(s=>s.tool),['terrain.load.inspect']);
  assert.deepEqual(compileAuthorScript('terrain load.repair','save').map(s=>s.tool),['terrain.load.repair','terrain.apply','terrain.save']);
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

test('compact terrain receipts retain ownership/change counts without repeating the source hash table',()=>{
 const result=compactResult({id:'terrain_example',valid:true,files:[{file:'t3HeightMap',changedBytes:0},{file:'.sc2mcp/locations.json',changedBytes:42,afterBytes:50}],sourceSha256:Object.fromEntries(Array.from({length:24},(_,i)=>['file'+i,'a'.repeat(64)])),issues:[],ownership:{rebuilt:[{id:'forest',objects:80}],unchanged:['east']}}) as Record<string,any>;
 assert.equal(result.changedFiles,1);assert.equal(result.sourceSha256,undefined);assert.deepEqual(result.ownership.unchanged,['east']);assert.equal(result.files[0].file,'.sc2mcp/locations.json');
 const landscape=compileAuthorScript('terrain landscape file=plans/locations.json','save');assert.deepEqual(landscape.map(s=>s.tool),['terrain.landscape.plan_file','terrain.apply','terrain.save']);
});
