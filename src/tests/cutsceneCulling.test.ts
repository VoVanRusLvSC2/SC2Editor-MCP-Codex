import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {createFrustumCulling} from '../modules/cutscenePreview/culling.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import type {PreviewMesh} from '../modules/cutscenePreview/types.js';
test('animated bounds contain weighted vertices after rotation, nonuniform scale and translation',()=>{
 const k=createPreviewKernel(),c=createFrustumCulling(),positions=[1,2,3,-2,4,1,0,-1,2],weights=[.2,.8,0,0,.8,.2,0,0,0,0,0,0],joints=[0,1,0,0,0,1,0,0,0,0,0,0],mesh={positions,weights,joints,bounds:{min:[-2,-1,1],max:[1,4,3]}} as PreviewMesh;
 const skin=[k.trs([4,-2,3],k.euler([30,5,60]),[1,.3,2]),k.trs([-6,5,2],k.euler([2,90,10]),[2,3,.5])],world=k.trs([5,7,2],k.euler([20,70,45]),[3,.2,2]),b=c.bounds(mesh,skin,world)!;
 for(let i=0;i<3;i++){const v=positions.slice(i*3,i*3+3),p=[0,0,0];let total=0;for(let a=0;a<4;a++){const w=weights[i*4+a];if(w){const s=k.transform(skin[joints[i*4+a]],v);for(let n=0;n<3;n++)p[n]+=w*s[n];total+=w;}}const result=k.transform(world,total?p.map(n=>n/total):v);for(let n=0;n<3;n++)assert.ok(result[n]>=b.min[n]-1e-6&&result[n]<=b.max[n]+1e-6);}
});
test('frustum rejection keeps intersecting bounds and fails open for unresolved matrices',()=>{const k=createPreviewKernel(),c=createFrustumCulling();assert.equal(c.visible({min:[2,2,2],max:[3,3,3]},k.identity()),false);assert.equal(c.visible({min:[-.1,-.1,-.1],max:[3,3,3]},k.identity()),true);assert.equal(c.visible(undefined,k.identity()),true);});
test('browser culling factory is standalone and uses the same plane tests',()=>{const browser=vm.runInNewContext('('+createFrustumCulling.toString()+')()'),k=createPreviewKernel();assert.equal(browser.visible({min:[5,0,0],max:[6,1,1]},k.identity()),false);});
