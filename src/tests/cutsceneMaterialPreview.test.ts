import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {createMaterialPreviewAdapter} from '../modules/cutscenePreview/materialPreview.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {createGlobalLightingKernel} from '../modules/lighting/math.js';
import {rasterMaterials} from '../modules/cutscenePreview/materialRaster.js';
import sharp from 'sharp';
import type {MaterialLibrary,MaterialSampleOptions} from '../modules/cutscenePreview/materialRuntime.js';
import type {MaterialLayer,StandardMaterial,SurfaceMaterial,PreviewMesh} from '../modules/cutscenePreview/types.js';

const vendor=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href);
const nativeBuilder=await import(new URL('../../vendor/blizzard-models/dist/m3/native/builder/standard-material.js',import.meta.url).href);
const effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href);
const layer=(slot:string,texturePath:string|null=null):MaterialLayer=>({slot,texturePath,constantColor:{value:[.2,.4,.6,1]},uvSource:0,channels:0,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:true,wrapY:true});
const standard=(layers:Record<string,MaterialLayer>):StandardMaterial=>({layers,blendMode:0,priority:0,specularity:4,specMult:0,emisMult:1,specMode:0,alphaTestThreshold:0,twoSided:true,unshaded:false,doubleLambert:false,clampOutput:false,usesVertexColor:false,usesVertexAlpha:false});

test('native material importer derives energy from the raw flag and encoder helper preserves raw flags',async()=>{
    const source=await fs.readFile(new URL('../../vendor/blizzard-models/dist/m3/native/encoder.js',import.meta.url),'utf8');
    const helper=source.match(/function materialFlags\(material\) \{[\s\S]*?\n\}/)?.[0];assert.ok(helper);
    const constant=source.match(/const MAT_GEOMETRY_VISIBLE = ([0-9]+);/)?.[1];assert.ok(constant);
    // Execute the actual standalone helper; the complete encoder requires the
    // unbundled @modkit/codec-kit and is not represented as a roundtrip test.
    const encodeFlags=vm.runInNewContext('('+helper+')',{MAT_GEOMETRY_VISIBLE:Number(constant)}) as (m:{standard:StandardMaterial})=>number;
    const sections={getSectionByReference:()=>undefined};
    for(const flags of [0,0x800,0x80004800,0xffffffff]){
        const material=nativeBuilder.convertStandardMaterial(sections,{flags}) as StandardMaterial;
        assert.equal(material.sourceFlags,flags);assert.equal(material.specularEnergyConservation,!!(flags&0x800));
        assert.equal(encodeFlags({standard:{...material,specularEnergyConservation:!(flags&0x800)}}),flags);
    }
    for(const enabled of [true,false])assert.equal(!!(encodeFlags({standard:{...standard({}),specularEnergyConservation:enabled}})&0x800),enabled);
});
function hair(){return {...standard({diffuse:layer('diffuse','Assets/hair.dds'),alpha1:{...layer('alpha1','assets\\HAIR.dds'),channels:2}}),blendMode:1};}
function composite(base=standard({diffuse:layer('diffuse')}),texture='a.dds'):SurfaceMaterial{
    return {name:'platform',metadata:{sourceMaterialTag:'CMP_'},composite:{passes:[{material:base,alphaFactor:{value:1}},
        {material:{...standard({envi:layer('envi',texture),height:layer('height')}),parallaxHeight:{value:.05}},alphaFactor:{value:1}}]}};
}

test('named alpha-mask hair discards empty texels and writes opaque surviving coverage without altering source',()=>{
    const adapter=createMaterialPreviewAdapter(),source=hair(),before=JSON.stringify(source),cut=adapter.material(source,'NOV_Mesh_HairBangsOver3');
    assert.equal(cut.blendMode,0);assert.equal(cut.alphaTestThreshold,.3);
    const pass=vendor.createStandardMaterialPrograms({renderModel:{version:1,standard:cut}},{budget:{maxDepth:64,maxNodes:500000,maxBytes:16000000}})
        .sample({time:0,sequenceTime:0,sequenceIndex:0},{teamColor:[1,0,0],ambient:[1,1,1,0]})[0];
    assert.equal(pass.shade({texels:{diffuse:[.2,.4,.6,1],alpha1:[1,1,1,.1]}}).alphaTestPassed,false);
    assert.equal(pass.shade({texels:{diffuse:[.2,.4,.6,1],alpha1:[1,1,1,.8]}}).alphaTestPassed,true);
    assert.equal(JSON.stringify(source),before);assert.equal(adapter.material(source,'Hair01'),cut);
    assert.equal(adapter.material(source,'chair'),source,'shared source material does not make the chair hair');
});

