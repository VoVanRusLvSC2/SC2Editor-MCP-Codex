import {decodeDds,inspectDds} from './dds.js';
import type {PreviewCubeTexture} from '../cutscenePreview/types.js';
/** Legacy DDS cube: +X -X +Y -Y +Z -Z, face-major mip chains.
 * The preview's cubeUv uses the opposite per-face V axis to native D3D/GL
 * cubemap sampling. Reverse rows within each face when packing its cross.
 * This conversion is for the 2D preview atlas, not a samplerCube upload.
 * D3D face cameras: learn.microsoft.com/windows/win32/direct3d9/creating-cubic-environment-map-surfaces
 * GL table: registry.khronos.org/OpenGL/extensions/ARB/ARB_texture_cube_map.txt */
export function decodePreviewDds(bytes:Buffer,cubeRows:'preview-atlas'|'native'='preview-atlas'){
 const info=inspectDds(bytes);
 if(!(info.caps2&0x200))return decodeDds(bytes);
 if((info.caps2&0xfc00)!==0xfc00||info.width!==info.height||info.depth>1)throw new Error('DDS_CUBE_FACES_UNSUPPORTED');
 const stride=info.format==='DXT1'?8:['DXT3','DXT5'].includes(info.format)?16:0;
 const rgb32=info.format==='RGB32'&&!!(bytes.readUInt32LE(80)&64);
 if(!stride&&!rgb32)throw new Error('DDS_CUBE_FORMAT_UNSUPPORTED');
 if(info.mipmaps>1+Math.floor(Math.log2(info.width)))throw new Error('DDS_CUBE_MIPMAPS_UNSUPPORTED');
 const atlasBytes=info.width*4*info.height*3*4;
 if(atlasBytes>128*1024*1024)throw new Error('DDS_CUBE_PIXEL_BUDGET');
 const pitch=rgb32&&(bytes.readUInt32LE(8)&8)?bytes.readUInt32LE(20):info.width*4;
 if(rgb32&&pitch<info.width*4)throw new Error('DDS_DATA_TRUNCATED');
 const size=(w:number,h:number,mip:number)=>stride?Math.ceil(w/4)*Math.ceil(h/4)*stride:(mip===0?pitch:w*4)*h;
 const rgba=Buffer.alloc(atlasBytes),cells=[[2,1],[0,1],[1,2],[1,0],[1,1],[3,1]];
 let offset=128;
 for(let face=0;face<6;face++){
  const top=size(info.width,info.height,0),header=Buffer.from(bytes.subarray(0,128));
  header.writeUInt32LE(0,112);header.writeUInt32LE(1,28);
  if(offset+top>bytes.length)throw new Error('DDS_CUBE_TRUNCATED');
  const image=decodeDds(Buffer.concat([header,bytes.subarray(offset,offset+top)]));
  for(let y=0;y<info.height;y++)image.rgba.copy(rgba,((cells[face][1]*info.height+(cubeRows==='native'?y:info.height-1-y))*info.width*4+cells[face][0]*info.width)*4,y*info.width*4,(y+1)*info.width*4);
  for(let mip=0,w=info.width,h=info.height;mip<info.mipmaps;mip++,w=Math.max(1,w>>1),h=Math.max(1,h>>1)){
   offset+=size(w,h,mip);
   if(offset>bytes.length)throw new Error('DDS_CUBE_TRUNCATED');
  }
 }
 return {...info,width:info.width*4,height:info.height*3,caps2:0,rgba};
}

/** Retain the original face-major mip data for real samplerCube uploads.
 * BC blocks are copied exactly; RGB masks/pitch are converted to RGBA8.
 * No mip generation, face flips, resampling or gloss-dependent filtering. */
export function packPreviewCube(bytes:Buffer):PreviewCubeTexture{
 const info=inspectDds(bytes);
 if(!(info.caps2&0x200))throw new Error('DDS_CUBE_REQUIRED');
 // Reuse the validated legacy cube bounds/format/face-major layout contract.
 decodePreviewDds(bytes,'native');
 const format=info.format==='DXT1'?'bc1':info.format==='DXT3'?'bc2':info.format==='DXT5'?'bc3':'rgba8';
 const block=format==='bc1'?8:format==='rgba8'?0:16;
 const pitch=(bytes.readUInt32LE(8)&8)?bytes.readUInt32LE(20):info.width*4;
 const levels=Array.from({length:info.mipmaps},(_,level)=>({size:Math.max(1,info.width>>level),faces:[] as string[]}));
 let offset=128;
 for(let face=0;face<6;face++)for(let level=0;level<levels.length;level++){
  const mip=levels[level],rowPitch=level===0?pitch:mip.size*4;
  const length=block?Math.ceil(mip.size/4)**2*block:rowPitch*mip.size;
  if(offset+length>bytes.length)throw new Error('DDS_CUBE_TRUNCATED');
  let data=bytes.subarray(offset,offset+length);
  if(!block){
   const header=Buffer.from(bytes.subarray(0,128));header.writeUInt32LE(mip.size,12);header.writeUInt32LE(mip.size,16);
   header.writeUInt32LE(rowPitch,20);header.writeUInt32LE(1,28);header.writeUInt32LE(0,112);
   data=decodeDds(Buffer.concat([header,data])).rgba;
  }
  mip.faces.push(data.toString('base64'));offset+=length;
 }
 return {size:info.width,format,levels};
}
