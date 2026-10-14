import {
  snapshotJson
} from "./chunk-TUJSTS7T.js";

// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/model-math/sequence-pose.js
var CUBIC_SPLINE_LINE_TYPE = 4;
var IDENTITY_QUAT = [0, 0, 0, 1];
var ZERO_VEC3 = [0, 0, 0];
var ONE_VEC3 = [1, 1, 1];
function sampleTrackValue(track, timeSeconds, out, options = {}) {
  const keys = track.keys;
  const count = keys.length;
  if (count === 0) {
    out.length = 0;
    return out;
  }
  let time = timeSeconds;
  let wrapRoundoff = 0;
  if (options.wrapSeconds && options.wrapSeconds > 0) {
    time = timeSeconds % options.wrapSeconds;
    wrapRoundoff = Math.max(options.wrapSeconds, Math.abs(timeSeconds)) * Number.EPSILON * 2;
    if (Math.abs(time - options.wrapSeconds) <= wrapRoundoff)
      time = 0;
  }
  const first = keys[0];
  if (time <= first.frame || count === 1)
    return copyVector(first.vector, out);
  const last = keys[count - 1];
  if (time >= last.frame)
    return copyVector(last.vector, out);
  let b = 1;
  while (b < count - 1 && time + wrapRoundoff >= keys[b].frame)
    b += 1;
  const ka = keys[b - 1];
  const kb = keys[b];
  if (track.lineType === 0)
    return copyVector(ka.vector, out);
  const span = kb.frame - ka.frame;
  const t = span > 0 ? Math.min(Math.max((time - ka.frame) / span, 0), 1) : 0;
  if (track.lineType === CUBIC_SPLINE_LINE_TYPE) {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    out.length = ka.vector.length;
    for (let i = 0; i < ka.vector.length; i += 1)
      out[i] = h00 * ka.vector[i] + h10 * span * (ka.outTan?.[i] ?? 0) + h01 * (kb.vector[i] ?? ka.vector[i]) + h11 * span * (kb.inTan?.[i] ?? 0);
    if (options.isQuat && out.length === 4) {
      const len = Math.hypot(out[0], out[1], out[2], out[3]);
      if (len > 0)
        for (let i = 0; i < 4; i += 1)
          out[i] /= len;
    }
    return out;
  }
  if (options.isQuat && ka.vector.length === 4 && kb.vector.length === 4) {
    return slerpVector(ka.vector, kb.vector, t, out);
  }
  out.length = ka.vector.length;
  for (let i = 0; i < ka.vector.length; i += 1) {
    const a = ka.vector[i];
    out[i] = a + ((kb.vector[i] ?? a) - a) * t;
  }
  return out;
}
function copyVector(source, out) {
  out.length = source.length;
  for (let i = 0; i < source.length; i += 1)
    out[i] = source[i];
  return out;
}
function slerpVector(a, b, t, out) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let sign = 1;
  if (dot < 0) {
    dot = -dot;
    sign = -1;
  }
  out.length = 4;
  if (dot > 0.9995) {
    for (let i = 0; i < 4; i += 1)
      out[i] = a[i] + (sign * b[i] - a[i]) * t;
  } else {
    const theta = Math.acos(Math.min(1, dot));
    const sinTheta = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sinTheta;
    const wb = Math.sin(t * theta) / sinTheta * sign;
    for (let i = 0; i < 4; i += 1)
      out[i] = wa * a[i] + wb * b[i];
  }
  const len = Math.hypot(out[0], out[1], out[2], out[3]);
  if (len > 0) {
    for (let i = 0; i < 4; i += 1)
      out[i] /= len;
  }
  return out;
}
function composeTrsMatrix(out, offset, translation, rotation, scale) {
  const x = rotation[0] ?? 0;
  const y = rotation[1] ?? 0;
  const z = rotation[2] ?? 0;
  const w = rotation[3] ?? 1;
  const sx = scale[0] ?? 1;
  const sy = scale[1] ?? 1;
  const sz = scale[2] ?? 1;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[offset] = (1 - (yy + zz)) * sx;
  out[offset + 1] = (xy + wz) * sx;
  out[offset + 2] = (xz - wy) * sx;
  out[offset + 3] = 0;
  out[offset + 4] = (xy - wz) * sy;
  out[offset + 5] = (1 - (xx + zz)) * sy;
  out[offset + 6] = (yz + wx) * sy;
  out[offset + 7] = 0;
  out[offset + 8] = (xz + wy) * sz;
  out[offset + 9] = (yz - wx) * sz;
  out[offset + 10] = (1 - (xx + yy)) * sz;
  out[offset + 11] = 0;
  out[offset + 12] = translation[0] ?? 0;
  out[offset + 13] = translation[1] ?? 0;
  out[offset + 14] = translation[2] ?? 0;
  out[offset + 15] = 1;
}
function multiplyMat4(out, outOffset, a, aOffset, b, bOffset) {
  const a00 = a[aOffset];
  const a01 = a[aOffset + 1];
  const a02 = a[aOffset + 2];
  const a03 = a[aOffset + 3];
  const a10 = a[aOffset + 4];
  const a11 = a[aOffset + 5];
  const a12 = a[aOffset + 6];
  const a13 = a[aOffset + 7];
  const a20 = a[aOffset + 8];
  const a21 = a[aOffset + 9];
  const a22 = a[aOffset + 10];
  const a23 = a[aOffset + 11];
  const a30 = a[aOffset + 12];
  const a31 = a[aOffset + 13];
  const a32 = a[aOffset + 14];
  const a33 = a[aOffset + 15];
  for (let col = 0; col < 4; col += 1) {
    const b0 = b[bOffset + col * 4];
    const b1 = b[bOffset + col * 4 + 1];
    const b2 = b[bOffset + col * 4 + 2];
    const b3 = b[bOffset + col * 4 + 3];
    out[outOffset + col * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[outOffset + col * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[outOffset + col * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[outOffset + col * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
}
var SequencePoseSampler = class {
  bones;
  boneCount;
  world;
  skinning;
  local;
  translation = [];
  rotation = [];
  scale = [];
  trackSetsBySequence = /* @__PURE__ */ new WeakMap();
  constructor(bones) {
    this.bones = bones;
    this.boneCount = bones.length;
    this.world = new Float32Array(this.boneCount * 16);
    this.skinning = new Float32Array(this.boneCount * 16);
    this.local = new Float32Array(16);
  }
  trackSets(sequence) {
    let sets = this.trackSetsBySequence.get(sequence);
    if (!sets) {
      sets = new Array(this.boneCount);
      for (const trackSet of sequence.nodeTracks) {
        if (trackSet.boneIndex >= 0 && trackSet.boneIndex < this.boneCount) {
          sets[trackSet.boneIndex] = trackSet;
        }
      }
      this.trackSetsBySequence.set(sequence, sets);
    }
    return sets;
  }
  /**
   * Bones must be stored parent-before-child (M3/MDX convention; the codecs
   * guarantee it). Loops sample tracks → local TRS → world = parentWorld ×
   * local → skinning = world × IREF.
   */
  samplePose(sequence, timeSeconds) {
    const sets = this.trackSets(sequence);
    for (let boneIndex = 0; boneIndex < this.boneCount; boneIndex += 1) {
      const bone = this.bones[boneIndex];
      const trackSet = sets[boneIndex];
      const wrapSeconds = trackSet?.concurrent ? trackSet.wrapSeconds : void 0;
      const translation = trackSet?.translation ? sampleTrackValue(trackSet.translation, timeSeconds, this.translation, { wrapSeconds }) : ZERO_VEC3;
      const rotation = trackSet?.rotation ? sampleTrackValue(trackSet.rotation, timeSeconds, this.rotation, {
        wrapSeconds,
        isQuat: true
      }) : IDENTITY_QUAT;
      const scale = trackSet?.scale ? sampleTrackValue(trackSet.scale, timeSeconds, this.scale, { wrapSeconds }) : ONE_VEC3;
      composeTrsMatrix(this.local, 0, translation, rotation, scale);
      const parentIndex = bone.parentIndex;
      if (parentIndex >= 0 && parentIndex < boneIndex) {
        multiplyMat4(this.world, boneIndex * 16, this.world, parentIndex * 16, this.local, 0);
      } else {
        this.world.set(this.local, boneIndex * 16);
      }
      const inverseBind = bone.inverseBindMatrix;
      if (inverseBind && inverseBind.length === 16) {
        multiplyMat4(this.skinning, boneIndex * 16, this.world, boneIndex * 16, inverseBind, 0);
      } else {
        this.skinning.set(this.world.subarray(boneIndex * 16, boneIndex * 16 + 16), boneIndex * 16);
      }
    }
    return { world: this.world, skinning: this.skinning };
  }
  /** Blend controller clip samples before composing the hierarchy. */
  sampleBlendedPose(samples) {
    const active = samples.filter((sample) => sample.weight > 0 && Number.isFinite(sample.weight));
    if (active.length === 0) {
      this.world.fill(0);
      this.skinning.fill(0);
      return { world: this.world, skinning: this.skinning };
    }
    const value = [];
    for (let boneIndex = 0; boneIndex < this.boneCount; boneIndex += 1) {
      const bone = this.bones[boneIndex];
      const translation = [0, 0, 0];
      const rotation = [0, 0, 0, 0];
      const scale = [0, 0, 0];
      let overrideWeight = 0;
      let referenceRotation;
      for (const sample of active) {
        if (sample.additive)
          continue;
        const trackSet = this.trackSets(sample.sequence)[boneIndex];
        const wrapSeconds = trackSet?.concurrent ? trackSet.wrapSeconds : void 0;
        const sampledTranslation = trackSet?.translation ? sampleTrackValue(trackSet.translation, sample.timeSeconds, value, { wrapSeconds }) : ZERO_VEC3;
        for (let component = 0; component < 3; component += 1)
          translation[component] += (sampledTranslation[component] ?? 0) * sample.weight;
        const sampledRotation = trackSet?.rotation ? sampleTrackValue(trackSet.rotation, sample.timeSeconds, value, {
          wrapSeconds,
          isQuat: true
        }) : IDENTITY_QUAT;
        referenceRotation ??= [...sampledRotation];
        const sign = quaternionDot(referenceRotation, sampledRotation) < 0 ? -1 : 1;
        for (let component = 0; component < 4; component += 1)
          rotation[component] += (sampledRotation[component] ?? IDENTITY_QUAT[component]) * sample.weight * sign;
        const sampledScale = trackSet?.scale ? sampleTrackValue(trackSet.scale, sample.timeSeconds, value, { wrapSeconds }) : ONE_VEC3;
        for (let component = 0; component < 3; component += 1)
          scale[component] += (sampledScale[component] ?? 1) * sample.weight;
        overrideWeight += sample.weight;
      }
      if (overrideWeight > 0) {
        for (let component = 0; component < 3; component += 1) {
          translation[component] /= overrideWeight;
          scale[component] /= overrideWeight;
        }
        normalizeQuaternionInPlace(rotation);
      } else {
        translation.splice(0, 3, 0, 0, 0);
        rotation.splice(0, 4, 0, 0, 0, 1);
        scale.splice(0, 3, 1, 1, 1);
      }
      for (const sample of active) {
        if (!sample.additive)
          continue;
        const trackSet = this.trackSets(sample.sequence)[boneIndex];
        const wrapSeconds = trackSet?.concurrent ? trackSet.wrapSeconds : void 0;
        if (trackSet?.translation) {
          const sampled = sampleTrackValue(trackSet.translation, sample.timeSeconds, value, {
            wrapSeconds
          });
          for (let component = 0; component < 3; component += 1)
            translation[component] += (sampled[component] ?? 0) * sample.weight;
        }
        if (trackSet?.scale) {
          const sampled = sampleTrackValue(trackSet.scale, sample.timeSeconds, value, {
            wrapSeconds
          });
          for (let component = 0; component < 3; component += 1)
            scale[component] *= 1 + ((sampled[component] ?? 1) - 1) * sample.weight;
        }
        if (trackSet?.rotation) {
          const sampled = sampleTrackValue(trackSet.rotation, sample.timeSeconds, value, {
            wrapSeconds,
            isQuat: true
          });
          const delta = [];
          slerpVector(IDENTITY_QUAT, sampled, Math.min(1, sample.weight), delta);
          multiplyQuaternionInPlace(rotation, delta);
        }
      }
      composeTrsMatrix(this.local, 0, translation, rotation, scale);
      const parentIndex = bone.parentIndex;
      if (parentIndex >= 0 && parentIndex < boneIndex) {
        multiplyMat4(this.world, boneIndex * 16, this.world, parentIndex * 16, this.local, 0);
      } else {
        this.world.set(this.local, boneIndex * 16);
      }
      const inverseBind = bone.inverseBindMatrix;
      if (inverseBind && inverseBind.length === 16) {
        multiplyMat4(this.skinning, boneIndex * 16, this.world, boneIndex * 16, inverseBind, 0);
      } else {
        this.skinning.set(this.world.subarray(boneIndex * 16, boneIndex * 16 + 16), boneIndex * 16);
      }
    }
    return { world: this.world, skinning: this.skinning };
  }
};
function quaternionDot(left, right) {
  return (left[0] ?? 0) * (right[0] ?? 0) + (left[1] ?? 0) * (right[1] ?? 0) + (left[2] ?? 0) * (right[2] ?? 0) + (left[3] ?? 1) * (right[3] ?? 1);
}
function normalizeQuaternionInPlace(value) {
  const length = Math.hypot(value[0], value[1], value[2], value[3]) || 1;
  for (let component = 0; component < 4; component += 1)
    value[component] /= length;
}
function multiplyQuaternionInPlace(left, right) {
  const [ax, ay, az, aw] = left;
  const [bx = 0, by = 0, bz = 0, bw = 1] = right;
  left[0] = aw * bx + ax * bw + ay * bz - az * by;
  left[1] = aw * by - ax * bz + ay * bw + az * bx;
  left[2] = aw * bz + ax * by - ay * bx + az * bw;
  left[3] = aw * bw - ax * bx - ay * by - az * bz;
  normalizeQuaternionInPlace(left);
}

// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/model/animation.js
var DEFAULT_MODEL_ANIMATION_BUDGET = Object.freeze({
  maxDepth: 64,
  maxNodes: 1e6,
  maxBytes: 134217728
});
function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError(`${label} must be finite`);
}
function snapshotModelAnimations(value, budget = DEFAULT_MODEL_ANIMATION_BUDGET, signal) {
  const clips = snapshotJson(value, budget, signal);
  if (!Array.isArray(clips))
    throw new TypeError("model animations must be an array");
  const ids = /* @__PURE__ */ new Set();
  for (const clip of clips) {
    if (clip === null || typeof clip !== "object" || typeof clip.id !== "string" || !clip.id || ids.has(clip.id)) {
      throw new TypeError("animation clip needs a unique id");
    }
    ids.add(clip.id);
    if (typeof clip.name !== "string" || !["animation", "rest-pose"].includes(clip.kind) || !["direct", "companion"].includes(clip.provenance) || !Number.isSafeInteger(clip.frames) || clip.frames < 0 || !Array.isArray(clip.channels))
      throw new TypeError("invalid animation clip");
    if (clip.durationSeconds !== void 0) {
      finite(clip.durationSeconds, "clip duration");
      if (clip.durationSeconds < 0)
        throw new TypeError("negative clip duration");
    }
    if (clip.looping !== void 0 && typeof clip.looping !== "boolean")
      throw new TypeError("invalid clip looping");
    if (clip.repeatCount !== void 0 && (!Number.isSafeInteger(clip.repeatCount) || clip.repeatCount < 0))
      throw new TypeError("invalid clip repeat count");
    if (clip.sequenceIndex !== void 0 && (!Number.isSafeInteger(clip.sequenceIndex) || clip.sequenceIndex < 0))
      throw new TypeError("invalid animation material sequence index");
    if (clip.movementSpeed !== void 0)
      finite(clip.movementSpeed, "clip movement speed");
    if (clip.boundsSphere !== void 0) {
      if (!Array.isArray(clip.boundsSphere.center) || clip.boundsSphere.center.length !== 3)
        throw new TypeError("invalid clip bounds");
      for (const component of clip.boundsSphere.center)
        finite(component, "clip bounds center");
      finite(clip.boundsSphere.radius, "clip bounds radius");
      if (clip.boundsSphere.radius < 0)
        throw new TypeError("negative clip bounds radius");
    }
    for (const channel of clip.channels) {
      if (channel === null || typeof channel !== "object" || typeof channel.target !== "string" || typeof channel.kind !== "string")
        throw new TypeError("invalid animation channel");
      if (channel.concurrent !== void 0 && typeof channel.concurrent !== "boolean")
        throw new TypeError("invalid concurrent flag");
      if (channel.wrapSeconds !== void 0) {
        finite(channel.wrapSeconds, "channel wrap");
        if (channel.wrapSeconds <= 0 || channel.concurrent !== true)
          throw new TypeError("invalid independent channel wrap");
      }
      if (channel.repeatCount !== void 0 && (!Number.isSafeInteger(channel.repeatCount) || channel.repeatCount < 0 || channel.concurrent !== true || channel.wrapSeconds === void 0))
        throw new TypeError("invalid independent channel repeat count");
      if (channel.samples !== void 0 && !Array.isArray(channel.samples))
        throw new TypeError("invalid animation samples");
      if (channel.interpolation === void 0)
        continue;
      if (!["step", "linear", "spherical-linear", "cubic-spline"].includes(channel.interpolation) || !channel.samples?.length) {
        throw new TypeError("sampleable channel needs interpolation and keys");
      }
      let previous = -Infinity;
      let components;
      for (const sample of channel.samples) {
        finite(sample.timeSeconds, "key time");
        if (sample.timeSeconds < previous)
          throw new TypeError("animation keys are not ordered");
        previous = sample.timeSeconds;
        if (!Array.isArray(sample.value) || sample.value.length === 0)
          throw new TypeError("empty animation key");
        components ??= sample.value.length;
        if (components !== sample.value.length || channel.interpolation === "spherical-linear" && components !== 4) {
          throw new TypeError("inconsistent animation key components");
        }
        for (const component of sample.value)
          finite(component, "key component");
        if (channel.interpolation === "cubic-spline") {
          for (const tangent of [sample.inTangent, sample.outTangent]) {
            if (!Array.isArray(tangent) || tangent.length !== components)
              throw new TypeError("cubic-spline keys need in and out tangents of the key width");
            for (const component of tangent)
              finite(component, "key tangent");
          }
        }
      }
    }
  }
  return clips;
}
var MAX_EVENT_OCCURRENCES = 4096;
function clipEventsBetween(clip, fromSeconds, toSeconds) {
  if (!Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds))
    throw new TypeError("event window must be finite");
  if ((clip.events?.length ?? 0) === 0 || !(toSeconds > fromSeconds))
    return [];
  const mode = clip.loop ?? (clip.looping === true ? "loop" : "once");
  const duration = clip.durationSeconds ?? 0;
  const period = mode === "loop" ? duration : mode === "ping-pong" ? 2 * duration : 0;
  const found = [];
  for (const event of clip.events ?? []) {
    const back = 2 * duration - event.timeSeconds;
    const times = mode === "ping-pong" && back !== event.timeSeconds ? [event.timeSeconds, back] : [event.timeSeconds];
    for (const time of times) {
      if (!(period > 0)) {
        if (fromSeconds < time && time <= toSeconds)
          found.push({ event, atSeconds: time });
        continue;
      }
      for (let at = time + (Math.floor((fromSeconds - time) / period) + 1) * period; at <= toSeconds && found.length < MAX_EVENT_OCCURRENCES; at += period)
        if (at > fromSeconds)
          found.push({ event, atSeconds: at });
    }
  }
  return found.sort((left, right) => left.atSeconds - right.atSeconds);
}
function createModelAnimationSampler(clip, budget, signal) {
  const owned = snapshotModelAnimations([clip], budget, signal)[0];
  const tracks = owned.channels.map((channel) => {
    if (channel.interpolation === void 0 || channel.samples === void 0)
      throw new TypeError("channel has no sampling semantics");
    const track = {
      lineType: channel.interpolation === "step" ? 0 : channel.interpolation === "cubic-spline" ? CUBIC_SPLINE_LINE_TYPE : 1,
      globalSeqId: null,
      keys: channel.samples.map((key) => ({
        frame: key.timeSeconds,
        vector: key.value,
        ...key.inTangent === void 0 ? {} : { inTan: key.inTangent },
        ...key.outTangent === void 0 ? {} : { outTan: key.outTangent }
      }))
    };
    return { channel, track };
  });
  return Object.freeze({
    sample(timeSeconds, requestSignal) {
      if (requestSignal?.aborted)
        throw new DOMException("operation cancelled", "AbortError");
      finite(timeSeconds, "sample time");
      return Object.freeze(tracks.map(({ channel, track }) => {
        if (requestSignal?.aborted)
          throw new DOMException("operation cancelled", "AbortError");
        return Object.freeze({
          target: channel.target,
          kind: channel.kind,
          ...channel.axis === void 0 ? {} : { axis: channel.axis },
          value: Object.freeze(sampleTrackValue(track, timeSeconds, [], {
            isQuat: channel.interpolation === "spherical-linear",
            wrapSeconds: channel.concurrent ? channel.wrapSeconds : void 0
          }))
        });
      }));
    }
  });
}

export {
  CUBIC_SPLINE_LINE_TYPE,
  sampleTrackValue,
  composeTrsMatrix,
  multiplyMat4,
  SequencePoseSampler,
  DEFAULT_MODEL_ANIMATION_BUDGET,
  snapshotModelAnimations,
  clipEventsBetween,
  createModelAnimationSampler
};
