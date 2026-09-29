import {promises as fs} from 'node:fs';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createProject} from '../dist/app/project.js';

const parent=path.resolve('generated/mcp-hardening'),packet=path.resolve(process.argv[2]??path.join(parent,'editor-acceptance-20260927')),root=path.join(packet,'components');
if(!packet.startsWith(parent+path.sep))throw new Error('EDITOR_PACKET_PATH_ESCAPE');
await fs.mkdir(packet);await fs.mkdir(root);
for(const dir of ['src/tests/fixtures/terrain-native/nydus','src/tests/fixtures/map-native/nydus'])for(const file of await fs.readdir(dir))if(file.endsWith('.gz'))await fs.writeFile(path.join(root,file.slice(0,-3)),gunzipSync(await fs.readFile(path.join(dir,file))));
await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="A1000001"><Root/></Library></TriggerData>');
const project=await createProject(root,{loadUiSchema:false});
const plan=await project.trigger.plan({create:{library:'A1000001',identifier:'HardeningInit',category:'ManualAcceptance'},calls:[{kind:'Event',function:'TriggerAddEventMapInit',args:{}},{kind:'Action',function:'Wait',args:{'00000419':{kind:'literal',type:'fixed',value:'0.5'},'00000420':{kind:'preset',id:'00000013'}}},{kind:'Action',function:'DialogDestroyAll',args:{}}]});
await project.trigger.applyPlan(plan.planId,false);await project.trigger.save(false);
await project.data.apply({file:'Base.SC2Data/GameData/EffectData.xml',operations:[{op:'object.create',ctype:'CEffectDamage',id:'HardeningDamage',fields:[{name:'Amount',value:1}]},{op:'object.create',ctype:'CEffectSet',id:'HardeningSet',fields:[{name:'EffectArray',value:'HardeningDamage'}]}],dryRun:false,stage:false,backup:false});
const staticMap=await project.map.inspect(),gui=await project.trigger.validate(),data=await project.data.validate('Base.SC2Data/GameData/EffectData.xml');
const archive=await project.map.export('.', '.sc2mcp-output/TypedGui.SC2Map',false,false);
const hashes=[];const walk=async dir=>{for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.name.startsWith('.sc2mcp'))continue;const file=path.join(dir,e.name);if(e.isDirectory())await walk(file);else if(e.isFile()){const bytes=await fs.readFile(file);hashes.push({file:path.relative(root,file).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}}};await walk(root);
const report={status:'PREPARED',editor:'NOT_RUN',load:'NOT_RUN',saveReopen:'NOT_RUN',runtime:'NOT_RUN',foundation:'Assembled from checked-in native nydus component fixtures; not a complete original scenario or Editor golden',staticMap,gui,data,archive,hashes};
await fs.writeFile(path.join(packet,'static-report.json'),JSON.stringify(report,null,2)+'\n');
await fs.writeFile(path.join(packet,'RESULTS.json'),JSON.stringify({editorVersion:null,dependencies:null,load:'NOT_RUN',save:'NOT_RUN',reopen:'NOT_RUN',run:'NOT_RUN',regeneratedGalaxy:'NOT_RUN',notes:''},null,2)+'\n');
await fs.writeFile(path.join(packet,'README_RU.md'),`# Ручная приёмка SC2 Editor

Статус Editor/load/save/runtime: NOT_RUN. Пакет — изолированная сборка native component fixtures, не полный исходный сценарий и не подтверждённая golden-карта.
components содержит исходники; упакованный components/.sc2mcp-output/TypedGui.SC2Map находится в изолированном workspace после verified archive export (см. static-report.json).

1. Закройте или сохраните свою текущую сессию самостоятельно. Откройте копию указанного архива в отдельном Editor.
2. Запишите версию Editor/SC2 и фактически доступные зависимости из DocumentInfo. Недоступная зависимость — отдельное внешнее условие, не скрывайте его как PASS.
3. В Trigger Editor найдите ManualAcceptance / HardeningInit: Map Initialization, Wait 0.5 Game Time, Destroy All Dialogs. Проверьте порядок действий, типы, NativeLib binding и TriggerStrings.
4. В Data Editor проверьте HardeningDamage.Amount=1 и HardeningSet.EffectArray -> HardeningDamage.
5. Сохраните под новым именем, закройте и откройте вновь. Сравните события/действия/строки/ссылки. Сохраните regenerated MapScript.galaxy, compiler errors и журнал загрузки.
6. Запустите Test Document только на копии. Зафиксируйте реальный load/run и ошибки; наличие статически корректного XML не подтверждает исполнение события.
7. Для positive gamelink UnitCreate используйте trigger.plan на копии с реально объявленной и доступной Unit и существующей point Variable. Отдельно проверьте literal/variable/preset/gamelink; вложенный call/block/customScript в этой версии должен быть отвергнут до staging.
8. Заполните RESULTS.json. До этого ни Editor, ни runtime не считаются проверенными.

Источники fixtures: src/tests/fixtures/terrain-native/nydus и map-native/nydus. Исходные карты, пользовательская сессия и настройки соединений не изменялись.
`);
console.log(JSON.stringify({packet,staticValid:staticMap.valid,guiValid:gui.valid,dataValid:data.valid,editor:'NOT_RUN'},null,2));
