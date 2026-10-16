import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createMaterialTextureAdapter} from '../modules/cutscenePreview/materialTextures.js';
import type {MaterialLayer,StandardMaterial} from '../modules/cutscenePreview/types.js';
const vendor=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href);
const layer=(slot:string,uvSource:number):MaterialLayer=>({slot,texturePath:slot+'.dds',uvSource,channels:0,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:true,wrapY:true});
const standard=(uvSource:number):StandardMaterial=>({materialClass:0,sourceFlags:0,layers:{diffuse:layer('diffuse',0),normal:layer('normal',0),envi:layer('envi',uvSource)},blendMode:0,priority:0,specularity:4,specMult:1,emisMult:0,specMode:0,clampOutput:false,doubleLambert:false,alphaTestThreshold:0,twoSided:false,unshaded:false,usesVertexAlpha:false,usesVertexColor:false});
function sample(m:StandardMaterial){return vendor.createStandardMaterialPrograms({renderModel:{version:1,standard:m}},{budget:{maxDepth:64,maxNodes:500000,maxBytes:16000000}}).sample({time:0,sequenceTime:0,sequenceIndex:0},{teamColor:[1,0,0],ambient:[1,1,1,0],sceneLighting:true})[0];}

test('environment projections use decoded world normals alongside native explicit UVs and intact source materials',()=>{
 const adapter=createMaterialTextureAdapter();
 for(const uv of [2,3,7,8]){
  const material=standard(uv),before=JSON.stringify(material),pass=sample(material),output=adapter.fragment(pass.fragmentSource,pass.textures,material);
  assert.notEqual(output,pass.fragmentSource);assert.equal(JSON.stringify(material),before);
  assert.ok(output.includes('mat3(v_previewWorldTangent,v_previewWorldBitangent,v_previewWorldNormal)*normal'));
  assert.ok(output.includes(uv===2||uv===3?'previewEnvironmentReflection())':uv===7?'cubeUv(g_previewEnvironmentNormal)':'g_previewEnvironmentNormal.xz*vec2(0.5,-0.5)+0.5'));
  assert.ok(output.includes('return texture(u_diffuseMap, previewNativeUv_diffuse());'));
 }
 for(const uv of [0,1,4,5,6,9,10,11]){
  const m=standard(uv),p=sample(m),out=adapter.fragment(p.fragmentSource,p.textures,m);
  assert.ok(!out.includes('vec3 previewEnvironmentReflection()'),'non-environment UVs do not acquire the environment stage');
  assert.ok(out.includes('return texture(u_diffuseMap, previewNativeUv_diffuse());'));
  assert.ok(out.includes('previewNativeUv_normal()'),'ordinary native normal coordinates have their independent transform');
 }
});

test('environment stage consumes sampled transforms before projection and excludes RTT, PBR and unknown native families',()=>{
 const adapter=createMaterialTextureAdapter(),m=standard(2);m.layers.envi.uvAngle={value:[0,0,1]};m.layers.envi.uvTiling={value:[2,3]};
 const p=sample(m),out=adapter.fragment(p.fragmentSource,p.textures,m);
 assert.ok(out.includes('u_enviUvAngle'));assert.ok(out.includes('u_enviUvTiling'));
 const body=out.match(/vec4 sampleLayerTexel_envi\(\) \{[^}]*\}/)![0];
 assert.ok(!body.includes('rotateUv')&&!body.includes('g_parallaxOffset'));
 assert.ok(out.includes('u_previewEnvironmentTransform*vec4(v_previewEnvironmentIncident,1.)'));
 for(const extra of [{materialClass:1},{materialClass:undefined},{sourceFlags:undefined},{sourceFlags:-1},{sourceFlags:2**32},{lightingModel:'pbr-metallic-roughness' as const}]){
  assert.equal(adapter.fragment(p.fragmentSource,p.textures,{...m,...extra}),p.fragmentSource);
 }
 const rtt={...m,layers:{...m.layers,envi:{...m.layers.envi,texturePath:'rtt://0'}}};assert.equal(adapter.environmentEnabled(rtt),false);
});

test('serialized texture adapter retains independent environment stage and checks required shader anchors',()=>{
 const a=vm.runInNewContext('('+createMaterialTextureAdapter.toString()+')()') as ReturnType<typeof createMaterialTextureAdapter>,m=standard(3),p=sample(m);
 assert.equal(a.fragment(p.fragmentSource,p.textures,m),createMaterialTextureAdapter().fragment(p.fragmentSource,p.textures,m));
 assert.throws(()=>a.fragment(p.fragmentSource.replace('  vec3 color = vec3(0.0);',''),p.textures,m),/ENVIRONMENT_NORMAL_STAGE/);
 const world=p.fragmentSource.replaceAll('dot(normal, v_lightDir)','dot(normal, u_sceneLightDirection)');
 assert.ok(a.fragment(world,p.textures,m).includes('g_previewEnvironmentNormal=(u_previewEnvironmentTransform*vec4(normalize(normal),1.)).xyz;'));
});