test('hair policy preserves authored thresholds, alternate masks and ordinary transparency',()=>{
    const adapter=createMaterialPreviewAdapter();
    for(const source of [hair(),{...hair(),alphaTestThreshold:.125},{...hair(),twoSided:false},{...hair(),usesVertexAlpha:true},
        {...hair(),layers:{...hair().layers,alpha1:{...hair().layers.alpha1,channels:3}}},
        {...hair(),layers:{...hair().layers,alpha1:{...hair().layers.alpha1,texturePath:'normal.dds'}}}]){
        assert.equal(adapter.material(source,'chair'),source);
        if(source.alphaTestThreshold||!source.twoSided||source.usesVertexAlpha||source.layers.alpha1.channels!==2||source.layers.alpha1.texturePath==='normal.dds')assert.equal(adapter.material(source,'Hair'),source);
    }
});

test('composite preview keys by the complete surface and retains detail inputs and property ownership',()=>{
    const adapter=createMaterialPreviewAdapter(),base=standard({diffuse:layer('diffuse')}),a=composite(base),b=composite(base,'b.dds'),before=JSON.stringify([a,b]);
    const first=adapter.plan(a,base),second=adapter.plan(b,base);
    assert.ok(first.merged&&second.merged);assert.notEqual(first.merged,second.merged);
    assert.equal(first.merged.layers.envi.texturePath,'a.dds');assert.equal(second.merged.layers.envi.texturePath,'b.dds');
    assert.equal(first.merged.parallaxHeight?.value,.05);assert.equal(adapter.plan(a,base),first);
    const result=adapter.merge(first,[{alpha:1,properties:{parallaxHeight:0,'layers.diffuse.colorMultiply':2,'layers.envi.colorMultiply':9}},
        {alpha:1,properties:{parallaxHeight:.08,'layers.envi.colorMultiply':3,'layers.diffuse.colorMultiply':99,specMult:77}}])!;
    assert.equal(result.properties['layers.diffuse.colorMultiply'],2);assert.equal(result.properties['layers.envi.colorMultiply'],3);
    assert.equal(result.properties.parallaxHeight,.08);assert.equal(result.properties.specMult,undefined);
    assert.equal(JSON.stringify([a,b]),before);
});

test('composite policy keeps conflicts, unknown families, authored blending and animated pass fades separate',()=>{
    const adapter=createMaterialPreviewAdapter(),base=standard({diffuse:layer('diffuse')});
    const conflict=composite(standard({diffuse:layer('diffuse'),envi:layer('envi')})),wrong=composite(),blend=composite(),tracked=composite();
    wrong.metadata={sourceMaterialTag:'MAT_'};blend.composite!.passes[1].material.blendMode=3;
    tracked.composite!.passes[1].alphaFactor={value:1,sequenceTracks:[{sequenceIndex:0,keyframes:[{time:0,value:0},{time:1,value:1}]}]};
    for(const source of [conflict,wrong,blend,tracked])assert.equal(adapter.plan(source,base).merged,undefined);
    const plan=adapter.plan(composite(),base);
    for(const alpha of [0,.5,NaN])assert.equal(adapter.merge(plan,[{properties:{},alpha:1},{properties:{},alpha}]),undefined);
    assert.ok(adapter.merge(plan,[{properties:{},alpha:1},{properties:{},alpha:1}]));
});

