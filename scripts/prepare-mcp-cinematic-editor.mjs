import {promises as fs} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createProject} from '../dist/app/project.js';

const parent=path.resolve('generated/mcp-hardening');
const packet=path.resolve(process.argv[2]??path.join(parent,'editor-cinematic-20260929'));
if(!packet.startsWith(parent+path.sep))throw new Error('EDITOR_PACKET_PATH_ESCAPE');
await fs.mkdir(packet);const root=path.join(packet,'components');await fs.mkdir(root);
for(const dir of ['src/tests/fixtures/terrain-native/nydus','src/tests/fixtures/map-native/nydus']){
 for(const file of await fs.readdir(dir))if(file.endsWith('.gz'))await fs.writeFile(path.join(root,file.slice(0,-3)),gunzipSync(await fs.readFile(path.join(dir,file))));
}
await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="A1000001"><Root/></Library></TriggerData>');
const project=await createProject(root,{loadUiSchema:false});
const on={kind:'preset',id:'00000538'},off={kind:'preset',id:'00000545'};
const all={kind:'nativeCall',function:'PlayerGroupAll'};
const calls=[
 {kind:'Event',function:'TriggerAddEventMapInit',args:{}},
 {kind:'Action',function:'CinematicMode',args:{C016C6E2:on,'8F9FC828':all,'5755FC77':{kind:'literal',type:'fixed',value:0}}},
 {kind:'Action',function:'Wait',args:{'00000419':{kind:'literal',type:'fixed',value:0.5},'00000420':{kind:'preset',id:'00000013'}}},
 {kind:'Action',function:'CinematicMode',args:{C016C6E2:off,'8F9FC828':all,'5755FC77':{kind:'literal',type:'fixed',value:0}}},
 {kind:'Action',function:'GlobalCinematicSetting',args:{E095DC31:on}},
 {kind:'Action',function:'GlobalCinematicSetting',args:{E095DC31:off}},
];
const plan=await project.trigger.plan({create:{library:'A1000001',identifier:'CinematicAcceptance',category:'MCP Acceptance'},calls});
await project.trigger.applyPlan(plan.planId,false);await project.trigger.save(false);
const gui=await project.trigger.validate(),map=await project.map.inspect();
if(!gui.valid||!map.valid)throw new Error('STATIC_ACCEPTANCE_FAILED');
const archive=await project.map.export('.', '.sc2mcp-output/CinematicAcceptance.SC2Map',false,false);
const triggerBytes=await fs.readFile(path.join(root,'Triggers'));
await fs.writeFile(path.join(packet,'static-report.json'),JSON.stringify({status:'STATIC_PASS',build:97563,editor:'NOT_RUN',compiler:'NOT_EXECUTED',runtime:'NOT_RUN',triggerSha256:createHash('sha256').update(triggerBytes).digest('hex'),calls,gui,map,archive},null,2)+'\n');
await fs.writeFile(path.join(packet,'RESULTS.json'),JSON.stringify({editorVersion:null,dependencies:null,load:'NOT_RUN',save:'NOT_RUN',reopen:'NOT_RUN',compile:'NOT_RUN',runtime:'NOT_RUN',generatedGalaxy:'NOT_RUN',notes:''},null,2)+'\n');
await fs.writeFile(path.join(packet,'README_RU.md'),`# Ручная приёмка кинематических вызовов

Статус Editor/compile/runtime: NOT_RUN. Это изолированная карта из checked-in native fixtures; сохраните пользовательскую сессию отдельно и открывайте копию.

Откройте components/.sc2mcp-output/CinematicAcceptance.SC2Map. В Trigger Editor проверьте категорию MCP Acceptance и триггер CinematicAcceptance: Map Initialization, CinematicMode On (PlayerGroupAll, duration 0), Wait 0.5, CinematicMode Off, GlobalCinematicSetting On, GlobalCinematicSetting Off. Это две разные FunctionDef, проверьте их параметры и локализованные имена.

Сохраните карту под новым именем, откройте повторно и зафиксируйте порядок/типы/строки. Сгенерируйте Galaxy и зафиксируйте ошибки компиляции; только затем выполните Test Document на копии и запишите наблюдение. Для проверки выполнения используйте breakpoint или явный trace: визуальное отсутствие кинематического эффекта недостаточно.

Отдельно подготовьте в Editor before/after для одной FunctionCall без своей метки, с Debug, с Cinematics, с явно выбранным None и снова с default/inherit. Сохраните XML/TriggerStrings каждого состояния. Пока этот формат не доказан, trigger.labels/label_of только читают, set/clear недоступны. Заполните RESULTS.json фактическими результатами и версией Editor.
`,'utf8');
console.log(JSON.stringify({packet,archive:archive.output??null,static:'PASS',editor:'NOT_RUN'}));
