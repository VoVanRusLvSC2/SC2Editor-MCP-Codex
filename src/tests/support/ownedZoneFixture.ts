import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import type {TestContext} from 'node:test';
import {Workspace} from '../../core/workspace.js';
import {TerrainWorkspace} from '../../modules/terrain/workspace.js';
import {BrowseWorkspace} from '../../modules/browse/workspace.js';
import {DataWorkspace} from '../../modules/data/workspace.js';
import {PlacementWorkspace} from '../../modules/placement/workspace.js';

export const ownedZone=(id='west',minX=4,minY=4,maxX=14,maxY=14)=>({id,config:{locationType:'forest' as const,area:{type:'rectangle' as const,minX,minY,maxX,maxY,z:0},objectCount:4,minimumDistance:1,seed:42,terrain:{style:'forest' as const,heightMode:'preserve' as const,textureMode:'preserve' as const}}});
export const ownedChild=(id='leaf',parent='west')=>({id,dependsOn:[parent],config:{...ownedZone().config,objectCount:0}});
export const ownedBindingsManifest=()=>({version:1,map:'Future.SC2Map',label:'Explicit route and pad reservations',game:{points:{a:{x:3,y:18},b:{x:28,y:18},pad:{x:24,y:24},probe:{x:3,y:3}},routes:[{id:'lane',from:'a',to:'b',type:'Marine',mobility:'ground',maxDeviation:2}],formations:[{id:'pair',from:'a',to:'b',type:'Marine',mobility:'ground',offsets:[{x:0,y:0},{x:0,y:2}]}],pads:[{id:'base',at:'pad',type:'SupplyDepot',expected:'exact'}],nativeProbe:{origin:'probe'},capture:false}});
export const ownedBindings={routeSource:{file:'acceptance.json',clearWidth:2},padSource:{file:'acceptance.json',pads:[{id:'base',clearWidth:4,clearHeight:4}]}};
export async function ownedFixture(t:TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'owned-zone-review-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const name of await fs.readdir('src/tests/fixtures/terrain-native/nydus'))await fs.writeFile(path.join(root,name.slice(0,-3)),gunzipSync(await fs.readFile(path.join('src/tests/fixtures/terrain-native/nydus',name))));
 await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});
 const workspace=new Workspace(root),browse=new BrowseWorkspace(workspace,new DataWorkspace(workspace)),placement=new PlacementWorkspace(workspace,browse),terrain=new TerrainWorkspace(workspace,browse,placement);placement.terrain=terrain;
 const ledger=async()=>JSON.parse(await fs.readFile(path.join(root,'.sc2mcp/locations.json'),'utf8'));
 const commit=async(plan:any)=>{assert.equal(plan.valid,true);await terrain.apply(plan.id,{dryRun:false,stage:true,backup:false});await terrain.savePlan(plan.id,{dryRun:false,backup:false});return plan;};
 const apply=async(input:Parameters<TerrainWorkspace['ownedLandscape']>[0])=>commit(await terrain.ownedLandscape(input));
 return{root,workspace,browse,placement,terrain,ledger,commit,apply};
}