function gpuFixture(surface:SurfaceMaterial,withBindings=true,prepare?:(mesh:PreviewMesh)=>void){
    const k=createPreviewKernel(),scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="a" modelPath="test.m3"><CCutsceneNodeAnimLayer><CCutsceneElementAnim anim="Body" duration="1000" priority="5"/><CCutsceneElementAnim anim="Face" duration="1000" priority="9"/></CCutsceneNodeAnimLayer></CCutsceneNodeActor><CCutsceneNodeTargetCamera guid="c" eyePositionY="-10" targetPositionY="0"/></CutsceneState>','material-preview');
    const mesh:PreviewMesh={positions:[-.5,0,0,.5,0,0,0,0,.5],indices:[0,1,2],weights:[],joints:[],bones:[],inverseBind:[],
        bounds:{min:[-.5,0,0],max:[.5,0,.5]},issues:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',
        materials:[surface],batches:[{start:0,count:3,material:0},{start:0,count:3,material:0}],
        clips:[{name:'Body',start:0,end:1000,sequenceIndex:0,tracks:{101:{times:[0,1000],values:[[1],[3]],quaternion:false},102:{times:[0,500,1000],values:[[1],[.5],[1]],quaternion:false}}},
            {name:'Face',start:0,end:1000,sequenceIndex:1,tracks:{}}],
        materialBindings:[{material:0,pass:1,path:['layers','envi','colorMultiply'],ref:{id:101,value:[1],interpolation:1}},
            {material:0,pass:1,path:['alphaFactor'],target:'passAlpha',ref:{id:102,value:[1],interpolation:1}}]};
    if(!withBindings)mesh.materialBindings=[];
    prepare?.(mesh);
    scene.models['test.m3']=mesh;
    const draws:Array<{depth:boolean;blend:boolean}>=[],samples:Array<{standard:StandardMaterial;options?:MaterialSampleOptions}>=[],uniforms=new Map<string,number[]>(),shaders:string[]=[];
    let programs=0,depth=true,blend=false;
    const gl=new Proxy({VERTEX_SHADER:1,FRAGMENT_SHADER:2,BLEND:9,MAX_TEXTURE_IMAGE_UNITS:16,MAX_FRAGMENT_UNIFORM_VECTORS:512,
        createProgram:()=>{programs++;return {};},shaderSource:(_shader:unknown,source:string)=>shaders.push(source),getUniformLocation:(_p:unknown,name:string)=>name,uniform4fv:(name:string,value:Float32Array)=>uniforms.set(name,Array.from(value)),uniform3fv:(name:string,value:Float32Array)=>uniforms.set(name,Array.from(value)),uniformMatrix4fv:(name:string,_transpose:boolean,value:Float32Array)=>uniforms.set(name,Array.from(value)),depthMask:(v:boolean)=>{depth=v;},enable:(v:number)=>{if(v===9)blend=true;},disable:(v:number)=>{if(v===9)blend=false;},drawElements:()=>draws.push({depth,blend})} as Record<string,unknown>,
        {get:(o,key:string)=>key in o?o[key]:(..._args:unknown[])=>{if(key==='getShaderParameter'||key==='getProgramParameter')return true;if(key==='getParameter')return 16;return {};}}) as unknown as WebGL2RenderingContext;
    const recording:MaterialLibrary={createStandardMaterialPrograms:(input,options)=>{
        const source=(input as {renderModel:{standard:StandardMaterial}}).renderModel.standard,sampler=vendor.createStandardMaterialPrograms(input,options);
        return {sample:(time,light,overrides)=>{samples.push({standard:source,options:overrides});return sampler.sample(time,light,overrides);}};
    }};
    return {scene,k,mesh,draws,samples,uniforms,shaders,programs:()=>programs,renderer:createGpuRenderer(gl,scene,k,effects,createEffectFrames,recording)};
}

test('native MAT bit11 enables specular energy correction even in older inverted imports; unknown families survive',()=>{
    const adapter=createMaterialPreviewAdapter(),browser=vm.runInNewContext('('+createMaterialPreviewAdapter.toString()+')()') as ReturnType<typeof createMaterialPreviewAdapter>;
    for(const flags of [0,0x800,0x80004800,0x80204800,0xffffffff]){
        const enabled=(flags&0x800)!==0,source={...standard({}),materialClass:0,sourceFlags:flags,specularEnergyConservation:!enabled},before=JSON.stringify(source);
        const corrected=adapter.material(source,'skin');assert.equal(corrected.specularEnergyConservation,enabled);
        assert.equal(adapter.material(source,'armor'),corrected);assert.equal(adapter.material(corrected,'armor'),corrected);
        assert.equal(browser.material(source,'skin').specularEnergyConservation,enabled);assert.equal(JSON.stringify(source),before);
    }
    for(const extra of [{},{materialClass:1,sourceFlags:0x800},{materialClass:0,sourceFlags:-1},{materialClass:0,sourceFlags:NaN},
        {materialClass:0,sourceFlags:2**32},{materialClass:0,sourceFlags:.5},{materialClass:0,sourceFlags:0x800,lightingModel:'pbr-metallic-roughness' as const}]){
        const source={...standard({}),specularEnergyConservation:false,...extra};assert.equal(adapter.material(source,'skin'),source);
    }
});

