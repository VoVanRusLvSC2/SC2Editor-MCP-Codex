import test from 'node:test';
import assert from 'node:assert/strict';
import {readM3Geometry} from '../modules/assets/m3.js';

// Independent fixture: native region-local U16 indices must become global U32
// indices even when a valid mesh is larger than the old 100k preview limit.
function largeGeometry(){
 const vertices=146108,stride=32,model=24,vertex=148,division=vertex+vertices*stride,faces=division+52,regions=faces+6,index=regions+3*36;
 const b=Buffer.alloc(index+5*16),tag=(value:string,at:number)=>b.write(value.split('').reverse().join(''),at),ref=(at:number,count:number,section:number)=>{b.writeUInt32LE(count,at);b.writeUInt32LE(section,at+4);};
 tag('MD34',0);b.writeUInt32LE(index,4);b.writeUInt32LE(5,8);ref(12,1,0);b.writeUInt32LE(0x20000,model+96);ref(model+100,vertices*stride,1);ref(model+112,1,2);ref(division,3,3);ref(division+12,3,4);
 for(const [i,[first,count]] of [[0,50000],[50000,50000],[100000,46108]].entries()){const at=regions+i*36;b.writeUInt32LE(first,at+8);b.writeUInt32LE(count,at+12);b.writeUInt32LE(i===2?3:0,at+20);}
 b.writeUInt16LE(46106,faces+2);b.writeUInt16LE(46107,faces+4);[2,4,6].forEach((value,c)=>b.writeFloatLE(value,vertex+(vertices-1)*stride+c*4));
 for(const [i,[name,at,count,version]] of ([['MODL',model,1,23],['U8__',vertex,vertices*stride,0],['DIV_',division,1,2],['U16_',faces,3,0],['REGN',regions,3,3]] as const).entries()){const p=index+i*16;tag(name,p);b.writeUInt32LE(at,p+4);b.writeUInt32LE(count,p+8);b.writeUInt32LE(version,p+12);}
 return {b,regions,faces};
}

test('large native-style mesh keeps region offsets and vertices above100k',()=>{
 const {b,faces}=largeGeometry(),g=readM3Geometry(b);
 assert.equal(g.vertexCount,146108);assert.deepEqual(g.indices,[100000,146106,146107]);assert.deepEqual(g.positions.slice(-3),[2,4,6]);
 b.writeUInt16LE(46108,faces+4);assert.throws(()=>readM3Geometry(b),/FACE_VERTEX_INVALID/);
});

test('oversized region is a resource-budget error rather than an unsupported layout',()=>{
 const {b,regions}=largeGeometry();b.writeUInt32LE(162145,regions+2*36+12);
 assert.throws(()=>readM3Geometry(b),/M3_VERTEX_BUDGET/);
});
