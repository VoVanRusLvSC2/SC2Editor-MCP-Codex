import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createShadowGeometryMath, type ShadowCameraGeometry} from '../modules/lighting/shadowGeometry.js';

const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const empty = [1e7,1e7,1e7,-1e7,-1e7,-1e7,1e7,-1e7];
const camera:ShadowCameraGeometry = {
  eye:[0,0,0], right:[1,0,0], forward:[0,1,0], up:[0,0,1],
  planes:[[1,-1,0,0],[-1,-1,0,0],[0,-1,1,0],[0,-1,-1,0],[0,1,0,-200],[0,-1,0,-1]],
  near:1, far:200, shadowClip:20, fullWidthFactor:2, fullHeightFactor:2
};
const geometry = createShadowGeometryMath();
const close = (actual:number, expected:number, epsilon=1e-6) => assert.ok(Math.abs(actual-expected)<epsilon, `${actual} != ${expected}`);

test('shadow projection factors preserve horizontal versus vertical FOV', () => {
  const horizontal = geometry.perspectiveFactors(Math.PI/2, false, 16/9);
  const vertical = geometry.perspectiveFactors(Math.PI/2, true, 16/9);
  close(horizontal[0], 2); close(horizontal[1], 1.125);
  close(vertical[0], 32/9); close(vertical[1], 2);
});

test('light view uses Y depth and retains translated camera axes', () => {
  const result = geometry.lightView([1,2,3], [0,2,0]);
  assert.deepEqual(result.right, [1,0,0]);
  assert.deepEqual(result.forward, [0,1,0]);
  assert.deepEqual(result.up, [0,0,1]);
  assert.deepEqual(result.view.map(x => x===0?0:x), [1,0,0,0,0,1,0,0,0,0,1,0,-1,-2,-3,1]);
  assert.deepEqual(result.inverseLightFrame, [1,0,0,1,0,1,0,2,0,0,1,3]);
});

test('native tiny and parallel light directions have stable perpendicular axes', () => {
  const zero = geometry.lightView([0,0,0], [0,0,0]);
  assert.deepEqual(zero.forward, [0,0,1]);
  assert.deepEqual(zero.right.map(x=>x===0?0:x), [-1,0,0]);
  assert.deepEqual(zero.up.map(x=>x===0?0:x), [0,1,0]);
  const tiny = geometry.lightView([0,0,0], [1e-10,-1e-10,1e-10]);
  assert.deepEqual(tiny.forward, zero.forward);
  const downward = geometry.lightView([0,0,0], [0,0,-1]);
  assert.deepEqual(downward.right.map(x=>x===0?0:x), [1,0,0]);
  assert.deepEqual(downward.up.map(x=>x===0?0:x), [0,1,0]);
});

test('directional shadow projection maps Y-depth to native depth zero through one', () => {
  const p = geometry.orthographic(4,6,8), v = [2,8,3,1];
  const clip = [0,1,2,3].map(row => v.reduce((sum,x,col)=>sum+p[col*4+row]*x,0));
  clip.forEach((x,i)=>close(x, [1,1,1,1][i]));
  assert.throws(()=>geometry.orthographic(4,0,8), /EMPTY_PROJECTION/);
});

test('native clip planes face outward and use symmetric clip Z', () => {
  const planes = geometry.clipPlanes(identity);
  assert.deepEqual(planes.map(p => p.map(x => x===0 ? 0 : x)), [
    [1,0,0,-1],[-1,0,0,-1],[0,1,0,-1],[0,-1,0,-1],[0,0,1,-1],[0,0,-1,-1]
  ]);
});

test('shadow frustum preserves native near plane behind the camera', () => {
  const result = geometry.shadowFrustum(camera);
  assert.deepEqual(result.corners[0], [-1,1,-1]);
  assert.deepEqual(result.corners[7], [20,20,20]);
  assert.deepEqual(result.center, [0,10.5,0]);
  close(result.planes[4][3], -20);
  close(result.planes[5][3], -1);
  // Plane5 is at Y=-1 while the near corner rectangle is at Y=+1.
  close(-result.planes[5][3]/result.planes[5][1], -1);
  assert.equal(camera.planes[4][3], -200);
  const clipped = geometry.shadowFrustum(camera, 5, 2);
  close(clipped.corners[7][1], Math.fround(5+Math.fround(.01)));
});

