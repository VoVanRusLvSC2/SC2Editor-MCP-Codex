import test from 'node:test';
import assert from 'node:assert/strict';
import {upsertCustomScripts} from '../modules/trigger/customScripts.js';
import {emitGuiGalaxy} from '../modules/trigger/runtime.js';
import type {Registry} from '../modules/trigger/authoring.js';
import {compileAuthorScript} from '../app/authoringScript.js';
import {scanXml} from '../core/xmlScanner.js';
import {organizeTriggerXml} from '../modules/trigger/organization.js';
const registry={functions:[],definitions:[],typeDefinitions:{presets:[],presetValues:[]}} as unknown as Registry;
const source='<TriggerData><Root><Item Type="Trigger" Id="A"/></Root><Element Type="Trigger" Id="A"><Identifier>RoundTick</Identifier></Element></TriggerData>';
const args={genre:'arena' as const,items:[{kind:'declaration' as const,identifier:'State',folder:'FUNCTIONS/STATE',code:'int counter;\nvoid Step () { if (counter < 4) { counter += 1; } }'},{kind:'action' as const,identifier:'TickAction',folder:'ROUNDS/WAVES',triggerId:'A',code:'Step();'}]};
test('visible Custom Script declarations/actions have stable IDs and real arena folders',()=>{
 const first=upsertCustomScripts(source,args),second=upsertCustomScripts(first.xml,args);
 assert.equal(second.xml,first.xml);
 assert.deepEqual(second.items,first.items);
 assert.ok(first.folders.some(f=>f.path==='ROUNDS/WAVES'));
 assert.match(first.xml,/<ScriptCode>\n\s+int counter;/);
 assert.match(first.xml,/counter &lt; 4/);
});
test('runtime comes from the same GUI Custom Script code and action reference',()=>{
 const result=upsertCustomScripts(source,args),generated=emitGuiGalaxy(result.xml,registry);
 assert.match(generated.source,/void Step \(\)/);
 assert.match(generated.source,/counter < 4/);
 assert.match(generated.source,/Step\(\);/);
 assert.equal(generated.triggers,1);
 assert.equal(generated.source.split('void Step').length,2);
});
test('malformed code, missing target and duplicate batch identity fail without partial output',()=>{
 assert.throws(()=>upsertCustomScripts(source,{...args,items:[{...args.items[0],code:'void Broken () {'}]}),/SYNTAX/);
 assert.throws(()=>upsertCustomScripts(source,{...args,items:[{...args.items[1],triggerId:'Missing'}]}),/TRIGGER_MISSING/);
 assert.throws(()=>upsertCustomScripts(source,{...args,items:[args.items[0],args.items[0]]}),/DUPLICATE/);
 assert.throws(()=>upsertCustomScripts('<TriggerData><Library Id="X"/></TriggerData>',args),/MAP_ROOT_ONLY/);
});
test('unknown script templates fail closed instead of being silently executed',()=>{
 const made=upsertCustomScripts(source,args);
 assert.throws(()=>emitGuiGalaxy(made.xml.replace('<ScriptCode>','<Disabled/><ScriptCode>'),registry),/UNSUPPORTED/);
});
test('economical GUI folder/move commands route through guarded trigger.organize',()=>{
 const a=compileAuthorScript('gui folder path=ROUNDS/WAVES genre=arena','plan');
 const b=compileAuthorScript('gui move type=Trigger id=ABCD folder=ROUNDS/WAVES genre=arena','plan');
 assert.match(JSON.stringify(a),/trigger.organize/);assert.match(JSON.stringify(a),/ROUNDS\/WAVES/);
 assert.match(JSON.stringify(b),/assignments/);
 const c=compileAuthorScript('gui script identifier=Helper folder=ROUNDS genre=arena <<END\nvoid Helper () {}\nEND','save');
 assert.equal(c[0].tool,'trigger.custom_script');assert.equal(c[1].tool,'modkit.save');
});
test('arena roots put shared definitions before main code, preserving unrelated roots',()=>{
 const result=organizeTriggerXml('<TriggerData><Root/></TriggerData>',{genre:'arena',folders:['MAIN/INITIALIZATION','FUNCTIONS/STATE','ROUNDS']});
 const p=scanXml(result.xml),root=p.nodes.find(n=>n.tag==='Root')!,refs=root.childIds.map(i=>p.nodes[i]).filter(n=>n.tag==='Item');
 const category=(id:string)=>p.nodes.find(n=>n.tag==='Element'&&n.attrs.Type==='Category'&&n.attrs.Id===id)!;
 const identifiers=refs.map(r=>{const n=category(r.attrs.Id),v=n.childIds.map(i=>p.nodes[i]).find(n=>n.tag==='Identifier')!;return result.xml.slice(v.startTagEnd,v.endTagStart);});
 assert.deepEqual(identifiers,['FUNCTIONS','MAIN','GAMEPLAY','ROUNDS']);
});

test('remove deletes an exact declaration and its folder item, preserving other elements',()=>{
 const first=upsertCustomScripts(source,{...args,items:[args.items[0]]});
 const removal={...args.items[0],code:'',remove:true};
 const result=upsertCustomScripts(first.xml,{...args,items:[removal]});
 assert.doesNotMatch(result.xml,/<Identifier>State<\/Identifier>|int counter/);
 assert.doesNotMatch(result.xml,new RegExp('Id="'+first.items[0].id+'"'));
 assert.match(result.xml,/<Identifier>RoundTick<\/Identifier>/);
 assert.throws(()=>upsertCustomScripts(source,{...args,items:[removal]}),/REMOVE_MISSING/);
 assert.throws(()=>upsertCustomScripts(first.xml,{...args,items:[{...removal,code:'int x;'}]}),/REMOVE_DECLARATION_ONLY/);
 const referenced=first.xml.replace('</TriggerData>',`<Element Type="Trigger" Id="B"><Action Type="CustomScript" Id="${first.items[0].id}"/></Element></TriggerData>`);
 assert.throws(()=>upsertCustomScripts(referenced,{...args,items:[removal]}),/REMOVE_REFERENCED/);
});