test('corrected native energy scales the analytic highlight with animated gloss, preserving diffuse',async()=>{
    const scene=parsePreviewScene('<CutsceneState/>','native-energy'),raster=await rasterMaterials(scene);
    for(const flags of [0,0x800])for(const gloss of [0,.25,.5,1]){
        const source={...standard({diffuse:layer('diffuse'),specular:{...layer('specular'),constantColor:{value:[1,1,1,1]}},
            gloss:{...layer('gloss'),channels:1,constantColor:{value:[gloss,gloss,gloss,gloss]}}}),
            materialClass:0,sourceFlags:flags,specularEnergyConservation:flags===0,specularity:512,specMult:3};
        // Use the production CPU preparation too; the analytic probe supplies a
        // unit aligned light/half vector and zero ambient, independently of cameras.
        const prepared=raster.prepare(source,0,0,[1,1,1],{propertyValues:{'layers.gloss.constantColor':[gloss,gloss,gloss,gloss]}});
        const pixel={normal:[0,0,1],lightDirection:[0,0,1],halfVector:[0,0,-1],sceneLighting:{ambientColor:[0,0,0],lightColor:[1,1,1]}};
        const result=prepared.pass.shade(pixel).rgba,p=Math.min(512,Math.max(1,512*gloss*gloss));
        const dim=flags?Math.max(0,Math.min(1,-.000004444*p*p+.004333*p+.0020834)):1;
        result.slice(0,3).forEach((v:number,i:number)=>assert.ok(Math.abs(v-([.2,.4,.6][i]+3*dim))<1e-8,`${flags}/${gloss}: ${result}`));
        assert.equal(prepared.pass.fragmentSource.includes('float specClamped ='),!!flags);
    }
});

test('GPU composite passes use native energy in both key and local specular paths',async()=>{
    const make=(flags:number)=>({...standard({specular:layer('specular')}),materialClass:0,sourceFlags:flags,specMult:3,specularEnergyConservation:flags===0});
    const a=make(0x800),b=make(0),surface:SurfaceMaterial={name:'skin',composite:{passes:[{material:a},{material:b}]}};
    const f=gpuFixture(surface,false),before=JSON.stringify(surface);await f.renderer.ready;
    f.renderer.draw(f.k.sample(f.scene,0,'director',undefined,false),320,200,'solid',undefined,false);
    assert.ok(f.samples.some(s=>s.standard.sourceFlags===0x800&&s.standard.specularEnergyConservation===true));
    assert.ok(f.samples.some(s=>s.standard.sourceFlags===0&&s.standard.specularEnergyConservation===false));
    const fragment=f.shaders.find(s=>s.includes('float specClamped =')&&s.includes('previewLocalLight'))!;
    assert.ok(fragment.includes('* u_specMult * specEnergy'));assert.ok(fragment.includes('specColor.rgb*u_specMult*specEnergy*previewLocalSpecular'));
    assert.equal(JSON.stringify(surface),before);
});

test('GPU merges eligible passes, samples detail M3A by property and restores both passes for animated alpha',async()=>{
    const f=gpuFixture(composite()),before=JSON.stringify(f.mesh.materials);await f.renderer.ready;const programs=f.programs();
    for(const time of [0,500,1000]){
        f.draws.length=0;const state=f.k.sample(f.scene,time,'director',undefined,false),stats=f.renderer.draw(state,320,200,'solid',undefined,false);
        assert.equal(stats.calls,time===500?4:2,'two batches use one merged pass or two authored passes');
        if(time===500){assert.equal(state.actors[0].clip?.name,'Face');
            const sampled=[...f.samples].reverse().find(s=>s.standard.layers.envi&&!s.standard.layers.diffuse&&s.options?.propertyValues?.['layers.envi.colorMultiply']===2);
            assert.ok(sampled,'lower-priority Body owns the detail property while Face owns the pose');
        }
    }
    assert.equal(f.programs(),programs,'merged and original variants are prepared before playback');assert.equal(JSON.stringify(f.mesh.materials),before);
});

