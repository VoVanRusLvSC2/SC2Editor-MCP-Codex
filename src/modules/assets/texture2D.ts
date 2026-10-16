import {decodeDds,inspectDds} from './dds.js';
import type {PreviewTexture2D} from '../cutscenePreview/types.js';

/** Preserve legacy DDS 2D BC1/2/3 blocks or mask-decoded RGB32 rows.
 * Validate the whole source chain, including levels skipped for the preview
 * budget. No mip generation, row flip, nearest-neighbour resize or source write.
 * RGB24 lower-level row alignment and DX10/volume/array layouts are unqualified.
 */
export function packPreviewTexture2D(bytes:Buffer,maxSize=8192):PreviewTexture2D{
 const info=inspectDds(bytes);
 if(info.caps2!==0||info.depth>1)throw new Error('DDS_2D_REQUIRED');
 if(!Number.isInteger(maxSize)||maxSize<1||maxSize>8192)throw new Error('DDS_2D_SIZE_BUDGET');
 if(info.mipmaps>1+Math.floor(Math.log2(Math.max(info.width,info.height))))throw new Error('DDS_2D_MIPMAPS_UNSUPPORTED');
 const rgb32=info.format==='RGB32'&&!!(bytes.readUInt32LE(80)&64);
 const format=info.format==='DXT1'?'bc1':info.format==='DXT3'?'bc2':info.format==='DXT5'?'bc3':rgb32?'rgba8':undefined;
 if(!format)throw new Error('DDS_2D_FORMAT_UNSUPPORTED');
 const block=format==='bc1'?8:format==='rgba8'?0:16;
 const pitch=(bytes.readUInt32LE(8)&8)?bytes.readUInt32LE(20):info.width*4;
 if(!block&&pitch<info.width*4)throw new Error('DDS_2D_TRUNCATED');
 const levels:PreviewTexture2D['levels']=[];
 let offset=128,firstMip=-1,pixels=0,encodedBytes=0;
 for(let mip=0;mip<info.mipmaps;mip++){
  const width=Math.max(1,info.width>>mip),height=Math.max(1,info.height>>mip),rowPitch=mip===0?pitch:width*4;
  const length=block?Math.ceil(width/4)*Math.ceil(height/4)*block:rowPitch*height;
  if(offset+length>bytes.length)throw new Error('DDS_2D_TRUNCATED');
  if(Math.max(width,height)<=maxSize){
   if(firstMip<0)firstMip=mip;
   pixels+=width*height;
   if(pixels*4>128*1024*1024)throw new Error('DDS_2D_PIXEL_BUDGET');
   let data=bytes.subarray(offset,offset+length);
   if(!block){
    const header=Buffer.from(bytes.subarray(0,128));
    header.writeUInt32LE(height,12);header.writeUInt32LE(width,16);header.writeUInt32LE(rowPitch,20);header.writeUInt32LE(1,28);
    data=decodeDds(Buffer.concat([header,data])).rgba;
   }
   encodedBytes+=data.length;
   if(encodedBytes>128*1024*1024)throw new Error('DDS_2D_BYTE_BUDGET');
   levels.push({width,height,data:data.toString('base64')});
  }
  offset+=length;
 }
 if(!levels.length)throw new Error('DDS_2D_MIP_SIZE_UNAVAILABLE');
 return {sourceWidth:info.width,sourceHeight:info.height,firstMip,width:levels[0].width,height:levels[0].height,format,levels};
}
