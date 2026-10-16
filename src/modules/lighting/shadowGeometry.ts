export interface ShadowFrustum {
  planes: number[][];
  corners: number[][];
  center: number[];
}

export interface ShadowCameraGeometry {
  eye: number[];
  right: number[];
  forward: number[];
  up: number[];
  planes: number[][];
  near: number;
  far: number;
  shadowClip: number;
  fullWidthFactor: number;
  fullHeightFactor: number;
}

/** Recovered Base98310 shadow geometry. This factory has no external runtime
 * dependencies so the same math can be serialized into a preview worker/page.
 * Matrices use the project's column-major convention; inverseLightFrame is the
 * native 3x4 row-major point transform. Resource/pass/bias policy lives elsewhere.
 */
export function createShadowGeometryMath() {
  const f = Math.fround;
  const add = (a:number, b:number) => f(a + b);
  const sub = (a:number, b:number) => f(a - b);
  const mul = (a:number, b:number) => f(a * b);
  const div = (a:number, b:number) => f(a / b);
  const epsilon = f(.01);
  const edgeParallelThreshold = f(.99);
  const edges = [[5,1,1,0],[5,0,3,2],[5,2,1,3],[5,3,0,2],
    [4,1,5,4],[4,0,7,6],[4,2,5,7],[4,3,4,6],
    [2,1,1,5],[1,3,0,4],[3,0,2,6],[0,2,3,7]];

  function vector(value:number[], size:number):number[] {
    if (value.length !== size || !value.every(x => Number.isFinite(f(x)))) {
      throw new Error('SHADOW_GEOMETRY_INVALID_VECTOR');
    }
    return value.map(f);
  }
  function planes(value:number[][]):number[][] {
    if (value.length > 36) throw new Error('SHADOW_GEOMETRY_PLANE_BUDGET');
    return value.map(p => vector(p, 4));
  }
  const dot = (a:number[], b:number[]) => add(add(mul(a[0], b[0]), mul(a[1], b[1])), mul(a[2], b[2]));
  const plus = (a:number[], b:number[]) => a.map((x, i) => add(x, b[i]));
  const minus = (a:number[], b:number[]) => a.map((x, i) => sub(x, b[i]));
  const cross = (a:number[], b:number[]) => [sub(mul(a[1], b[2]), mul(a[2], b[1])),
    sub(mul(a[2], b[0]), mul(a[0], b[2])), sub(mul(a[0], b[1]), mul(a[1], b[0]))];
  function normalize(value:number[]):number[]|undefined {
    const inverse = div(1, f(Math.sqrt(dot(value, value))));
    return Number.isFinite(inverse) ? value.map(x => mul(x, inverse)) : undefined;
  }
  function plane(a:number[], b:number[], c:number[]):number[]|undefined {
    const normal = normalize(cross(minus(b, a), minus(c, a)));
    return normal ? [...normal, -dot(normal, a)] : undefined;
  }
  const signedDistance = (p:number[], q:number[]) => add(dot(p, q), q[3]);
  const orient = (p:number[], inside:number[]) => signedDistance(inside, p) > 0 ? p.map(x => -x) : p;

  // Native matrix multiplication adds products in the order 1,0,2,3.
  function multiply(left:number[], right:number[]):number[] {
    const a = vector(left, 16), b = vector(right, 16), out = new Array<number>(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      out[c*4+r] = add(add(add(mul(b[c*4+1], a[4+r]), mul(b[c*4], a[r])),
        mul(b[c*4+2], a[8+r])), mul(b[c*4+3], a[12+r]));
    }
    return out;
  }
  function transform(p:number[], matrix:number[], project:boolean, reciprocal=false):number[] {
    const result = [0,1,2,3].map(r => add(add(add(mul(matrix[r], p[0]),
      mul(matrix[4+r], p[1])), mul(matrix[8+r], p[2])), matrix[12+r]));
    if (!project) return result.slice(0, 3);
    if (!Number.isFinite(result[3]) || result[3] === 0) throw new Error('SHADOW_GEOMETRY_ZERO_W');
    const inverse = reciprocal ? div(1, result[3]) : 0;
    return result.slice(0, 3).map(x => reciprocal ? mul(x, inverse) : div(x, result[3]));
  }

  function perspectiveFactors(fovRadians:number, vertical:boolean, aspect:number):number[] {
    const [angle, ratio] = vector([fovRadians, aspect], 2);
    if (angle <= 0 || angle >= Math.PI || ratio <= 0) throw new Error('SHADOW_GEOMETRY_INVALID_PROJECTION');
    const span = mul(f(Math.tan(mul(angle, .5))), 2);
    return vertical ? [mul(span, ratio), span] : [span, div(span, ratio)];
  }

  // 1417a95f0/1417a9790, including their component-wise tiny-vector and
  // least-axis perpendicular rules. The normalized forward axis is native Y.
  function lightView(eye:number[], direction:number[], initialUp=[0,0,1]) {
    const position = vector(eye, 3), raw = vector(direction, 3), upHint = vector(initialUp, 3);
    const tiny = f(2.384185791015625e-7);
    const small = (v:number[]) => v.every(x => Math.abs(x)<tiny);
    const forward = small(raw) ? [0,0,1] : normalize(raw);
    if (!forward) throw new Error('SHADOW_GEOMETRY_INVALID_DIRECTION');
    let right = cross(forward, upHint);
    if (small(right)) {
      const [x,y,z] = forward.map(Math.abs);
      // 14090b8c0: X only when strictly smallest, otherwise Z wins a Y/Z tie.
      const axis = x<y && x<z ? 0 : z<=y ? 2 : 1;
      right = cross(forward, [0,1,2].map(i => i===axis ? 1 : 0));
    }
    const normalizedRight = normalize(right);
    if (!normalizedRight) throw new Error('SHADOW_GEOMETRY_INVALID_RIGHT');
    right = normalizedRight;
    const up = cross(right, forward);
    const view = [right[0],forward[0],up[0],0,right[1],forward[1],up[1],0,
      right[2],forward[2],up[2],0,-dot(position,right),-dot(position,forward),-dot(position,up),1];
    const inverseLightFrame = [right[0],forward[0],up[0],position[0],right[1],forward[1],up[1],position[1],
      right[2],forward[2],up[2],position[2]];
    return {view, right, forward, up, inverseLightFrame};
  }

  // Centered 141d4b950 call used by directional shadow fit: native Y-depth,
  // Z-up, near0/farDepth and D3D depth[0,1]. WebGL clip conversion is separate.
  function orthographic(width:number, height:number, depth:number):number[] {
    const [w,h,d] = vector([width,height,depth], 3);
    if (w<=0 || h<=0 || d<=0) throw new Error('SHADOW_GEOMETRY_EMPTY_PROJECTION');
    const x = mul(div(1,sub(mul(w,.5),mul(w,-.5))),2);
    const y = mul(div(1,sub(mul(h,.5),mul(h,-.5))),2);
    const z = div(1,d);
    if (![x,y,z].every(Number.isFinite)) throw new Error('SHADOW_GEOMETRY_INVALID_PROJECTION');
    return [x,0,0,0,0,0,z,0,0,y,0,0,0,0,0,1];
  }

  // 14023a560: native clip inequalities have nonpositive inside distances.
  // Preserve symmetric +/-Z extraction even though its projection stores D3D
  // depth. shadowFrustum subsequently repositions both depth planes itself.
  function clipPlanes(worldToClip:number[]):number[][] {
    const matrix = vector(worldToClip, 16);
    return [[0,1],[0,-1],[1,1],[1,-1],[2,1],[2,-1]].map(([axis, sign]) => {
      const raw = [0,1,2,3].map(i => sub(mul(sign, matrix[i*4+axis]), matrix[i*4+3]));
      const inverse = div(1, f(Math.sqrt(dot(raw, raw))));
      if (!Number.isFinite(inverse)) throw new Error('SHADOW_GEOMETRY_DEGENERATE_PLANE');
      return raw.map(x => mul(x, inverse));
    });
  }

  // 141e63ed0. In particular, the near-plane point is eye + its own
  // normal*near, not eye + forward*near. This conservative native placement
  // need not coincide with the near rectangle's eight-corner topology.
  function shadowFrustum(camera:ShadowCameraGeometry, requestedNear=0, requestedFar=0):ShadowFrustum {
    const eye = vector(camera.eye, 3), right = vector(camera.right, 3);
    const forward = vector(camera.forward, 3), up = vector(camera.up, 3);
    const sourcePlanes = planes(camera.planes);
    if (sourcePlanes.length !== 6) throw new Error('SHADOW_GEOMETRY_CAMERA_PLANES');
    const [rawNear, rawFar, shadowClip, width, height, wantNear, wantFar] = vector([
      camera.near, camera.far, camera.shadowClip, camera.fullWidthFactor,
      camera.fullHeightFactor, requestedNear, requestedFar], 7);
    const near = wantNear >= epsilon ? wantNear : rawNear;
    let far = Math.min(rawFar, wantFar >= epsilon ? wantFar : shadowClip);
    if (sub(far, near) < epsilon) far = add(near, epsilon);
    for (const [index, depth] of [[4, far], [5, near]]) {
      const normal = sourcePlanes[index].slice(0, 3);
      sourcePlanes[index][3] = -dot(eye.map((x, i) => add(x, mul(normal[i], depth))), normal);
    }
    const corners:number[][] = [];
    for (const depth of [near, far]) {
      const center = eye.map((x, i) => add(x, mul(forward[i], depth)));
      for (const [sx, sy] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        corners.push(center.map((x, i) => add(add(x, mul(sx, mul(mul(right[i], mul(width, .5)), depth))),
          mul(sy, mul(mul(up[i], mul(height, .5)), depth)))));
      }
    }
    return {planes: sourcePlanes, corners,
      center: eye.map((x, i) => add(x, mul(mul(forward[i], add(near, far)), .5)))};
  }

  // 141e62cf0 changes only slots0/2/3/4/5/7. Slots1 and6 are intentional.
  function intersectFrustumBounds(bounds:number[], corners:number[][], worldToLight:number[], view:number[]):number[] {
    const result = vector(bounds, 8), lightMatrix = vector(worldToLight, 16), viewMatrix = vector(view, 16);
    if (corners.length !== 8) throw new Error('SHADOW_GEOMETRY_CORNER_COUNT');
    const points = corners.map(p => vector(p, 3));
    // Native light projection multiplies by one rounded reciprocal; camera
    // depth uses a direct division. They can differ by one float32 ULP.
    const light = points.map(p => transform(p, lightMatrix, true, true));
    const depth = points.map(p => transform(p, viewMatrix, true)[1]);
    result[0] = Math.max(result[0], Math.min(...light.map(p => p[0])));
    result[2] = Math.max(result[2], Math.min(...light.map(p => p[2])));
    for (let axis = 0; axis < 3; axis++) result[3+axis] = Math.min(result[3+axis], Math.max(...light.map(p => p[axis])));
    result[7] = Math.min(result[7], Math.max(...depth));
    return result;
  }

  function snapBounds(bounds:number[]):number[] {
    const result = vector(bounds, 8);
    for (let i = 0; i < 6; i++) {
      const scaled = mul(result[i], 10);
      if (scaled <= -2147483648 || scaled >= 2147483647) throw new Error('SHADOW_GEOMETRY_GRID_RANGE');
      result[i] = mul(i < 3 ? Math.floor(scaled) : Math.ceil(scaled), f(.1));
    }
    return result;
  }

  function directionalVolume(bounds:number[], frustum:ShadowFrustum, direction:number[], inverseLightFrame:number[], omitFacingPlanes=false) {
    const box = vector(bounds, 8), light = vector(direction, 3), frame = vector(inverseLightFrame, 12);
    const cameraPlanes = planes(frustum.planes), corners = frustum.corners.map(p => vector(p, 3));
    const center = vector(frustum.center, 3), result:number[][] = [];
    if (cameraPlanes.length !== 6 || corners.length !== 8) throw new Error('SHADOW_GEOMETRY_FRUSTUM_LAYOUT');
    const world = (p:number[]) => [0,1,2].map(i => add(add(add(mul(frame[i*4], p[0]),
      mul(frame[i*4+1], p[1])), mul(frame[i*4+2], p[2])), frame[i*4+3]));
    if ([0,1,2].every(i => sub(box[3+i], box[i]) >= epsilon)) {
      const rectangle = [[box[0],0,box[2]],[box[3],0,box[2]],
        [box[3],0,box[5]],[box[0],0,box[5]]].map(world);
      const inside = world([mul(add(box[0], box[3]), .5), 1, mul(add(box[2], box[5]), .5)]);
      rectangle.forEach((p, i) => {
        const q = plane(p, rectangle[(i+1)%4], plus(p, light));
        if (q) result.push(orient(q, inside));
      });
    }
    let originalPlaneMask = 0;
    const facing = cameraPlanes.map(p => dot(light, p) > 0);
    cameraPlanes.forEach((p, i) => {
      if (facing[i] && !omitFacingPlanes) {
        originalPlaneMask |= 1 << result.length;
        result.push([...p]);
      }
    });
    for (const [fa, fb, a, b] of edges) {
      if (facing[fa] === facing[fb]) continue;
      const edge = normalize(minus(corners[b], corners[a]));
      if (!edge || Math.abs(dot(edge, light)) > edgeParallelThreshold) continue;
      const q = plane(corners[a], corners[b], plus(corners[a], light));
      if (!q) throw new Error('SHADOW_GEOMETRY_DEGENERATE_EDGE_PLANE');
      result.push(orient(q, center));
    }
    return {planes: result, originalPlaneMask: originalPlaneMask >>> 0};
  }

  function fitCaster(bounds:number[], localBox:number[], world:number[], view:number[], worldToLight:number[], volume:number[][], depthOnly=false) {
    const result = vector(bounds, 8), box = vector(localBox, 6), objectMatrix = vector(world, 16);
    const viewMatrix = vector(view, 16), lightMatrix = vector(worldToLight, 16), clipping = planes(volume);
    // Recovered caster replay covers affine object/view/light transforms.
    // Projection matrices belong to the later receiver-coordinate stage.
    if ([objectMatrix, viewMatrix, lightMatrix].some(m => m[3]!==0 || m[7]!==0 || m[11]!==0 || m[15]!==1)) {
      throw new Error('SHADOW_GEOMETRY_PROJECTIVE_CASTER_UNQUALIFIED');
    }
    const minimum = [...box.slice(0, 3), 1], maximum = [...box.slice(3), 1];
    for (const p of clipping) {
      const local = [0,1,2,3].map(c => add(add(add(mul(p[1], objectMatrix[c*4+1]),
        mul(p[0], objectMatrix[c*4])), mul(p[2], objectMatrix[c*4+2])), mul(p[3], objectMatrix[c*4+3])));
      const terms = local.map((x, i) => Math.min(mul(x, minimum[i]), mul(x, maximum[i])));
      if (add(add(terms[1], terms[2]), add(terms[0], terms[3])) > 0) return {accepted: false, bounds: result};
    }
    const combinedView = multiply(viewMatrix, objectMatrix), combinedLight = depthOnly ? undefined : multiply(lightMatrix, objectMatrix);
    for (const x of [box[0], box[3]]) for (const y of [box[1], box[4]]) for (const z of [box[2], box[5]]) {
      const p = [x,y,z], depth = transform(p, combinedView, false)[1];
      result[6] = Math.min(result[6], depth);
      result[7] = Math.max(result[7], depth);
      if (combinedLight) {
        const point = transform(p, combinedLight, true);
        for (let i = 0; i < 3; i++) {
          result[i] = Math.min(result[i], point[i]);
          result[3+i] = Math.max(result[3+i], point[i]);
        }
      }
    }
    return {accepted: true, bounds: result};
  }

  return {perspectiveFactors, lightView, orthographic, clipPlanes, shadowFrustum, intersectFrustumBounds,
    snapBounds, directionalVolume, fitCaster, multiply};
}
