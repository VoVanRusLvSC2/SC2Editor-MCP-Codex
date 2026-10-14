import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {promises as fs} from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
/** Optional installed FFmpeg converts native Theora into bounded browser WebM. No download. */
export async function prepareCutsceneVideo(bytes:Buffer,cacheRoot:string){
 if(bytes.length<4||bytes.length>32*1024*1024||bytes.toString('ascii',0,4)!=='OggS')throw new Error('CUTSCENE_VIDEO_HEADER');
 const key=digest(bytes)+'-vp9-512-24-60-v1';await fs.mkdir(cacheRoot,{recursive:true});const output=path.join(cacheRoot,key+'.webm'),metadata=output+'.json';
 try{const b=await fs.readFile(output),info=JSON.parse(await fs.readFile(metadata,'utf8'));if(b.length<=8*1024*1024&&digest(b)===info.sha256)return {bytes:b,format:'webm',maxSeconds:60};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
 const input=path.join(cacheRoot,randomUUID()+'.ogv'),temp=path.join(cacheRoot,randomUUID()+'.webm');await fs.writeFile(input,bytes,{flag:'wx'});
 try{await promisify(execFile)('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-i',input,'-t','60','-an','-vf','scale=512:512:force_original_aspect_ratio=decrease','-r','24','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-threads','2','-b:v','500k','-f','webm',temp],{windowsHide:true,timeout:45000,maxBuffer:1024*1024});const b=await fs.readFile(temp);if(b.length>8*1024*1024)throw new Error('CUTSCENE_VIDEO_OUTPUT_BUDGET');await fs.rename(temp,output);await fs.writeFile(metadata,JSON.stringify({sourceSha256:digest(bytes),sha256:digest(b),maxSeconds:60}));return {bytes:b,format:'webm',maxSeconds:60};}finally{await fs.unlink(input).catch(()=>{});await fs.unlink(temp).catch(()=>{});}
}
