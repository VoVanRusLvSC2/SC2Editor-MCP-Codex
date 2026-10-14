import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
import type {PreviewMesh,AnimRef,AnimTrack} from '../modules/cutscenePreview/types.js';

test('animation bundle metadata remains actor scoped and preserves native sequence identifiers',()=>{
 const scene=parsePreviewScene(`<CutsceneState>
    <CCutsceneNodeActor guid="100" name="First" modelPath="base.m3">
        <CCutsceneNodeM3A guid="101" filePath="extra.m3a"/>
        <CCutsceneNodeFolder guid="102" enabled="0">
            <CCutsceneNodeM3A guid="103" filePath="disabled.m3a"/>
        </CCutsceneNodeFolder>
        <CCutsceneNodeAnimLayer guid="104">
            <CCutsceneElementAnim guid="105" duration="1000" anim="Stand" animId="4294967295" sourceBundleGuid="101"/>
        </CCutsceneNodeAnimLayer>
        <CCutsceneNodeActor guid="200" name="Second" modelPath="other.m3">
            <CCutsceneNodeM3A guid="201" filePath="other.m3a"/>
        </CCutsceneNodeActor>
    </CCutsceneNodeActor>
 </CutsceneState>`,'bundle-metadata',{ticksPerSecond:1000});
 assert.deepEqual(scene.actors[0].animationBundles,[
  {file:'extra.m3a',guid:'101',enabled:true},
  {file:'disabled.m3a',guid:'103',enabled:false},
 ]);
 assert.deepEqual(scene.actors[1].animationBundles,[{file:'other.m3a',guid:'201',enabled:true}]);
 assert.equal(scene.actors[0].clips[0].nativeAnimId,'4294967295');
 assert.equal(scene.actors[0].clips[0].sourceBundleGuid,'101');
});

test('camera FOV axis follows constructor zero and explicit native flags without inventing optical defaults',()=>{
 const scene=parsePreviewScene(`<CutsceneState>
    <CCutsceneNodeTargetCamera guid="1" fov="40" nearClip="0.1" farClip="600"/>
    <CCutsceneNodeTargetCamera guid="2" verticalFOV="1" fov="40" nearClip="0.1" farClip="600"/>
    <CCutsceneNodeTargetCamera guid="3" verticalFOV="false" fov="40" nearClip="0.1" farClip="600"/>
    <CCutsceneNodeTargetCamera guid="4" verticalFOV="true"/>
 </CutsceneState>`,'camera-axis');
 assert.deepEqual(scene.cameras.map(c=>c.vertical),[false,true,false,true]);
 assert.equal(scene.cameras[0].fov,40);
 assert.equal(scene.cameras[0].near,.1);
 assert.equal(scene.cameras[0].far,600);
 assert.deepEqual(scene.issues.filter(i=>i.code==='CAMERA_NUMERIC_DEFAULT_APPROXIMATE').map(i=>i.object),['4']);
});

test('Diffuse and emissive team colors keep distinct authored values and per-channel curves',()=>{
 const scene=parsePreviewScene(`<CutsceneState><CCutsceneNodeActor guid="1" teamColorDiffuse=".7,.1,.2,1" teamColorEmissive=".5,.06,.08,1" teamColorEmissiveGreen="0"><CCutsceneNodePropertyValue propertyName="teamColorEmissiveRed"><CCutsceneElementPropertyCurve time="0" value=".5"/><CCutsceneElementPropertyCurve time="1000" value="1"/></CCutsceneNodePropertyValue><CCutsceneNodePropertyValue propertyName="teamColorDiffuseBlue"><CCutsceneElementPropertyCurve time="0" value=".2"/><CCutsceneElementPropertyCurve time="1000" value=".6"/></CCutsceneNodePropertyValue></CCutsceneNodeActor><CCutsceneNodeActor guid="2" teamColorDiffuseRed="0"/></CutsceneState>`,'team-colors');
 const kernel=createPreviewKernel(),state=kernel.sample(scene,500);
 assert.deepEqual(scene.actors[0].teamColorEmissive,[.5,0,.08,1]);
 assert.deepEqual(state.actors[0].teamColorEmissive,[.75,0,.08]);assert.equal(state.actors[0].teamColorDiffuse[0],.7);assert.ok(Math.abs(state.actors[0].teamColorDiffuse[2]-.4)<1e-12);
 assert.deepEqual(state.actors[1].teamColorEmissive,state.actors[1].teamColorDiffuse);assert.equal(state.actors[1].teamColorEmissive[0],0);
 assert.ok(!scene.issues.some(i=>i.code==='CURVE_PROPERTY_UNSUPPORTED'));
});