test('frustum intersection retains minY and minimum view depth', () => {
  const bounds = [-100,-200,-300,100,200,300,-400,400];
  const result = geometry.intersectFrustumBounds(bounds, geometry.shadowFrustum(camera).corners, identity, identity);
  assert.deepEqual(result, [-20,-200,-20,20,20,20,-400,20]);
  assert.deepEqual(bounds, [-100,-200,-300,100,200,300,-400,400]);
});

test('light bounds use a rounded reciprocal while view depth divides directly', () => {
  const matrix = [...identity]; matrix[15] = 3;
  const points = Array.from({length:8}, () => [5,7,11]);
  const result = geometry.intersectFrustumBounds([-100,-200,-300,100,200,300,-400,400], points, matrix, matrix);
  assert.equal(result[0], Math.fround(5*Math.fround(1/3)));
  assert.notEqual(result[0], Math.fround(5/3));
  assert.equal(result[7], Math.fround(7/3));
});

test('shadow grid rounds outward independently of texture size', () => {
  const result = geometry.snapBounds([-.11,.21,-.31,.11,.21,.31,3,9]);
  [-.2,.2,-.4,.2,.3,.4,3,9].forEach((expected, i) => close(result[i], expected));
});

test('directional shadow volume includes potential casters behind the view', () => {
  const frustum = geometry.shadowFrustum(camera);
  const bounds = [-2,-3,-4,5,6,7,1,20], frame = [1,0,0,0,0,1,0,0,0,0,1,0];
  const full = geometry.directionalVolume(bounds, frustum, [0,1,0], frame);
  const open = geometry.directionalVolume(bounds, frustum, [0,1,0], frame, true);
  const inside = (volume:number[][], p:number[]) => volume.every(q => q[0]*p[0]+q[1]*p[1]+q[2]*p[2]+q[3]<=1e-6);
  assert.ok(inside(full.planes, [0,-100,0]));
  assert.ok(!inside(full.planes, [0,21,0]));
  assert.ok(inside(open.planes, [0,21,0]));
  assert.ok(full.originalPlaneMask !== 0);
  assert.equal(open.originalPlaneMask, 0);
  assert.equal(full.planes.length, open.planes.length+1);
});

test('caster fit rejects outside boxes and retains XYZ in depth-only mode', () => {
  const world = [...identity]; world[12] = 3; world[13] = 2;
  const box = [-1,-1,-1,1,1,1];
  const rejected = geometry.fitCaster(empty, box, world, identity, identity, [[1,0,0,0]]);
  assert.equal(rejected.accepted, false); assert.deepEqual(rejected.bounds, empty);
  const depth = geometry.fitCaster(empty, box, world, identity, identity, [], true);
  assert.deepEqual(depth.bounds, [...empty.slice(0,6),1,3]);
  const full = geometry.fitCaster(empty, box, world, identity, identity, []);
  assert.deepEqual(full.bounds, [2,1,-1,4,3,1,1,3]);
  assert.deepEqual(empty, [1e7,1e7,1e7,-1e7,-1e7,-1e7,1e7,-1e7]);
});

test('shadow math survives serialization without module dependencies', () => {
  const restored = vm.runInNewContext(`(${createShadowGeometryMath.toString()})()`) as ReturnType<typeof createShadowGeometryMath>;
  assert.deepEqual(JSON.parse(JSON.stringify(restored.shadowFrustum(camera))), JSON.parse(JSON.stringify(geometry.shadowFrustum(camera))));
  assert.throws(() => geometry.clipPlanes(new Array(16).fill(0)), /DEGENERATE_PLANE/);
  assert.throws(() => geometry.snapBounds([Infinity,0,0,0,0,0,0,0]), /INVALID_VECTOR/);
  assert.throws(() => geometry.snapBounds([1e9,0,0,0,0,0,0,0]), /GRID_RANGE/);
  const projective = [...identity]; projective[3] = .1;
  assert.throws(() => geometry.fitCaster(empty, [-1,-1,-1,1,1,1], projective, identity, identity, []), /PROJECTIVE_CASTER_UNQUALIFIED/);
});
