import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {extractArchive,packArchive,directoryManifest,inspectArchive} from '../../archive/archiveAdapter.js';
import {Workspace} from '../../core/workspace.js';
import {DataWorkspace} from '../data/workspace.js';
import {ScriptWorkspace} from '../script/workspace.js';
import {padQuerySource,type PadSpec,type PadProbeSpec,type PadPoint,type PadChannel,type PathingSpec} from './padQueries.js';
import {probeStorage,type StorageProbe} from './storagePreflight.js';

const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
export async function preparePadProbe(input:{source:string;sourceSha256:string;directory:string;pads:PadSpec[];pathing?:PathingSpec[];points:Record<string,PadPoint>;probe:PadProbeSpec;storageProbe?:StorageProbe}){
 if(!/^[a-f0-9]{64}$/.test(input.sourceSha256)||hash(await fs.readFile(input.source))!==input.sourceSha256)throw Error('PAD_SOURCE_STALE');
 const directory=path.resolve(input.directory),components=path.join(directory,'PadComponents'),archive=path.join(directory,'PadProbe.SC2Map');
 if(path.resolve(input.source)===archive)throw Error('PAD_OUTPUT_EQUALS_SOURCE');
 const pathing=input.pathing??[],prefix=(pathing.length?'MCPQuery':'MCPPad')+randomUUID().replaceAll('-','').slice(0,16),channel:PadChannel={version:pathing.length?3:2,prefix,unitType:prefix+'Carrier',slots:1+input.pads.length*2+pathing.length,queryScript:`Scripts/${prefix}.galaxy`,init:prefix+'_Init',pads:input.pads,...(pathing.length?{pathing}:{}),points:input.points,probe:input.probe};
 const query=padQuerySource(channel),dataFile=`Base.SC2Data/GameData/${prefix}.xml`;
 const manifest=await inspectArchive(input.source),expandedBytes=manifest.entries.filter(e=>!e.internal).reduce((sum,e)=>sum+e.size,0);
 const requiredFreeBytes=256*1024*1024+expandedBytes*3+(await fs.stat(input.source)).size*3,storage=await (input.storageProbe??probeStorage)(directory);
 if(!Number.isSafeInteger(expandedBytes)||!Number.isSafeInteger(requiredFreeBytes)||storage.availableBytes<requiredFreeBytes)throw Error('PAD_PREPARATION_STORAGE_INSUFFICIENT');
 const extracted=await extractArchive(input.source,components),before=extracted.verification.contentSha256;
 if(!(await fs.stat(path.join(components,'MapScript.galaxy'))).isFile())throw Error('PAD_ENTRY_SCRIPT_REQUIRED');
 const workspace=new Workspace(components),data=new DataWorkspace(workspace,undefined,[]),scripts=new ScriptWorkspace(workspace);
 const created=await data.apply({file:dataFile,operations:[{op:'object.create',ctype:'CUnit',id:channel.unitType,fields:[{name:'LifeMax',value:512},{name:'LifeStart',value:512}]}],dryRun:false,stage:false,backup:false});
 if(created.accepted!==true)throw Error('PAD_CARRIER_DATA_REFUSED');
 const plan=await scripts.plan({operations:[{op:'file.create',file:channel.queryScript,source:query},{op:'connect',file:channel.queryScript,init:channel.init,entryFile:'MapScript.galaxy',entry:'InitMap'}]});
 await scripts.apply(plan.planId,false);await scripts.save(channel.queryScript,false);
 const allowed=new Set([dataFile,channel.queryScript,'ComponentList.SC2Components','Base.SC2Data/GameData.xml','MapScript.galaxy']);
 const after=new Map((await directoryManifest(components)).map(f=>[f.file,f.sha256]));
 for(const [file,digest]of Object.entries(before))if(!allowed.has(file)&&after.get(file)!==digest)throw Error('PAD_SOURCE_COMPONENT_CHANGED: '+file);
 for(const file of after.keys())if(!Object.hasOwn(before,file)&&!allowed.has(file))throw Error('PAD_UNEXPECTED_COMPONENT: '+file);
 const assertSource=async()=>{if(hash(await fs.readFile(input.source))!==input.sourceSha256)throw Error('PAD_SOURCE_STALE');};
 await assertSource();const packed=await packArchive(components,archive,{backup:false,beforePublish:assertSource});await assertSource();
 const result={archive,sha256:hash(await fs.readFile(archive)),sourceSha256:input.sourceSha256,channel,queryScriptSha256:hash(query),
  preservedComponentCount:Object.keys(before).filter(f=>!allowed.has(f)).length,changedFiles:[...allowed].filter(f=>before[f]!==after.get(f)),contentSha256:packed.verification.contentSha256,storage:{expandedBytes,requiredFreeBytes,availableBytes:storage.availableBytes},
  scope:'Private query-only derivative. Original components remain exact except appended InitMap connection and registered isolated helper Data/script. All native queries precede helper emission. No private Game Toolkit source is embedded; ordinary source map is unchanged.'};
 await fs.writeFile(path.join(directory,'PadProbe.json'),JSON.stringify(result,null,2)+'\n');return result;
}