test('ordinary environment matrix matches a native x64 replay with offset and all three rotations',()=>{
 const adapter=createMaterialTextureAdapter(),m=standard(2),source=sample(m),p={...source,uniforms:{...source.uniforms}};
 // Recorded from the bounded native141df8e60 replay, case5; coefficients are
 // independent of this implementation and include translation of w=1 normals.
 p.uniforms.u_enviUvOffset=[.6306060552597046,-.9977399706840515];
 p.uniforms.u_enviUvAngle=[-3.8427987098693848,-.607255220413208,.4414485991001129];
 p.uniforms.u_enviUvTiling=[2.855670213699341,2.051250457763672];
 const native=[2.120307207107544,.7197116017341614,.5706155300140381,0,-.018245961517095566,-1.7396626472473145,.5297998189926147,0,1.912803292274475,-.8143815398216248,-.6274631023406982,0,-1.3552831411361694,-2.1895854473114014,.16876888275146484,1];
 const before=JSON.stringify(p.uniforms),matrix=adapter.environmentMatrix(p,m)!;
 matrix.forEach((v,i)=>assert.ok(Math.abs(v-native[i])<1e-6,`${i}: ${v} vs ${native[i]}`));
 assert.equal(JSON.stringify(p.uniforms),before);
 const browser=vm.runInNewContext('('+createMaterialTextureAdapter.toString()+')()') as typeof adapter;
 assert.deepEqual(Array.from(browser.environmentMatrix(p,m)!),matrix);
});

test('matrix sampling uses animated property overrides and preserves native scale before spherical mapping',()=>{
 const adapter=createMaterialTextureAdapter(),m=standard(8);m.layers.envi.uvTiling={value:[.5,1]};
 const source=sample(m),p={...source,uniforms:{...source.uniforms}},matrix=adapter.environmentMatrix(p,m)!;
 assert.deepEqual(matrix.filter(v=>v!==0),[.5,1,1,1]);
 const transformedX=matrix[0],nativeSphericalU=transformedX*.5+.5;
 assert.equal(nativeSphericalU,.75,'scaled normal is not renormalized before native non-reflecting sphere projection');
 p.uniforms.u_enviUvAngle=[0,0,Math.PI/2];
 const rotated=adapter.environmentMatrix(p,m)!;
 assert.ok(Math.abs(rotated[0])<1e-6);assert.ok(Math.abs(rotated[1]-1)<1e-6);assert.ok(Math.abs(rotated[4]+.5)<1e-6);
 for(const invalid of [[NaN,0],[Infinity,1],[1],3]){
  p.uniforms.u_enviUvTiling=invalid;assert.throws(()=>adapter.environmentMatrix(p,m),/ENVIRONMENT_MATRIX_VALUE/);
 }
 p.uniforms.u_enviUvTiling=[3e38,3e38];p.uniforms.u_enviUvOffset=[3e38,3e38];
 assert.throws(()=>adapter.environmentMatrix(p,m),/ENVIRONMENT_MATRIX_RANGE/);
});

test('multiple environment owners and flipbooks retain previous routing instead of inventing independent matrices',()=>{
 const adapter=createMaterialTextureAdapter(),m=standard(2);m.layers.enviMask=layer('enviMask',8);m.layers.envi.uvAngle={value:[0,0,1]};
 const p=sample(m),out=adapter.fragment(p.fragmentSource,p.textures,m);
 assert.equal(adapter.environmentMatrixOwner(m),undefined);assert.equal(adapter.environmentMatrix(p,m),null);
 assert.ok(!out.includes('uniform mat4 u_previewEnvironmentTransform;'));assert.ok(out.includes('rotateUv(cubeUv(previewEnvironmentReflection())'));
 delete m.layers.enviMask;m.layers.envi.flipbook={rows:2,cols:2,frame:{value:0}};
 assert.equal(adapter.environmentMatrixOwner(m),undefined);
 m.layers.envi.flipbook=undefined;m.layers.diffuse={...layer('diffuse',7),texturePath:null,constantColor:{value:[1,1,1,1]}};
 assert.equal(adapter.environmentMatrixOwner(m),undefined,'constant layers also participate in native descriptor ownership');
});