test('GPU hair policy enters the opaque depth-writing pass and keeps actor fades blended',async()=>{
    const f=gpuFixture({name:'Hair',standard:hair()});f.mesh.materialBindings=[];await f.renderer.ready;
    let state=f.k.sample(f.scene,0,'director',undefined,false);f.renderer.draw(state,320,200,'solid',undefined,false);
    assert.ok(f.draws.every(d=>d.depth&&!d.blend));f.draws.length=0;
    state={...state,actors:state.actors.map(actor=>({...actor,opacity:.4}))};f.renderer.draw(state,320,200,'solid',undefined,false);
    assert.ok(f.draws.every(d=>!d.depth&&d.blend));
});

test('native environment programs use mapped world normals and upload camera eye without recompiling on seek',async()=>{
    const source={...standard({diffuse:layer('diffuse'),normal:layer('normal','normal.dds'),envi:{...layer('envi','reflection.dds'),uvSource:2}}),materialClass:0,sourceFlags:0};
    const f=gpuFixture({name:'armor',standard:source},false);await f.renderer.ready;const count=f.programs();
    for(const time of [0,500,1000]){
        f.renderer.draw(f.k.sample(f.scene,time,'director',undefined,false),320,200,'solid',undefined,false);
        assert.deepEqual(f.uniforms.get('u_previewEnvironmentEye'),[0,-10,0]);
    }
    assert.equal(f.programs(),count);
    const vertex=f.shaders.find(s=>s.includes('out vec3 v_previewEnvironmentIncident;'))!;
    const fragment=f.shaders.find(s=>s.includes('vec3 previewEnvironmentReflection()'))!;
    assert.ok(vertex.includes('normalize((u_model*vec4(previewPosition,1.)).xyz-u_previewEnvironmentEye)'));
    assert.ok(fragment.includes('normalize(mat3(v_previewWorldTangent,v_previewWorldBitangent,v_previewWorldNormal)*normal)'));
    assert.ok(fragment.includes('cubeUv(previewEnvironmentReflection())'));
    assert.ok(fragment.indexOf('g_previewEnvironmentNormal=(u_previewEnvironmentTransform*vec4(')<fragment.indexOf('vec3 color = vec3(0.0);'));
});

test('environment route is part of GPU program identity when native and unknown materials share a shader key',async()=>{
    const source={...standard({diffuse:layer('diffuse'),envi:{...layer('envi','reflection.dds'),uvSource:3}}),materialClass:0,sourceFlags:0};
    const surface:SurfaceMaterial={name:'mixed families',composite:{passes:[{material:source,alphaFactor:{value:1}},
        {material:{...source,materialClass:1},alphaFactor:{value:1}}]}};
    const f=gpuFixture(surface,false);await f.renderer.ready;
    const fragments=f.shaders.filter(s=>s.includes('sampleLayerTexel_envi()'));
    assert.ok(fragments.some(s=>s.includes('sphereUvDirection(previewEnvironmentReflection())')));
    assert.ok(fragments.some(s=>s.includes('sphereUvDirection(reflectionDirection())')));
    const count=f.programs();f.renderer.draw(f.k.sample(f.scene,0,'director',undefined,false),320,200,'solid',undefined,false);
    assert.equal(f.programs(),count);
});

test('GPU reflection matrix receives the lower-priority M3A property through seek without new programs',async()=>{
    const source={...standard({diffuse:layer('diffuse'),envi:{...layer('envi','reflection.dds'),uvSource:2,uvAngle:{value:[0,0,0]}}}),materialClass:0,sourceFlags:0};
    const f=gpuFixture({name:'animated reflection',standard:source},false,mesh=>{
        mesh.clips[0].tracks['101']={times:[0,1000],values:[[0,0,0],[0,0,Math.PI/2]],quaternion:false};
        mesh.materialBindings=[{material:0,pass:0,path:['layers','envi','uvAngle'],ref:{id:101,value:[0,0,0],interpolation:1}}];
    });
    await f.renderer.ready;const count=f.programs();
    for(const [time,angle]of [[500,Math.PI/4],[750,3*Math.PI/8],[0,0]]){
        const state=f.k.sample(f.scene,time,'director',undefined,false);f.renderer.draw(state,320,200,'solid',undefined,false);
        const matrix=f.uniforms.get('u_previewEnvironmentTransform')!;assert.equal(matrix.length,16);
        assert.ok(Math.abs(matrix[0]-Math.cos(angle))<1e-6,`${time}: ${matrix[0]}`);assert.ok(Math.abs(matrix[1]-Math.sin(angle))<1e-6);
        if(time===500)assert.equal(state.actors[0].clip?.name,'Face','facial pose does not replace the Body-owned UV property');
    }
    assert.equal(f.programs(),count);
});

