import test from 'node:test';
import assert from 'node:assert/strict';
import {PlacementDocument} from '../modules/placement/document.js';
const fixture=()=>{const d=PlacementDocument.create();d.addMany([1,2,3].map(i=>({kind:'Doodad' as const,catalogId:'AgriaTree',position:{x:i,y:2,z:0},flags:{HeightAbsolute:'1'}})));return new PlacementDocument(d.source.replace('<PlacedObjects Version="27">','<PlacedObjects Version="27" Unknown="keep">\r\n<!-- authored -->'));};
test('bulk position/removal runs preserve sequential XML and unrelated authored content',()=>{
 const a=fixture(),b=new PlacementDocument(a.source),moves=[{objectId:1,position:{x:2,y:3,z:.1234567}},{objectId:2,position:{x:4,y:5,z:1}},{objectId:1,position:{x:8,y:9,z:-0}}];
 for(const m of moves)a.move(m.objectId,m.position);b.moveMany(moves);assert.equal(b.source,a.source);a.remove(1);a.remove(3);b.removeMany([1,3]);assert.equal(b.source,a.source);assert.match(b.source,/Unknown="keep"/);assert.match(b.source,/authored/);
 const c=fixture();assert.deepEqual(c.apply([{op:'move',objectId:1,position:{x:2,y:3,z:0}},{op:'move',objectId:2,position:{x:4,y:5,z:0}},{op:'remove',objectId:1},{op:'remove',objectId:3}]),[{index:0,op:'move',objectId:1},{index:1,op:'move',objectId:2},{index:2,op:'remove',objectId:1},{index:3,op:'remove',objectId:3}]);
});
test('invalid bulk targets and values leave all XML unchanged',()=>{
 const d=fixture(),before=d.source;assert.throws(()=>d.removeMany([1,99]),/not found/);assert.equal(d.source,before);assert.throws(()=>d.removeMany([1,1]),/DUPLICATE/);assert.equal(d.source,before);assert.throws(()=>d.moveMany([{objectId:1,position:{x:NaN,y:0,z:0}},{objectId:1,position:{x:1,y:0,z:0}}]),/finite/);assert.equal(d.source,before);
});
