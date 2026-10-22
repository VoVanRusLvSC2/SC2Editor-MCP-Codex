import test from 'node:test';
import assert from 'node:assert/strict';
import {corridorWithinArea} from '../modules/terrain/geometry.js';
test('location road containment checks its width, caps and concave crossings',()=>{
 const polygon={type:'polygon' as const,points:[{x:0,y:0},{x:10,y:0},{x:10,y:4},{x:4,y:4},{x:4,y:10},{x:0,y:10}]};
 assert.equal(corridorWithinArea(polygon,[{x:2,y:8},{x:2,y:2},{x:8,y:2}],2),true);
 assert.equal(corridorWithinArea(polygon,[{x:2,y:8},{x:8,y:2}],1),false);
 assert.equal(corridorWithinArea(polygon,[{x:2,y:8},{x:2,y:2}],5),false);
 assert.equal(corridorWithinArea({type:'circle',center:{x:0,y:0},radius:5},[{x:-4,y:0},{x:4,y:0}],2),true);
 assert.equal(corridorWithinArea({type:'circle',center:{x:0,y:0},radius:5},[{x:-4,y:0},{x:4,y:0}],3),false);
 assert.equal(corridorWithinArea({type:'rectangle',minX:0,minY:0,maxX:10,maxY:10},[{x:.5,y:5},{x:8,y:5}],2),false);
});