test('material preview factory serializes without module globals',()=>{
    const adapter=vm.runInNewContext('('+createMaterialPreviewAdapter.toString()+')()') as ReturnType<typeof createMaterialPreviewAdapter>;
    assert.equal(adapter.material(hair(),'Hair').alphaTestThreshold,.3);
    const plan=adapter.plan(composite(),standard({}));assert.ok(adapter.merge(plan,[{alpha:1,properties:{}},{alpha:1,properties:{}}]));
});

test('software material sampling shares the named hair cutout while ordinary alpha remains soft',async()=>{
    const scene=parsePreviewScene('<CutsceneState/>','hair'),png=await sharp(Buffer.from([60,100,140,30]),{raw:{width:1,height:1,channels:4}}).png().toBuffer();
    scene.textures={'assets/hair.dds':{png:'data:image/png;base64,'+png.toString('base64'),width:1,height:1,format:'RGBA',sha256:'procedural-hair'}};
    const raster=await rasterMaterials(scene),source=hair(),cut=raster.prepare(source,0,0,[1,0,0],{},[1,0,0],'Hair'),plain=raster.prepare(source,0,0,[1,0,0],{},[1,0,0],'chair');
    const sample=(m:typeof cut)=>m.shade([[.5,.5]],[0,0,1],[0,0,0],[1,1,1,1],[0,0,10]);
    assert.equal(cut.blend,0);assert.deepEqual(sample(cut),[0,0,0,0]);assert.ok(sample(plain)[3]>0&&sample(plain)[3]<.3);
});

test('radial light fallback stays finite at equal/reversed endpoints and preserves ordinary squared attenuation',()=>{
    const math=createGlobalLightingKernel(),browser=vm.runInNewContext('('+createGlobalLightingKernel.toString()+')()') as ReturnType<typeof createGlobalLightingKernel>;
    const ordinary=math.pointParameters(2,10)!;assert.equal(ordinary.fallback,false);assert.equal(ordinary.multiplier,1.25);
    assert.equal(math.pointAttenuation(2,1/ordinary.range,ordinary.multiplier),1);assert.ok(Math.abs(math.pointAttenuation(6,1/ordinary.range,ordinary.multiplier)-.25)<1e-12);
    for(const [near,far]of [[10,10],[20,10],[0,0]]){
        const p=math.pointParameters(near,far)!;assert.equal(p.fallback,true);assert.equal(p.multiplier,1);
        assert.equal(math.pointAttenuation(p.range*.5,1/p.range,p.multiplier),.25);
        assert.equal(math.pointAttenuation(p.range,1/p.range,p.multiplier),0);
        assert.equal(JSON.stringify(browser.pointParameters(near,far)),JSON.stringify(p));
    }
    assert.equal(math.pointParameters(NaN,10),undefined);assert.equal(math.pointParameters(0,Infinity),undefined);
});

test('GPU uploads finite radial coefficients and reports fallback instead of extending an inverted light radius',async()=>{
    const f=gpuFixture({name:'base',standard:standard({diffuse:layer('diffuse')})});
    f.scene.lights=parsePreviewScene('<CutsceneState><CCutsceneNodeLight guid="point" type="1" attenuationStart="20" range="10"/></CutsceneState>','light').lights;
    await f.renderer.ready;const stats=f.renderer.draw(f.k.sample(f.scene,0,'director',undefined,false),320,200,'solid',undefined,false);
    assert.equal(stats.radialFallbacks,1);assert.equal(stats.skippedRadialLights,0);
    assert.equal(f.uniforms.get('u_previewLocalColor[0]')![3],10,'authored outer radius remains 10');
    assert.equal(f.uniforms.get('u_previewLocalOptions[0]')![0],1,'radial multiplier produces a squared fade over that radius');
});