test('Embedded camera and light properties use all active animation layers despite a higher-priority facial clip',()=>{
 const scene=parsePreviewScene(`<CutsceneState><CCutsceneNodeActor guid="1" modelPath="base.m3"><CCutsceneNodeAnimLayer><CCutsceneElementAnim anim="Body" start="0" duration="1000" priority="5"/><CCutsceneElementAnim anim="Face" start="0" duration="1000" priority="9"/></CCutsceneNodeAnimLayer></CCutsceneNodeActor></CutsceneState>`,'embedded-properties');
 const ref=(id:number,value:number):AnimRef=>({id,interpolation:1,value:[value]}),track=(from:number,to:number):AnimTrack=>({times:[0,1000],values:[[from],[to]],quaternion:false}),fov=ref(1,.5),focus=ref(2,4),intensity=ref(3,1);
 const mesh:PreviewMesh={positions:[],indices:[],weights:[],joints:[],bones:[],inverseBind:[],bounds:{min:[0,0,0],max:[1,1,1]},issues:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',clips:[{name:'Body',start:0,end:1000,tracks:{1:track(.5,1.5),2:track(4,8),3:track(1,3)}},{name:'Face',start:0,end:1000,tracks:{99:track(0,1)}}],modelCameras:[{index:0,name:'Camera',boneIndex:0,fieldOfView:.5,nearClip:.1,farClip:600,useVerticalFov:false,focalDepth:4,fStop:2,maxCoC:7,depthOfField:1,animated:{fieldOfView:{value:.5,ref:fov},focalDepth:{value:4,ref:focus}}}],modelLights:[{index:0,name:'Key',boneIndex:0,type:0,flags:24,color:[1,1,1],intensity:1,specularColor:[0,0,0],specularIntensity:0,attenuationNear:0,attenuationFar:10,hotspot:0,falloff:0,animated:{intensity:{value:1,ref:intensity}}}]};
 scene.models['base.m3']=mesh;const kernel=createPreviewKernel(),environment=createEnvironmentKernel(kernel),state=kernel.sample(scene,500),camera=environment.camera(scene,state,'1',0);
 assert.equal(state.actors[0].clip?.name,'Face');assert.ok(Math.abs(camera!.fov-180/Math.PI)<1e-12);assert.deepEqual(camera?.optics,{focalDepth:6,fstop:2,maxcoc:7,depthOfField:1});assert.equal(camera?.vertical,false);assert.deepEqual(environment.lights(scene,state)[0].color,[2,2,2]);assert.equal(mesh.modelCameras?.[0].animated?.focalDepth.ref?.id,2);
});

test('Native numeric tangent Step and Linear bypass cached handles while Custom preserves them',()=>{
 const source=`<CutsceneState><CCutsceneNodeActor guid="1"><CCutsceneNodePropertyValue propertyName="positionX"><CCutsceneElementPropertyCurve time="32711" value="-0.170731" curveOutType="6" curveOutValue="34313,-0.196140"/><CCutsceneElementPropertyCurve time="37517" value="-0.246960" curveInType="6" curveInValue="144507,-0.283873"/></CCutsceneNodePropertyValue><CCutsceneNodePropertyValue propertyName="positionY"><CCutsceneElementPropertyCurve time="0" value="0" curveOutType="3" curveOutValue="10,100"/><CCutsceneElementPropertyCurve time="1000" value="10" curveInType="3" curveInValue="20,-100"/></CCutsceneNodePropertyValue><CCutsceneNodePropertyValue propertyName="positionZ"><CCutsceneElementPropertyCurve time="0" value="0" curveOutType="0" curveOutValue="333.333333,0"/><CCutsceneElementPropertyCurve time="1000" value="1" curveInType="0" curveInValue="666.666667,0"/></CCutsceneNodePropertyValue></CCutsceneNodeActor></CutsceneState>`,scene=parsePreviewScene(source,'native-tangent-modes'),kernel=createPreviewKernel(),curves=scene.actors[0].curves;
 assert.deepEqual(curves.map(c=>c.keys[0].mode),['step','linear','bezier']);assert.equal(curves[0].keys[0].tangentOutType,'6');assert.equal(curves[0].keys[1].incoming?.[0],144507);
 assert.equal(kernel.curve(curves[0],35317),-.170731);assert.equal(kernel.curve(curves[0],37517),-.246960);assert.equal(kernel.curve(curves[1],500),5);assert.ok(Math.abs(kernel.curve(curves[2],500)!-.125)<.00001);
 assert.ok(!scene.issues.some(i=>i.code==='CURVE_MODE_UNVERIFIED'||i.code==='NATIVE_TANGENT_HANDLES_USED'));
});

test('Native Palace unordered authored clips normalize with the eye-target distance and retain source values',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeTargetCamera guid="1" fov="40" nearClip="1.000000" farClip="0.193800" eyePositionX="-6.669839" eyePositionY="69.056725" eyePositionZ="1.675049" targetPositionX="-8.628010" targetPositionY="161.827835" targetPositionZ="12.818950"/></CutsceneState>','native-palace-clips');
 const camera=scene.cameras[0],distance=Math.hypot(...camera.target.map((v,i)=>v-camera.eye[i]));assert.ok(Math.abs(camera.near-.1928)<1e-9);assert.equal(camera.far,distance);assert.equal(camera.clipRangeApproximate,false);assert.equal(camera.authoredOptics?.nearClip,1);assert.equal(camera.authoredOptics?.farClip,.1938);assert.equal(camera.authoredOptics?.fovUnit,'degrees');assert.ok(scene.issues.some(i=>i.code==='CAMERA_NATIVE_CLIP_NORMALIZED'));
});

