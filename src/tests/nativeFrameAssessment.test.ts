import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {assessNativeFrame} from '../integrations/native/frameAssessment.js';
test('native image content flags sparse and uniform frames without certifying a textured scene',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-frame-assessment-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'frame.png'),pixels=Buffer.alloc(128*128*3);
 pixels.fill(255,0,30);await sharp(pixels,{raw:{width:128,height:128,channels:3}}).png().toFile(file);
 assert.equal((await assessNativeFrame(file)).status,'needs_review');
 pixels.fill(255);await sharp(pixels,{raw:{width:128,height:128,channels:3}}).png().toFile(file);assert.equal((await assessNativeFrame(file)).status,'needs_review');
 for(let i=0;i<pixels.length;i++)pixels[i]=(i*73)%256;
 await sharp(pixels,{raw:{width:128,height:128,channels:3}}).png().toFile(file);
 const r=await assessNativeFrame(file);assert.equal(r.status,'content_detected');assert.equal(r.visualAcceptance,'not_checked');
});
