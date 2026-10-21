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
await fs.writeFile(path.join(packet,'README.md'),`# Manual reception of SC2 Editor

Editor/load/save/runtime: NOT_RUN is an isolated build of native component fixtures, not a complete original script, and not a confirmed golden card.
The packaged components/.sc2mcp-output/TypedGui.SC2Map is located in isolated workspace after verified archive export (see static-report.json).

1. Close or save your current session yourself. Open a copy of the archive in a separate Editor.
2. Write down the Editor/SC2 version and the actual dependencies available from DocumentInfo. Unavailable dependency is a separate external condition, don't hide it as PASS.
3. In Trigger Editor, find ManualAcceptance/HardeningInit: Map Initialization, Wait 0.5 Game Time, Destroy All Dialogs.Check the order, types, NativeLib binding and TriggerStrings.
4. In Data Editor, check HardeningDamage.Amount=1 and HardeningSet.EffectArray -> HardeningDamage.
5. Save under a new name, close and reopen. Compare events/actions/line/links. Save regenerated MapScript.galaxy, compiler errors and download log.
6. Run Test Document on copies only. Record real load/run and errors; having a statically correct XML does not confirm the execution of the event.
7. For positive gamelink UnitCreate, use trigger.plan on a copy from the actual announced and available Unit and the existing point Variable.Separately check the literal/variable/preset/gamelink; the attached call/block/customScript in this version must be rejected before staging.
8. Fill in RESULTS.json. Before that, neither Editor nor runtime is considered validated.

The sources of fixtures are src/tests/fixtures/terrain-native/nydus and map-native/nydus. source maps, user session and connection settings have not changed.
`);
console.log(JSON.stringify({packet,staticValid:staticMap.valid,guiValid:gui.valid,dataValid:data.valid,editor:'NOT_RUN'},null,2));
