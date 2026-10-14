import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {createMaterialTextureAdapter} from '../modules/cutscenePreview/materialTextures.js';
const textures=[{resourceId:'rtt://0',uniform:'u_picture',wrapU:'clamp',wrapV:'clamp'},{resourceId:'Assets/mask.dds',uniform:'u_mask',wrapU:'clamp',wrapV:'clamp'}];
test('RTT origin conversion changes only RTT samples after their authored UV expressions',()=>{
 const input='precision highp float;uniform sampler2D u_picture;uniform sampler2D u_mask;void main(){vec2 p=uv*tiling+offset;vec4 a=texture(u_picture,p);vec4 b=texture(u_mask,p);}';
 const result=createMaterialTextureAdapter().fragment(input,textures);
 assert.ok(result.includes('previewRtt_texture_u_picture(p)'));assert.ok(result.includes('vec2(p.x,1.-p.y)'));assert.ok(result.includes('texture(u_mask,p)'));assert.ok(result.includes('vec2 p=uv*tiling+offset;'));
 assert.equal(createMaterialTextureAdapter().fragment(input,textures.slice(1)),input);
});
test('RTT mip gradients change their V derivatives and the adapter is standalone',()=>{
 const input='uniform highp sampler2D u_picture;void main(){textureLod(u_picture,p,2.);textureGrad(u_picture,p,dx,dy);}';
 const adapter=vm.runInNewContext('('+createMaterialTextureAdapter.toString()+')()'),result=adapter.fragment(input,textures);
 assert.equal(result,createMaterialTextureAdapter().fragment(input,textures));assert.ok(result.includes('vec2(dx.x,-dx.y),vec2(dy.x,-dy.y)'));assert.ok(result.includes('previewRtt_textureLod_u_picture(p,2.)'));
 assert.throws(()=>adapter.fragment(input,[{...textures[0],uniform:'bad.name'}]),/SAMPLER_NAME/);
});
