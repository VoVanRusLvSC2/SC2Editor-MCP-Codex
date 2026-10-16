import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePreviewDds} from '../modules/assets/cubeTexture.js';
import {decodeAmbientCube} from '../modules/lighting/cube.js';
import {createGlobalLightingKernel} from '../modules/lighting/math.js';

function cube(format='RGB32',mips=2,pitch=8){
 const header=Buffer.alloc(128);header.write('DDS ');header.writeUInt32LE(124,4);header.writeUInt32LE(0x100f,8);
 header.writeUInt32LE(2,12);header.writeUInt32LE(2,16);header.writeUInt32LE(pitch,20);header.writeUInt32LE(mips,28);header.writeUInt32LE(32,76);header.writeUInt32LE(0xfe00,112);
 if(format==='RGB32'){header.writeUInt32LE(0x41,80);header.writeUInt32LE(32,88);[0x00ff0000,0x0000ff00,0x000000ff,0xff000000].forEach((m,i)=>header.writeUInt32LE(m,92+i*4));}
 else{header.write(format,84);header.writeUInt32LE(4,80);}
 const faces:Buffer[]=[];
 for(let f=0;f<6;f++){
  if(format==='RGB32'){const top=Buffer.alloc(pitch*2,0xff);for(let y=0;y<2;y++)for(let x=0;x<2;x++)top.writeUInt32LE((0xa0000000|((f+1)<<16)|(y<<8)|x)>>>0,y*pitch+x*4);faces.push(top);}
  else{const top=Buffer.alloc(format==='DXT1'?8:16);top.writeUInt16LE([0xf800,0x07e0,0x001f,0xffff,0xffe0,0xf81f][f],format==='DXT1'?0:8);if(format==='DXT3')top.fill(255,0,8);if(format==='DXT5')top[0]=255;faces.push(top);}
  if(mips>1)faces.push(Buffer.alloc(format==='RGB32'?4:format==='DXT1'?8:16,0x55));
 }
 return Buffer.concat([header,...faces]);
}

test('RGB32 cube keeps six face positions, channel masks, row pitch and face-major mip offsets',()=>{
 for(const pitch of [8,12]){
  const input=cube('RGB32',2,pitch),before=Buffer.from(input),image=decodePreviewDds(input);
  assert.equal(image.width,8);assert.equal(image.height,6);assert.equal(image.caps2,0);
  // Independent atlas positions: +X right, -X left, +Y bottom, -Y top,
  // +Z center and -Z far right. A second mip must not become the next face.
  const cells=[[2,1],[0,1],[1,2],[1,0],[1,1],[3,1]];
  for(let face=0;face<6;face++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
   const at:number=((cells[face][1]*2+y)*image.width+cells[face][0]*2+x)*4;
   assert.deepEqual([...image.rgba.subarray(at,at+4)],[face+1,1-y,x,160]);
  }
  assert.deepEqual(input,before);
 }
});

