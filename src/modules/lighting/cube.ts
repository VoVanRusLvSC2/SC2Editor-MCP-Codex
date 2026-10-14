import {createHash} from 'node:crypto';
import {decodePreviewDds} from '../assets/cubeTexture.js';
import type {GlobalLighting} from './types.js';
/** Retain native cube texels: lighting.fx samples the cube at the surface normal. */
export function decodeAmbientCube(bytes:Buffer):NonNullable<GlobalLighting['environmentCube']>{
 if(bytes.length<128)throw new Error('LIGHTING_ENVIRONMENT_DDS_TRUNCATED');
 if(!(bytes.readUInt32LE(112)&0x200))throw new Error('LIGHTING_ENVIRONMENT_REQUIRES_CUBE');
 const image=decodePreviewDds(bytes),sourceSize=image.width/4;
 if(image.height!==sourceSize*3||sourceSize>512)throw new Error('LIGHTING_ENVIRONMENT_CUBE_BUDGET');
 const size=Math.min(128,sourceSize),cells=[[2,1],[0,1],[1,2],[1,0],[1,1],[3,1]];
 const faces=cells.map(([cx,cy])=>{
  const rgba=Buffer.alloc(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const sx=Math.min(sourceSize-1,Math.floor((x+.5)*sourceSize/size)),sy=Math.min(sourceSize-1,Math.floor((y+.5)*sourceSize/size));
   image.rgba.copy(rgba,(y*size+x)*4,((cy*sourceSize+sy)*image.width+cx*sourceSize+sx)*4,((cy*sourceSize+sy)*image.width+cx*sourceSize+sx)*4+4);
  }return rgba.toString('base64');
 });
 return {size,faces,sha256:createHash('sha256').update(bytes).digest('hex')};
}
