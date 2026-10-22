import sharp from 'sharp';
/** Cheap review signal, not semantic or aesthetic acceptance. */
export async function assessNativeFrame(file:string){
 const {data,info}=await sharp(file,{limitInputPixels:64*1024*1024}).resize({width:128,height:128,fit:'inside',withoutEnlargement:true}).flatten({background:'#000'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 let dark=0,sum=0,squares=0;const pixels=info.width*info.height;
 for(let i=0;i<data.length;i+=info.channels){const r=data[i],g=info.channels>1?data[i+1]:r,b=info.channels>2?data[i+2]:r,l=(r+g+b)/3;if(Math.max(r,g,b)<=8)dark++;sum+=l;squares+=l*l;}
 const nearBlackRatio=dark/pixels,deviation=Math.sqrt(Math.max(0,squares/pixels-(sum/pixels)**2));
 return {status:nearBlackRatio>.95||deviation<1?'needs_review':'content_detected',nearBlackRatio:Number(nearBlackRatio.toFixed(4)),luminanceDeviation:Number(deviation.toFixed(3)),samplePixels:pixels,
  visualAcceptance:'not_checked',scope:'Sparse/flat image heuristic only. Dark scenes may be intentional; object identity, framing and rendering parity require review.'};
}
