import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {Workspace} from '../core/workspace.js';import {BrowseWorkspace} from '../modules/browse/workspace.js';import {DataWorkspace} from '../modules/data/workspace.js';import {PlacementWorkspace} from '../modules/placement/workspace.js';import {PlacementDocument} from '../modules/placement/document.js';import {createLocationSchema} from '../modules/placement/locationSchemas.js';
async function fixture(t:test.TestContext){const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-location-clusters-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});const workspace=new Workspace(root),browse=new BrowseWorkspace(workspace,new DataWorkspace(workspace));return {root,workspace,placement:new PlacementWorkspace(workspace,browse)};}
const base={locationType:'custom' as const,candidateIds:['AgriaTree'],area:{type:'rectangle' as const,minX:4,minY:4,maxX:28,maxY:28,z:0},objectCount:24,seed:42,minimumDistance:.8};
test('old location requests retain their normalized shape and uniform seeded placements',async t=>{
 const f=await fixture(t),parsed=createLocationSchema.parse(base);assert.equal(Object.hasOwn(parsed,'clusterCount'),false);assert.equal(Object.hasOwn(parsed,'clusterRadius'),false);assert.equal(Object.hasOwn(parsed,'clusterSeparation'),false);
 const plain=await f.placement.createLocation(base),zero=await f.placement.createLocation({...base,clusterCount:0,clusterRadius:2});assert.deepEqual(plain.plan.operations,zero.plan.operations);assert.equal(Object.hasOwn(plain.composition,'clustering'),false);assert.equal(Object.hasOwn(zero.composition,'clustering'),false);assert.equal(f.workspace.draftFiles().length,0);
});
test('clustered location centers and placements respect concavity, exclusions, routes and existing objects',async t=>{
 const f=await fixture(t),area={type:'polygon' as const,points:[{x:4,y:4},{x:28,y:4},{x:28,y:14},{x:16,y:14},{x:16,y:28},{x:4,y:28}],z:0},exclusionZones=[{type:'circle' as const,center:{x:10,y:10},radius:2}],reservedCorridors=[{points:[{x:7,y:4},{x:7,y:28}],width:2}],document=new PlacementDocument(await fs.readFile(path.join(f.root,'Objects'),'utf8'));
 document.add({kind:'Doodad',catalogId:'AgriaTree',position:{x:13,y:12,z:0}});
 const args={...base,area,clusterCount:3,clusterRadius:4,exclusionZones,reservedCorridors},first=await f.placement.createLocation(args,document),second=await f.placement.createLocation(args,document);assert.deepEqual(first.plan.operations,second.plan.operations);assert.deepEqual(first.composition.clustering,second.composition.clustering);
 const clusters=first.composition.clustering!;assert.equal(clusters.count,3);const inside=(p:{x:number;y:number})=>p.x>=4&&p.x<=28&&p.y>=4&&p.y<=28&&(p.x<=16||p.y<=14);
 const points=first.plan.operations.map(op=>{assert.equal(op.op,'add');return (op as Extract<typeof op,{op:'add'}>).object.position;});
 for(const p of [...clusters.centers,...points]){assert.ok(inside(p));assert.ok(Math.hypot(p.x-10,p.y-10)>=2);assert.ok(Math.abs(p.x-7)>=1);}
 for(let i=0;i<points.length;i++){const p=points[i];assert.ok(clusters.centers.some(c=>Math.hypot(p.x-c.x,p.y-c.y)<=4));assert.ok(Math.hypot(p.x-13,p.y-12)>=.8);for(let j=0;j<i;j++)assert.ok(Math.hypot(p.x-points[j].x,p.y-points[j].y)>=.8);}
 assert.equal(points.length,24);assert.equal(f.workspace.draftFiles().length,0);
});
test('cluster requests reject impossible density instead of silently reverting to uniform placement',async t=>{
 const f=await fixture(t),before=await fs.readFile(path.join(f.root,'Objects'));await assert.rejects(f.placement.createLocation({...base,objectCount:10,minimumDistance:2,clusterCount:1,clusterRadius:.1}),/Could place only/);
 await assert.rejects(f.placement.createLocation({...base,clusterCount:33}),/CLUSTER_COUNT/);assert.equal(createLocationSchema.safeParse({...base,clusterCount:33}).success,false);assert.equal(createLocationSchema.safeParse({...base,clusterRadius:0}).success,false);
 assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),before);assert.deepEqual(f.workspace.draftFiles(),[]);
});

test('explicit cluster separation preserves distinct center groups and rejects an impossible center layout',async t=>{
 const f=await fixture(t),args={...base,clusterCount:3,clusterRadius:4,clusterSeparation:9},a=await f.placement.createLocation(args),b=await f.placement.createLocation(args);assert.deepEqual(a.plan.operations,b.plan.operations);const clustering=a.composition.clustering!;assert.equal(clustering.minimumCenterDistance,9);for(let i=0;i<clustering.centers.length;i++)for(let j=0;j<i;j++)assert.ok(Math.hypot(clustering.centers[i].x-clustering.centers[j].x,clustering.centers[i].y-clustering.centers[j].y)>=9);
 const before=await fs.readFile(path.join(f.root,'Objects'));await assert.rejects(f.placement.createLocation({...args,clusterSeparation:100}),/Could place only/);assert.equal(createLocationSchema.safeParse({...args,clusterSeparation:-1}).success,false);assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),before);assert.deepEqual(f.workspace.draftFiles(),[]);
});
