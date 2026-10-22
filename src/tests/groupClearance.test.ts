import test from 'node:test';
import assert from 'node:assert/strict';
import {checkGroupClearance} from '../modules/placement/groupClearance.js';
const bounds={type:'rectangle' as const,minX:-10,minY:-10,maxX:10,maxY:10};
const geometry={position:{x:0,y:0},corners:[{x:-4,y:-1},{x:4,y:-1},{x:-4,y:1},{x:4,y:1}]};
test('a measured member cannot bridge across a reserved route or envelop an exclusion',()=>{
 assert.throws(()=>checkGroupClearance(geometry,bounds,[{points:[{x:3,y:-4},{x:3,y:4}],width:.4}],[]),/RESERVED_ROUTE/);
 assert.throws(()=>checkGroupClearance(geometry,bounds,[],[{type:'circle',center:{x:3,y:0},radius:.2}]),/EXCLUSION/);
 assert.throws(()=>checkGroupClearance(geometry,bounds,[],[{type:'rectangle',minX:3,minY:-.2,maxX:3.2,maxY:.2}]),/EXCLUSION/);
 assert.deepEqual(checkGroupClearance(geometry,bounds,[{points:[{x:6,y:-4},{x:6,y:4}],width:.4}],[]),{type:'rectangle',minX:-4,minY:-1,maxX:4,maxY:1});
});
test('concave-zone containment checks complete member edges, not only corners and pivot',()=>{
 const area={type:'polygon' as const,points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:6,y:10},{x:6,y:4},{x:4,y:4},{x:4,y:10},{x:0,y:10}]};
 assert.throws(()=>checkGroupClearance({position:{x:5,y:3},corners:[{x:1,y:1},{x:9,y:1},{x:1,y:5},{x:9,y:5}]},area,[],[]),/OUTSIDE_ZONE/);
});
