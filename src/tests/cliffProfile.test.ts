import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {TerrainDescriptor,HeightMap} from '../modules/terrain/document.js';
import {parseTerrainXml} from '../modules/terrain/surface/format/terrain-params.js';
import {nativeCliffSyncLevels,nativeCliffFineLevels} from '../modules/terrain/cliffProfile.js';

test('one-level cliff sync profile matches original native cells for all 12 non-saddle orientations',async()=>{
 const root='src/tests/fixtures/terrain-native/city/',read=async(name:string)=>gunzipSync(await fs.readFile(root+name+'.gz'));
 const [xml,h,c]=await Promise.all(['t3Terrain.xml','t3HeightMap','t3SyncCliffLevel'].map(read)),descriptor=new TerrainDescriptor(xml.toString('utf8')),height=new HeightMap(h,descriptor),w=height.width-1;
 const parsed=parseTerrainXml(descriptor.source),level=(x:number,y:number)=>h.readUInt16LE(32+(y*(w+1)+x)*6+4)&255;
 let checked=0;const shapes=new Set<string>(),finePatterns=new Map<string,Set<string>>();
 for(const cell of parsed.cliffCells??[]){
  if(cell.flags!==1)continue;const x=cell.index%(w/2)*2,y=Math.floor(cell.index/(w/2))*2;
  if((parsed.ramps??[]).some(r=>{const m=r.frames.mid;return m&&Math.abs(x+1-m.center[0])<6&&Math.abs(y+1-m.center[1])<6;}))continue;
  const values=[];for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)values.push(level(x+dx,y+dy));
  const lo=Math.min(...values),hi=Math.max(...values);if(lo<1||hi-lo!==1)continue;
  const corners=[level(x,y),level(x+2,y),level(x+2,y+2),level(x,y+2)],key=corners.map(v=>v-lo).join('');if(key==='0000'||key==='1111')continue;
  const actual=[];for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)actual.push(c.readUInt16LE(32+((y+dy)*w+x+dx)*2));
  assert.deepEqual(nativeCliffSyncLevels(corners),actual,'native cell '+x+','+y+' pattern '+key);shapes.add(key);checked++;
  const patterns=finePatterns.get(key)??new Set<string>();patterns.add(values.map(v=>v-lo).join(''));finePatterns.set(key,patterns);
 }
 assert.equal(checked,396);assert.equal(shapes.size,12);
 for(const [key,observed]of finePatterns){const corners=[...key].map(v=>Number(v)+1),selected=nativeCliffFineLevels(corners).map(v=>v-1).join('');assert.ok(observed.has(selected),'selected fine pattern was not observed natively: '+key);}
});

test('unmeasured void, multi-level and saddle joins fail instead of writing guessed cliff sync',()=>{
 for(const corners of [[1,2,1,2],[2,1,2,1],[1,3,3,1],[0,1,1,0]])assert.throws(()=>nativeCliffSyncLevels(corners),/UNSUPPORTED/);
 assert.deepEqual(nativeCliffSyncLevels([1,1,1,1]),[64,64,64,64]);
 assert.deepEqual(nativeCliffSyncLevels([1,2,2,2]),[128,128,128,128]);
});