test('Embedded CAM invalid range uses the same preview fallback after native channel sampling and retains radians',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="1" modelPath="camera.m3"><CCutsceneNodeAnimLayer><CCutsceneElementAnim anim="Camera" start="0" duration="1000"/></CCutsceneNodeAnimLayer></CCutsceneNodeActor></CutsceneState>','embedded-clip-range'),ref:AnimRef={id:6,interpolation:1,value:[.1938]};
 const mesh:PreviewMesh={positions:[],indices:[],weights:[],joints:[],bones:[],inverseBind:[],bounds:{min:[0,0,0],max:[1,1,1]},issues:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',clips:[{name:'Camera',start:0,end:1000,tracks:{6:{times:[0,1000],values:[[.1938],[20]],quaternion:false}}}],modelCameras:[{index:0,name:'Camera',boneIndex:0,fieldOfView:.5,nearClip:1,farClip:.1938,useVerticalFov:false,animated:{farClip:{value:.1938,ref}}}]};
 scene.models['camera.m3']=mesh;const kernel=createPreviewKernel(),environment=createEnvironmentKernel(kernel),start=environment.camera(scene,kernel.sample(scene,0),'1',0)!,middle=environment.camera(scene,kernel.sample(scene,500),'1',0)!;
 assert.ok(Math.abs(start.near-.1928)<1e-9);assert.equal(start.far,10000);assert.equal(start.clipRangeApproximate,true);assert.equal(start.authoredOptics?.farClip,.1938);assert.equal(start.authoredOptics?.fov,.5);assert.equal(start.authoredOptics?.fovUnit,'radians');
 assert.equal(middle.clipRangeApproximate,false);assert.equal(middle.far,10.0969);assert.equal(middle.authoredOptics?.farClip,10.0969);assert.equal(mesh.modelCameras?.[0].farClip,.1938);
});

test('Recovered clip min/max formula accepts an explicit native minimum and marks unresolved preview guards',()=>{
 const kernel=createPreviewKernel(),native=kernel.cameraClips(1,.1938,300),preview=kernel.cameraClips(1,.1938),valid=kernel.cameraClips(.1,600,1000),zero=kernel.cameraClips(.1,0,300);
 assert.ok(Math.abs(native.near-.1928)<1e-9);assert.equal(native.far,300);assert.equal(native.clipRangeApproximate,false);
 assert.equal(preview.far,10000);assert.equal(preview.clipRangeApproximate,true);assert.equal(valid.near,.1);assert.equal(valid.far,1000);assert.equal(zero.near,.001);assert.equal(zero.clipRangeApproximate,true);
});

test('Direct Target camera recomputes the native minimum far distance after animated pose while Game uses distance',()=>{
 const scene=parsePreviewScene(`<CutsceneState><CCutsceneNodeTargetCamera guid="1" fov="40" nearClip="1" farClip=".1938" eyePositionX="0" eyePositionY="0" eyePositionZ="0" targetPositionX="0" targetPositionY="10" targetPositionZ="0"><CCutsceneNodePropertyValue propertyName="targetPositionY"><CCutsceneElementPropertyCurve time="0" value="10" curveOutType="3"/><CCutsceneElementPropertyCurve time="1000" value="30" curveInType="3"/></CCutsceneNodePropertyValue></CCutsceneNodeTargetCamera><CCutsceneNodeCamera guid="2" fov="40" nearClip="1" farClip=".1938" distance="15"/></CutsceneState>`,'native-camera-distance'),kernel=createPreviewKernel();
 assert.equal(scene.cameras[0].far,10);assert.equal(kernel.cameraAt(scene.cameras[0],500).far,20);assert.ok(Math.abs(kernel.cameraAt(scene.cameras[0],500).near-.1928)<1e-9);assert.equal(kernel.cameraAt(scene.cameras[0],500).authoredOptics?.farClip,.1938);assert.equal(kernel.cameraAt(scene.cameras[1],0).far,15);
});

test('incoming Linear tangent is independent of the next key outgoing Custom tangent',()=>{const curve={property:'fov',keys:[{time:0,value:0,mode:'bezier' as const,tangentOutType:'0',outgoing:[1000/3,0]},{time:1000,value:10,mode:'bezier' as const,tangentInType:'3',tangentOutType:'0',incoming:[-10000,-10000]}]};assert.ok(Math.abs(createPreviewKernel().curve(curve,500)!-3.75)<1e-6);});