test('cube cross matches the six D3D face cameras at off-axis pixel centres',()=>{
 // Independent D3DXMatrixLookAtLH face-camera basis from Microsoft's native
 // cubemap example. Every row/column is distinct so a face flip is observable.
 const fwd=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],up=[[0,1,0],[0,1,0],[0,0,-1],[0,0,1],[0,1,0],[0,1,0]],size=4;
 const header=Buffer.from(cube('RGB32',1).subarray(0,128));header.writeUInt32LE(size,12);header.writeUInt32LE(size,16);header.writeUInt32LE(size*4,20);
 const faces=fwd.map((_,face)=>{const rgba=Buffer.alloc(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++)rgba.writeUInt32LE((0xff000000|((face+1)<<16)|(y<<8)|x)>>>0,(y*size+x)*4);return rgba;});
 const input=Buffer.concat([header,...faces]),before=Buffer.from(input),atlas=decodePreviewDds(input),ambient=decodeAmbientCube(input),lighting=createGlobalLightingKernel(),light={...lighting.fallback,environmentCube:ambient};
 const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 // Current 2D material cubeUv contract: it packs a horizontal cross with +Y
 // down inside the X/Z faces and -Z down on the +Y face. Shader anchors and
 // source hash are verified separately by the actual-scene migration audit.
 const previewUv=(d:number[])=>{
  const a=d.map(Math.abs);let q:number[],cell:number[];
  if(a[0]>=a[1]&&a[0]>=a[2]){q=[(d[0]>0?-d[2]:d[2])/a[0],d[1]/a[0]];cell=d[0]>0?[2,1]:[0,1];}
  else if(a[1]>=a[2]){q=[d[0]/a[1],(d[1]>0?-d[2]:d[2])/a[1]];cell=d[1]>0?[1,2]:[1,0];}
  else{q=[(d[2]>0?d[0]:-d[0])/a[2],d[1]/a[2]];cell=d[2]>0?[1,1]:[3,1];}
  return [(q[0]*.5+.5+cell[0])/4,(q[1]*.5+.5+cell[1])/3];
 };
 for(let face=0;face<6;face++){
  const right=cross(up[face],fwd[face]),cameraUp=cross(fwd[face],right);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const h=2*(x+.5)/size-1,v=1-2*(y+.5)/size;
   const direction=fwd[face].map((n,i)=>n+right[i]*h+cameraUp[i]*v),uv=previewUv(direction);
   const at=(Math.floor(uv[1]*atlas.height)*atlas.width+Math.floor(uv[0]*atlas.width))*4;
   assert.deepEqual([...atlas.rgba.subarray(at,at+4)],[face+1,y,x,255],`${face}/${x}/${y}`);
   assert.deepEqual(lighting.cube(light,direction),[face+1,y,x].map(v=>v/255),`native ambient face ${face}/${x}/${y}`);
  }
 }
 assert.deepEqual(input,before);
});

test('native cube rows stay distinct from the material atlas conversion',()=>{
 const input=cube(),native=decodePreviewDds(input,'native'),preview=decodePreviewDds(input);
 const at=(2*native.width+4)*4;
 assert.deepEqual([...native.rgba.subarray(at,at+4)],[1,0,0,160]);
 assert.deepEqual([...preview.rgba.subarray(at,at+4)],[1,1,0,160]);
});

test('DXT cube variants retain block sizes across mip chains and opaque face pixels',()=>{
 for(const format of ['DXT1','DXT3','DXT5']){
  const image=decodePreviewDds(cube(format));
  assert.deepEqual([...image.rgba.subarray((2*8+4)*4,(2*8+4)*4+4)],[255,0,0,255]);
  assert.deepEqual([...image.rgba.subarray((2*8)*4,(2*8)*4+4)],[0,255,0,255]);
 }
});

test('ordinary 2D DDS retains its original row orientation',()=>{
 const input=Buffer.from(cube('RGB32',1).subarray(0,128+16));input.writeUInt32LE(0,112);
 const before=Buffer.from(input),image=decodePreviewDds(input);
 assert.equal(image.width,2);assert.equal(image.height,2);
 assert.deepEqual([...image.rgba.subarray(0,4)],[1,0,0,160]);
 assert.deepEqual([...image.rgba.subarray(8,12)],[1,1,0,160]);
 assert.deepEqual(input,before);
});

test('DDS cube rejects incomplete faces, invalid mip counts and truncated last mip',()=>{
 const short=cube().subarray(0,-1);assert.throws(()=>decodePreviewDds(short),/DDS_CUBE_TRUNCATED/);
 const faces=cube();faces.writeUInt32LE(0x200,112);assert.throws(()=>decodePreviewDds(faces),/DDS_CUBE_FACES_UNSUPPORTED/);
 const mips=cube();mips.writeUInt32LE(20,28);assert.throws(()=>decodePreviewDds(mips),/DDS_CUBE_MIPMAPS_UNSUPPORTED/);
 const bad=cube();bad.writeUInt32LE(16,88);assert.throws(()=>decodePreviewDds(bad),/DDS_CUBE_FORMAT_UNSUPPORTED/);
});
