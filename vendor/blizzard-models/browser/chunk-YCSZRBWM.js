// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/model-math/transform.js
function normalizeQuat(value) {
  const x = value[0] ?? 0;
  const y = value[1] ?? 0;
  const z = value[2] ?? 0;
  const w = value[3] ?? 1;
  const length = Math.hypot(x, y, z, w) || 1;
  return [x / length, y / length, z / length, w / length];
}
function decomposeMatrix4(matrix) {
  const m = (at) => matrix[at] ?? (at % 5 === 0 ? 1 : 0);
  const determinant = m(0) * (m(5) * m(10) - m(9) * m(6)) - m(4) * (m(1) * m(10) - m(9) * m(2)) + m(8) * (m(1) * m(6) - m(5) * m(2));
  const sx = (determinant < 0 ? -1 : 1) * Math.hypot(m(0), m(1), m(2));
  const sy = Math.hypot(m(4), m(5), m(6));
  const sz = Math.hypot(m(8), m(9), m(10));
  const tiny = 1e-12 * Math.max(1, Math.abs(sx), sy, sz);
  const unit = (scale, at) => Math.abs(scale) <= tiny ? void 0 : [m(at) / scale, m(at + 1) / scale, m(at + 2) / scale];
  let x = unit(sx, 0);
  let y = unit(sy, 4);
  let z = unit(sz, 8);
  if (x === void 0 && y === void 0 && z === void 0)
    [x, y, z] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
  if (x !== void 0 && y === void 0 && z === void 0)
    y = perpendicular(x);
  else if (y !== void 0 && z === void 0 && x === void 0)
    z = perpendicular(y);
  else if (z !== void 0 && x === void 0 && y === void 0)
    x = perpendicular(z);
  if (z === void 0)
    z = cross(x, y);
  if (x === void 0)
    x = cross(y, z);
  if (y === void 0)
    y = cross(z, x);
  return {
    translation: [m(12), m(13), m(14)],
    scaling: [sx, sy, sz],
    rotation: quaternionFromRotationMatrix([...x, ...y, ...z])
  };
}
function cross(a, b) {
  const c = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  const length = Math.hypot(c[0], c[1], c[2]) || 1;
  return [c[0] / length, c[1] / length, c[2] / length];
}
function perpendicular(v) {
  return cross(v, Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
}
function quaternionFromRotationMatrix(matrix) {
  const m00 = matrix[0] ?? 1;
  const m01 = matrix[3] ?? 0;
  const m02 = matrix[6] ?? 0;
  const m10 = matrix[1] ?? 0;
  const m11 = matrix[4] ?? 1;
  const m12 = matrix[7] ?? 0;
  const m20 = matrix[2] ?? 0;
  const m21 = matrix[5] ?? 0;
  const m22 = matrix[8] ?? 1;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s2 = Math.sqrt(trace + 1) * 2;
    return normalizeQuat([(m21 - m12) / s2, (m02 - m20) / s2, (m10 - m01) / s2, 0.25 * s2]);
  }
  if (m00 > m11 && m00 > m22) {
    const s2 = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normalizeQuat([0.25 * s2, (m01 + m10) / s2, (m02 + m20) / s2, (m21 - m12) / s2]);
  }
  if (m11 > m22) {
    const s2 = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normalizeQuat([(m01 + m10) / s2, 0.25 * s2, (m12 + m21) / s2, (m02 - m20) / s2]);
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normalizeQuat([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]);
}
function invertAffine(matrix) {
  const value = (index) => {
    const one = matrix[index];
    return typeof one === "number" && Number.isFinite(one) ? one : 0;
  };
  const basis = [
    value(0),
    value(1),
    value(2),
    value(4),
    value(5),
    value(6),
    value(8),
    value(9),
    value(10)
  ];
  const determinant = basis[0] * (basis[4] * basis[8] - basis[5] * basis[7]) - basis[3] * (basis[1] * basis[8] - basis[2] * basis[7]) + basis[6] * (basis[1] * basis[5] - basis[2] * basis[4]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new RangeError("a bind matrix with no inverse cannot place a baked part");
  const inverse = [
    (basis[4] * basis[8] - basis[5] * basis[7]) / determinant,
    (basis[2] * basis[7] - basis[1] * basis[8]) / determinant,
    (basis[1] * basis[5] - basis[2] * basis[4]) / determinant,
    (basis[5] * basis[6] - basis[3] * basis[8]) / determinant,
    (basis[0] * basis[8] - basis[2] * basis[6]) / determinant,
    (basis[2] * basis[3] - basis[0] * basis[5]) / determinant,
    (basis[3] * basis[7] - basis[4] * basis[6]) / determinant,
    (basis[1] * basis[6] - basis[0] * basis[7]) / determinant,
    (basis[0] * basis[4] - basis[1] * basis[3]) / determinant
  ];
  const translation = [value(12), value(13), value(14)];
  const moved = [0, 1, 2].map((row) => -(inverse[row] * translation[0] + inverse[row + 3] * translation[1] + inverse[row + 6] * translation[2]));
  return [
    inverse[0],
    inverse[1],
    inverse[2],
    0,
    inverse[3],
    inverse[4],
    inverse[5],
    0,
    inverse[6],
    inverse[7],
    inverse[8],
    0,
    moved[0],
    moved[1],
    moved[2],
    1
  ];
}
function multiplyAffine(left, right) {
  const product = new Array(16);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++)
        sum += (left[k * 4 + row] ?? 0) * (right[column * 4 + k] ?? 0);
      product[column * 4 + row] = sum;
    }
  return product;
}

// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/model/legacy/skinning-kernels.js
function skinInterleaved(source, mesh, matrices, target) {
  if (!mesh.skin)
    return new Float32Array(source);
  const out = target?.length === source.length ? target : new Float32Array(source.length);
  out.set(source);
  const stride = mesh.attributes.strideBytes / Float32Array.BYTES_PER_ELEMENT;
  const positionOffset = mesh.attributes.positionOffsetBytes / Float32Array.BYTES_PER_ELEMENT;
  const normalOffset = mesh.attributes.normalOffsetBytes / Float32Array.BYTES_PER_ELEMENT;
  const tangentOffset = mesh.attributes.tangentOffsetBytes / Float32Array.BYTES_PER_ELEMENT;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const vertexBase = vertex * stride;
    const skinBase = vertex * mesh.skin.maxInfluences;
    const px = source[vertexBase + positionOffset] ?? 0;
    const py = source[vertexBase + positionOffset + 1] ?? 0;
    const pz = source[vertexBase + positionOffset + 2] ?? 0;
    const nx = source[vertexBase + normalOffset] ?? 0;
    const ny = source[vertexBase + normalOffset + 1] ?? 0;
    const nz = source[vertexBase + normalOffset + 2] ?? 1;
    const tx = source[vertexBase + tangentOffset] ?? 1;
    const ty = source[vertexBase + tangentOffset + 1] ?? 0;
    const tz = source[vertexBase + tangentOffset + 2] ?? 0;
    let weightSum = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    let normalX = 0;
    let normalY = 0;
    let normalZ = 0;
    let tangentX = 0;
    let tangentY = 0;
    let tangentZ = 0;
    for (let slot = 0; slot < mesh.skin.maxInfluences; slot += 1) {
      const weight = mesh.skin.boneWeights[skinBase + slot] ?? 0;
      if (weight <= 0)
        continue;
      const matrix = matrices[mesh.skin.boneIndices[skinBase + slot] ?? 0];
      if (!matrix)
        continue;
      const transformed = transformPoint(matrix, px, py, pz);
      const transformedNormal = transformVector(matrix, nx, ny, nz);
      const transformedTangent = transformVector(matrix, tx, ty, tz);
      x += transformed[0] * weight;
      y += transformed[1] * weight;
      z += transformed[2] * weight;
      normalX += transformedNormal[0] * weight;
      normalY += transformedNormal[1] * weight;
      normalZ += transformedNormal[2] * weight;
      tangentX += transformedTangent[0] * weight;
      tangentY += transformedTangent[1] * weight;
      tangentZ += transformedTangent[2] * weight;
      weightSum += weight;
    }
    if (weightSum > 0) {
      out[vertexBase + positionOffset] = x / weightSum;
      out[vertexBase + positionOffset + 1] = y / weightSum;
      out[vertexBase + positionOffset + 2] = z / weightSum;
      const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;
      out[vertexBase + normalOffset] = normalX / normalLength;
      out[vertexBase + normalOffset + 1] = normalY / normalLength;
      out[vertexBase + normalOffset + 2] = normalZ / normalLength;
      const tangentLength = Math.hypot(tangentX, tangentY, tangentZ) || 1;
      out[vertexBase + tangentOffset] = tangentX / tangentLength;
      out[vertexBase + tangentOffset + 1] = tangentY / tangentLength;
      out[vertexBase + tangentOffset + 2] = tangentZ / tangentLength;
    }
  }
  return out;
}
function transformPoint(matrix, x, y, z) {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0)
  ];
}
function transformVector(matrix, x, y, z) {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z,
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z,
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z
  ];
}

// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/model/skinning.js
var kernelOutput = new Float32Array(0);
function createModelSkinDeformer(primitive, boneIndices, maxBytes = 134217728, signal) {
  if (signal?.aborted)
    throw new DOMException("operation cancelled", "AbortError");
  const count = primitive.positions.length / 3;
  if (!Number.isSafeInteger(count) || !primitive.positions.every(Number.isFinite))
    throw new TypeError("invalid skin positions");
  const workingBytes = count * 144 + boneIndices.length * 64;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || workingBytes > maxBytes)
    throw new RangeError("skin deformation exceeds maxBytes");
  const slots = /* @__PURE__ */ new Map();
  for (const [slot, index] of boneIndices.entries()) {
    if (!Number.isSafeInteger(index) || index < 0 || slots.has(index))
      throw new TypeError("ambiguous skin bone index");
    slots.set(index, slot);
  }
  const { boneWeights, boneIndices: authored } = primitive;
  if (!primitive.hierarchyId || authored?.length !== count * 4 || boneWeights?.length !== count * 4)
    throw new TypeError("skin requires an explicit hierarchy and four indices and weights per vertex");
  for (const [data, width, label] of [
    [primitive.normals, 3, "normals"],
    [primitive.tangents, 4, "tangents"]
  ]) {
    if (data !== void 0 && (data.length !== count * width || !data.every(Number.isFinite)))
      throw new TypeError(`invalid skin ${label}`);
  }
  const indices = new Uint32Array(authored.length);
  const weights = new Float32Array(boneWeights);
  let zeroWeightVertices = 0;
  let normalizedWeightVertices = 0;
  for (let vertex = 0; vertex < count; vertex++) {
    let sum = 0;
    for (let influence = 0; influence < 4; influence++) {
      const index = vertex * 4 + influence;
      const weight = weights[index];
      if (!Number.isFinite(weight) || weight < 0 || weight > 1)
        throw new TypeError("invalid skin weight");
      const slot = slots.get(authored[index]);
      if (slot === void 0)
        throw new TypeError("skin references an absent bone");
      indices[index] = slot;
      sum += weight;
    }
    if (sum === 0)
      zeroWeightVertices++;
    else if (Math.abs(sum - 1) > 1e-4)
      normalizedWeightVertices++;
  }
  const source = new Float32Array(count * 9);
  for (let vertex = 0; vertex < count; vertex++) {
    if ((vertex & 1023) === 0 && signal?.aborted)
      throw new DOMException("operation cancelled", "AbortError");
    source.set(primitive.positions.subarray(vertex * 3, vertex * 3 + 3), vertex * 9);
    if (primitive.normals)
      source.set(primitive.normals.subarray(vertex * 3, vertex * 3 + 3), vertex * 9 + 3);
    if (primitive.tangents)
      source.set(primitive.tangents.subarray(vertex * 4, vertex * 4 + 3), vertex * 9 + 6);
  }
  const mesh = {
    vertexCount: count,
    attributes: {
      strideBytes: 36,
      positionOffsetBytes: 0,
      normalOffsetBytes: 12,
      tangentOffsetBytes: 24
    },
    skin: { maxInfluences: 4, boneIndices: indices, boneWeights: weights }
  };
  return Object.freeze({
    workingBytes,
    zeroWeightVertices,
    normalizedWeightVertices,
    deform(bones, requestSignal) {
      if (requestSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      const matrices = new Array(slots.size);
      for (const bone of bones) {
        const slot = slots.get(bone.boneIndex);
        if (slot === void 0)
          continue;
        const matrix = bone.skinningMatrix;
        if (matrices[slot] !== void 0 || matrix?.length !== 16 || !matrix.every(Number.isFinite))
          throw new TypeError("skin needs a unique explicit inverse-bind pose for each bone");
        matrices[slot] = new Float32Array(matrix);
      }
      for (let slot = 0; slot < matrices.length; slot++)
        if (matrices[slot] === void 0)
          throw new TypeError("skin pose is incomplete");
      if (kernelOutput.length < source.length)
        kernelOutput = new Float32Array(source.length);
      const deformed = skinInterleaved(source, mesh, matrices, kernelOutput.subarray(0, source.length));
      for (let index = 0; index < deformed.length; index++)
        if (!Number.isFinite(deformed[index]))
          throw new RangeError("deformed skin exceeds finite float range");
      const positions = new Float32Array(count * 3);
      const normals = primitive.normals ? new Float32Array(count * 3) : void 0;
      const tangents = primitive.tangents ? new Float32Array(primitive.tangents) : void 0;
      for (let vertex = 0; vertex < count; vertex++) {
        if ((vertex & 1023) === 0 && requestSignal?.aborted)
          throw new DOMException("operation cancelled", "AbortError");
        const from = vertex * 9, to = vertex * 3;
        positions[to] = deformed[from];
        positions[to + 1] = deformed[from + 1];
        positions[to + 2] = deformed[from + 2];
        if (normals !== void 0) {
          normals[to] = deformed[from + 3];
          normals[to + 1] = deformed[from + 4];
          normals[to + 2] = deformed[from + 5];
        }
        if (tangents !== void 0) {
          const tangent = vertex * 4;
          tangents[tangent] = deformed[from + 6];
          tangents[tangent + 1] = deformed[from + 7];
          tangents[tangent + 2] = deformed[from + 8];
        }
      }
      const { bounds: _bounds, boneIndices: _indices, boneWeights: _weights, hierarchyId: _hierarchy, normals: _normals, tangents: _tangents, ...rest } = primitive;
      return {
        ...rest,
        positions,
        ...normals ? { normals } : {},
        ...tangents ? { tangents } : {}
      };
    }
  });
}
function splitTrianglesByBoneLimit(indices, boneIndices, boneWeights, options) {
  const { maxBones, signal } = options;
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(maxBones) || maxBones < 1)
    throw new RangeError("a bone budget must be a positive whole number");
  if (indices.length % 3 !== 0)
    throw new TypeError("splitting a mesh requires whole triangles");
  const maxBytes = options.maxBytes ?? 134217728;
  if (indices.length * 8 > maxBytes)
    throw new RangeError("bone split exceeds maxBytes");
  const bonesOf = (vertex) => {
    if (boneIndices === void 0 || boneWeights === void 0)
      return [];
    const out = [];
    for (let influence = 0; influence < 4; influence += 1) {
      const at = vertex * 4 + influence;
      if (at >= boneIndices.length)
        break;
      const weight = boneWeights[at] ?? 0;
      const bone = boneIndices[at] ?? 0;
      if (weight > 0 && !out.includes(bone))
        out.push(bone);
    }
    return out;
  };
  const all = /* @__PURE__ */ new Set();
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    if ((triangle & 1023) === 0)
      signal?.throwIfAborted();
    for (let corner = 0; corner < 3; corner += 1)
      for (const bone of bonesOf(indices[triangle + corner] ?? 0))
        all.add(bone);
  }
  const whole = () => {
    const vertices2 = [];
    const remap2 = /* @__PURE__ */ new Map();
    const out = new Uint32Array(indices.length);
    for (let at = 0; at < indices.length; at += 1) {
      const vertex = indices[at] ?? 0;
      let mapped = remap2.get(vertex);
      if (mapped === void 0) {
        mapped = vertices2.length;
        remap2.set(vertex, mapped);
        vertices2.push(vertex);
      }
      out[at] = mapped;
    }
    return [
      {
        bones: [...all].sort((left, right) => left - right),
        vertices: Uint32Array.from(vertices2),
        indices: out
      }
    ];
  };
  if (all.size <= maxBones)
    return whole();
  const parts = [];
  let bones = /* @__PURE__ */ new Set();
  let vertices = [];
  let remap = /* @__PURE__ */ new Map();
  let partIndices = [];
  const close = () => {
    if (partIndices.length === 0)
      return;
    parts.push({
      bones: [...bones].sort((left, right) => left - right),
      vertices: Uint32Array.from(vertices),
      indices: Uint32Array.from(partIndices)
    });
    bones = /* @__PURE__ */ new Set();
    vertices = [];
    remap = /* @__PURE__ */ new Map();
    partIndices = [];
  };
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    signal?.throwIfAborted();
    const corners = [
      indices[triangle] ?? 0,
      indices[triangle + 1] ?? 0,
      indices[triangle + 2] ?? 0
    ];
    const wanted = /* @__PURE__ */ new Set();
    for (const corner of corners)
      for (const bone of bonesOf(corner))
        wanted.add(bone);
    if (wanted.size > maxBones)
      throw new RangeError(`one triangle follows ${String(wanted.size)} bones, more than the budget of ${String(maxBones)}`);
    let added = 0;
    for (const bone of wanted)
      if (!bones.has(bone))
        added += 1;
    if (bones.size + added > maxBones)
      close();
    for (const bone of wanted)
      bones.add(bone);
    for (const corner of corners) {
      let mapped = remap.get(corner);
      if (mapped === void 0) {
        mapped = vertices.length;
        remap.set(corner, mapped);
        vertices.push(corner);
      }
      partIndices.push(mapped);
    }
  }
  close();
  return parts;
}

export {
  normalizeQuat,
  decomposeMatrix4,
  quaternionFromRotationMatrix,
  invertAffine,
  multiplyAffine,
  createModelSkinDeformer,
  splitTrianglesByBoneLimit
};
