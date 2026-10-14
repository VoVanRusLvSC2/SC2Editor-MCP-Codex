import {nativeLayerColor, nativeLayerFresnel, nativeCombineLayer, nativeMaterialMath} from "./native-material-math.js";
import {
  linearToSrgb,
  snapshotModelMaterials,
  srgbToLinear
} from "./chunk-F2AHXGNP.js";
import {
  composeTrsMatrix,
  sampleTrackValue
} from "./chunk-YOY7WCCG.js";
import {
  snapshotJson
} from "./chunk-TUJSTS7T.js";
import {
  decomposeMatrix4,
  invertAffine,
  multiplyAffine,
  normalizeQuat,
  quaternionFromRotationMatrix
} from "./chunk-YCSZRBWM.js";

// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/legacy/core/errors.js
var ModkitError = class _ModkitError extends Error {
  code;
  context;
  hint;
  constructor(opts) {
    super(opts.message, opts.cause !== void 0 ? { cause: opts.cause } : void 0);
    this.name = "ModkitError";
    this.code = opts.code;
    this.context = opts.context;
    this.hint = opts.hint;
    Object.setPrototypeOf(this, _ModkitError.prototype);
  }
};

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/legacy/container-kernels.js
var GLB_MAGIC = 1179937895;
var GLB_JSON_CHUNK = 1313821514;
var GLB_BIN_CHUNK = 5130562;
function decodeUvmContainer(bytes) {
  if (isGlb(bytes))
    return decodeGlb(bytes);
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("root");
    return { document: parsed, binary: new Uint8Array() };
  } catch (cause) {
    throw new ModkitError({
      code: "PARSE_FAILED",
      message: "UVM input is neither a valid GLB nor a JSON glTF document.",
      cause
    });
  }
}
function isGlb(bytes) {
  return bytes.length >= 12 && readUint32(bytes, 0) === GLB_MAGIC;
}
function decodeGlb(bytes) {
  if (readUint32(bytes, 4) !== 2)
    throw corrupt("Only GLB version 2 is supported.");
  const declaredLength = readUint32(bytes, 8);
  if (declaredLength !== bytes.length)
    throw corrupt("GLB declared length does not match input.");
  if (bytes.length < 20 || readUint32(bytes, 16) !== GLB_JSON_CHUNK) {
    throw corrupt("GLB JSON chunk is missing or not first.");
  }
  const jsonLength = readUint32(bytes, 12);
  const jsonEnd = 20 + jsonLength;
  if (jsonEnd > bytes.length)
    throw corrupt("GLB JSON chunk exceeds the input length.");
  let document;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, jsonEnd)).trimEnd();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("root");
    document = parsed;
  } catch (cause) {
    throw new ModkitError({
      code: "PARSE_FAILED",
      message: "UVM GLB JSON chunk is invalid.",
      cause
    });
  }
  if (jsonEnd === bytes.length)
    return { document, binary: new Uint8Array() };
  if (jsonEnd + 8 > bytes.length || readUint32(bytes, jsonEnd + 4) !== GLB_BIN_CHUNK) {
    throw corrupt("UVM GLB contains an invalid second chunk.");
  }
  const binLength = readUint32(bytes, jsonEnd);
  const binStart = jsonEnd + 8;
  if (binStart + binLength !== bytes.length)
    throw corrupt("GLB BIN chunk length is invalid.");
  return { document, binary: bytes.slice(binStart, binStart + binLength) };
}
function readUint32(bytes, offset) {
  if (offset + 4 > bytes.length)
    throw corrupt("GLB header is truncated.");
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}
function corrupt(message) {
  return new ModkitError({ code: "PARSE_FAILED", message });
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/container.js
var GLB_MAGIC2 = 1179937895;
var JSON_CHUNK = 1313821514;
var BIN_CHUNK = 5130562;
var encoder = new TextEncoder();
var DEFAULT_UVM_CONTAINER_BUDGET = Object.freeze({
  maxInputBytes: 268435456,
  maxJsonBytes: 67108864,
  maxDepth: 128,
  maxNodes: 1e6
});
function checkUvmContainerBudget(budget) {
  for (const value of [budget.maxInputBytes, budget.maxJsonBytes, budget.maxDepth, budget.maxNodes])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError("invalid UVM container budget");
}
function readUvmContainer(bytes, budget = DEFAULT_UVM_CONTAINER_BUDGET, signal) {
  checkUvmContainerBudget(budget);
  if (signal?.aborted)
    throw new DOMException("operation cancelled", "AbortError");
  if (bytes.byteLength > budget.maxInputBytes)
    throw new RangeError("UVM exceeds maxInputBytes");
  bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = isGlb(bytes) ? "glb" : "gltf";
  const extraChunks = [];
  let primary = bytes;
  if (format === "glb") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8, true) !== bytes.byteLength || view.getUint32(4, true) !== 2)
      throw new TypeError("invalid GLB version or declared length");
    let cursor = 12;
    let count = 0;
    let primaryEnd = 12;
    while (cursor < bytes.length) {
      if (cursor + 8 > bytes.length)
        throw new TypeError("truncated GLB chunk header");
      const length = view.getUint32(cursor, true);
      const type = view.getUint32(cursor + 4, true);
      const end = cursor + 8 + length;
      if (length % 4 !== 0 || end > bytes.length)
        throw new TypeError("invalid GLB chunk length or alignment");
      if (count === 0 && type !== JSON_CHUNK)
        throw new TypeError("GLB JSON chunk must be first");
      if (type === JSON_CHUNK) {
        if (count !== 0)
          throw new TypeError("duplicate GLB JSON chunk");
        if (length > budget.maxJsonBytes)
          throw new RangeError("UVM exceeds maxJsonBytes");
        primaryEnd = end;
      } else if (type === BIN_CHUNK) {
        if (count !== 1)
          throw new TypeError("GLB BIN chunk must be second and unique");
        primaryEnd = end;
      } else {
        extraChunks.push(Object.freeze({ type, bytes: bytes.slice(cursor + 8, end) }));
      }
      cursor = end;
      count++;
      if (count > budget.maxNodes)
        throw new RangeError("GLB chunk count exceeds maxNodes");
    }
    if (extraChunks.length > 0) {
      primary = bytes.slice(0, primaryEnd);
      new DataView(primary.buffer, primary.byteOffset, primary.byteLength).setUint32(8, primary.byteLength, true);
    }
  } else if (bytes.byteLength > budget.maxJsonBytes)
    throw new RangeError("UVM exceeds maxJsonBytes");
  const decoded = decodeUvmContainer(primary);
  const document = snapshotJson(decoded.document, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes }, signal);
  return Object.freeze({
    format,
    document,
    binary: decoded.binary,
    extraChunks: Object.freeze(extraChunks)
  });
}
function writeUvmContainer(container, budget = DEFAULT_UVM_CONTAINER_BUDGET, signal) {
  checkUvmContainerBudget(budget);
  if (container.format !== "glb" && container.format !== "gltf")
    throw new TypeError("invalid UVM container format");
  if (container.extraChunks.length > budget.maxNodes)
    throw new RangeError("GLB chunk count exceeds maxNodes");
  const document = snapshotJson(container.document, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes }, signal);
  const jsonBytes = encoder.encode(JSON.stringify(document));
  const length = container.format === "gltf" ? jsonBytes.byteLength : 28 + Math.ceil(jsonBytes.byteLength / 4) * 4 + Math.ceil(container.binary.byteLength / 4) * 4 + container.extraChunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.length, 0);
  if (length > budget.maxInputBytes || length > 4294967295)
    throw new RangeError("UVM output exceeds maxInputBytes");
  if (container.format === "gltf") {
    if (container.binary.byteLength || container.extraChunks.length)
      throw new TypeError("JSON glTF cannot carry unbound binary chunks");
    return jsonBytes;
  }
  for (const chunk of container.extraChunks)
    if (!Number.isSafeInteger(chunk.type) || chunk.type < 0 || chunk.type > 4294967295 || chunk.type === JSON_CHUNK || chunk.type === BIN_CHUNK || chunk.bytes.length % 4 !== 0)
      throw new TypeError("invalid opaque GLB chunk");
  const standard2 = packSerializedUvmGlb(jsonBytes, container.binary);
  if (container.extraChunks.length === 0)
    return standard2;
  const parts = [standard2];
  for (const chunk of container.extraChunks)
    parts.push(le32(chunk.bytes.length), le32(chunk.type), chunk.bytes);
  const result = concat(parts);
  new DataView(result.buffer).setUint32(8, result.byteLength, true);
  return result;
}
function le32(value) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}
function pad4(bytes, fill) {
  const result = new Uint8Array(bytes.byteLength + 3 & ~3);
  result.fill(fill);
  result.set(bytes);
  return result;
}
function concat(parts) {
  const total = parts.reduce((size, part) => size + part.byteLength, 0);
  const result = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    result.set(part, cursor);
    cursor += part.byteLength;
  }
  return result;
}
function packUvmGlb(document, binary) {
  return packSerializedUvmGlb(encoder.encode(JSON.stringify(document)), binary);
}
function packSerializedUvmGlb(jsonBytes, binary) {
  const json = pad4(jsonBytes, 32);
  const bin = pad4(binary, 0);
  const length = 12 + 8 + json.byteLength + 8 + bin.byteLength;
  return concat([
    le32(GLB_MAGIC2),
    le32(2),
    le32(length),
    le32(json.byteLength),
    le32(JSON_CHUNK),
    json,
    le32(bin.byteLength),
    le32(BIN_CHUNK),
    bin
  ]);
}
var URI_PATH_CHARACTER = /^[A-Za-z0-9\-._~!$&'()*+,;=@/]$/u;
function uvmImageUri(logicalId) {
  let uri = "";
  for (const character of logicalId) {
    if (URI_PATH_CHARACTER.test(character))
      uri += character;
    else
      for (const byte of encoder.encode(character))
        uri += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return uri;
}
function uvmImageLogicalId(uri) {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/legacy/models/material.js
var LAYER_SLOTS = [
  "diffuse",
  "decal",
  "specular",
  "gloss",
  "emissive1",
  "emissive2",
  "emissiveMask",
  "envi",
  "enviMask",
  "alpha1",
  "alpha2",
  "normal",
  "normalBlend1Mask",
  "normalBlend2Mask",
  "normalBlend1",
  "normalBlend2",
  "height",
  "lightMap",
  "ao",
  "teamColorMask",
  "metalness",
  "roughness"
];
function isStandardLayerSlot(value) {
  return LAYER_SLOTS.includes(value);
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/validation/values.js
function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value;
}
function field(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return void 0;
  return value[key];
}
function array(value, key) {
  const candidate = field(value, key);
  return Array.isArray(candidate) ? candidate : [];
}
function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function integer(value) {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function finiteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every(finite);
}
function oneOf(value, values) {
  return typeof value === "string" && values.includes(value);
}
function safeIndex(value, length, label) {
  if (!integer(value) || value < 0 || value >= length)
    throw new RangeError(`${label} index is outside the UVM document`);
  return value;
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/animation-materials.js
var layerWidths = {
  constantColor: 4,
  colorMultiply: 1,
  colorAdd: 1,
  alphaFactor: 1,
  uvOffset: 2,
  uvAngle: 3,
  uvTiling: 2,
  uvTriplanarOffset: 3,
  uvTriplanarScale: 3
};
var ordinal = "(?:0|[1-9]\\d*)";
var standard = `(?:standard|composite/passes/${ordinal}/material)`;
var layerPath = new RegExp(`^/renderModel/${standard}/layers/([^/]+)/(.*)$`, "u");
var scalarPath = new RegExp(`^/renderModel/(?:${standard}/(?:parallaxHeight|normalBlendFactors/[0-7])|composite/passes/${ordinal}/alphaFactor)$`, "u");
function uvmAnimationMaterialPropertyWidth(path) {
  if (scalarPath.test(path))
    return 1;
  const layer = layerPath.exec(path);
  if (layer === null || !isStandardLayerSlot(layer[1] ?? ""))
    return void 0;
  const property = layer[2] ?? "";
  return property === "flipbook/frame" ? 1 : Object.hasOwn(layerWidths, property) ? layerWidths[property] : void 0;
}
function vector(value, width, scalar = false) {
  if (scalar && width === 1 && typeof value === "number" && Number.isFinite(Math.fround(value)))
    return value;
  if (!Array.isArray(value) || value.length !== width || value.some((item) => typeof item !== "number" || !Number.isFinite(Math.fround(item))))
    throw new TypeError("animation material values must match a finite float32 property width");
  return Object.freeze(Array.from(value, (item) => Number(item)));
}
function readTargets(value, signal) {
  if (value === void 0)
    return [];
  if (!Array.isArray(value))
    throw new TypeError("animation materialTargets must be an array");
  const ids = /* @__PURE__ */ new Set();
  return Object.freeze(value.map((candidate) => {
    signal?.throwIfAborted();
    const item = object(candidate, "animation material target");
    const id = item["id"];
    if (typeof id !== "string" || !id.trim() || ids.has(id) || !Array.isArray(item["properties"]))
      throw new TypeError("animation material target requires a unique id and properties");
    ids.add(id);
    const paths = /* @__PURE__ */ new Set();
    const properties = item["properties"].map((candidate2) => {
      const property = object(candidate2, "animation material property");
      const path = property["path"];
      const width = typeof path === "string" ? uvmAnimationMaterialPropertyWidth(path) : void 0;
      if (typeof path !== "string" || width === void 0 || paths.has(path) || !Array.isArray(property["sequenceTracks"]) || property["sequenceTracks"].length === 0)
        throw new TypeError("animation material property requires a unique published path and sequenceTracks");
      paths.add(path);
      const value2 = vector(property["value"], width, true);
      const sequences = /* @__PURE__ */ new Set();
      const sequenceTracks = property["sequenceTracks"].map((candidate3) => {
        signal?.throwIfAborted();
        const sequence = object(candidate3, "animation material sequence track");
        const index2 = sequence["sequenceIndex"];
        if (!integer(index2) || index2 < 0 || index2 > 4294967295 || sequences.has(index2))
          throw new TypeError("invalid animation material sequence index");
        sequences.add(index2);
        const concurrent = sequence["concurrent"], wrap = sequence["wrapSeconds"];
        if (concurrent !== void 0 && typeof concurrent !== "boolean" || (wrap !== void 0 || concurrent === true) && (typeof wrap !== "number" || !Number.isFinite(wrap) || wrap <= 0))
          throw new TypeError("invalid animation material concurrent clock");
        const track = object(sequence["track"], "animation material track");
        if (track["lineType"] !== 0 && track["lineType"] !== 1 || track["globalSeqId"] !== null || !Array.isArray(track["keys"]) || track["keys"].length === 0)
          throw new TypeError("animation material track requires supported step/linear keys and explicit sequence clock");
        let previous = -Infinity;
        for (const key of track["keys"]) {
          const keyValue = object(key, "animation material key"), frame = keyValue["frame"];
          if (typeof frame !== "number" || !Number.isFinite(Math.fround(frame)) || frame < previous)
            throw new TypeError("animation material key times must be finite and ordered");
          previous = frame;
          vector(keyValue["vector"], width);
          for (const tangent of ["inTan", "outTan"])
            if (keyValue[tangent] !== void 0)
              vector(keyValue[tangent], width);
        }
        return sequence;
      });
      return Object.freeze({ path, value: value2, sequenceTracks: Object.freeze(sequenceTracks) });
    });
    return Object.freeze({ id, properties: Object.freeze(properties) });
  }));
}
function readUvmAnimationMaterialTargets(document, signal) {
  return readTargets(field(field(document["extensions"], "UV_game_animation_clips"), "materialTargets"), signal);
}
function materializeUvmAnimationMaterialTargets(source, budget = { maxDepth: 128, maxNodes: 1e6, maxBytes: 67108864 }, signal) {
  const materials = snapshotModelMaterials(source, budget, signal);
  const targets = [];
  for (const material of materials) {
    signal?.throwIfAborted();
    if (material.shader?.id !== "modkit.render-material.v1")
      continue;
    const model = object(material.shader.parameters["renderModel"], "animation material render model");
    if (model["version"] !== 1)
      throw new TypeError("unsupported animation material version");
    const properties = [];
    const visit = (value, path, depth) => {
      signal?.throwIfAborted();
      if (depth > budget.maxDepth)
        throw new RangeError("animation material target exceeds maxDepth");
      if (uvmAnimationMaterialPropertyWidth(path) !== void 0 && value !== void 0) {
        const property = object(value, "material animation property");
        if (array(property, "sequenceTracks").length > 0)
          properties.push({
            path,
            value: property["value"],
            sequenceTracks: property["sequenceTracks"]
          });
        return;
      }
      if (Array.isArray(value)) {
        for (const [index2, child] of value.entries())
          visit(child, `${path}/${index2}`, depth + 1);
      } else if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          if (!["extras", "extensions"].includes(key)) {
            const token = key.replace(/~/gu, "~0").replace(/\//gu, "~1");
            visit(child, `${path}/${token}`, depth + 1);
          }
        }
      }
    };
    visit(model, "/renderModel", 0);
    if (properties.length > 0)
      targets.push({ id: material.id, properties });
  }
  return readTargets(snapshotJson(targets, budget, signal), signal);
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/animation-clips.js
var LOOP_MODES = ["once", "loop", "ping-pong", "hold"];
function uvmAnimationPlayback(value) {
  if (value === void 0)
    return {};
  const record4 = object(value, "UV_game_animation_clips of an animation");
  const { loop, priority, speedScale, blendInSeconds, blendOutSeconds } = record4;
  const seconds = (item) => item === void 0 || typeof item === "number" && Number.isFinite(item) && item >= 0;
  if (loop !== void 0 && !LOOP_MODES.includes(loop) || priority !== void 0 && !integer(priority) || speedScale !== void 0 && (typeof speedScale !== "number" || !Number.isFinite(speedScale) || speedScale <= 0) || !seconds(blendInSeconds) || !seconds(blendOutSeconds))
    throw new TypeError("UVM animation playback is invalid");
  return Object.freeze({
    ...loop === void 0 ? {} : { loop },
    ...priority === void 0 ? {} : { priority },
    ...speedScale === void 0 ? {} : { speedScale },
    ...blendInSeconds === void 0 ? {} : { blendInSeconds },
    ...blendOutSeconds === void 0 ? {} : { blendOutSeconds }
  });
}
var EVENT_KEYS = /* @__PURE__ */ new Set(["t", "name", "socket", "payload", "duration"]);
function uvmAnimationEvents(value, nodeCount) {
  if (value === void 0)
    return [];
  const events = object(value, "UV_game_animation_events")["events"];
  if (!Array.isArray(events))
    throw new TypeError("UV_game_animation_events requires events");
  return Object.freeze(events.map((item) => {
    const record4 = object(item, "UVM animation event");
    const { t, name, socket, payload, duration } = record4;
    if (Object.keys(record4).some((key) => !EVENT_KEYS.has(key)) || typeof t !== "number" || !Number.isFinite(t) || t < 0 || typeof name !== "string" || !name || socket !== void 0 && (!integer(socket) || socket < 0 || socket >= nodeCount) || payload !== void 0 && (payload === null || typeof payload !== "object" || Array.isArray(payload)) || duration !== void 0 && (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0))
      throw new TypeError("UVM animation event is invalid");
    return Object.freeze({
      t,
      name,
      ...socket === void 0 ? {} : { socket },
      ...payload === void 0 ? {} : { payload },
      ...duration === void 0 ? {} : { duration }
    });
  }));
}
function readUvmPrimitiveVisibility(document, signal) {
  const value = field(field(document["extensions"], "UV_game_variants"), "visibility");
  if (value === void 0)
    return [];
  if (!Array.isArray(value))
    throw new TypeError("UVM primitive visibility must be an array");
  if (!array(document, "extensionsUsed").includes("UV_game_variants"))
    throw new TypeError("UV_game_variants is not declared in extensionsUsed");
  const meshes = array(document, "meshes");
  const targets = /* @__PURE__ */ new Set();
  return Object.freeze(value.map((candidate) => {
    signal?.throwIfAborted();
    const item = object(candidate, "UVM primitive visibility");
    const scalar = item["value"];
    const nodeBinding = item["binding"] === "batch";
    const target = nodeBinding ? { node: safeIndex(item["node"], array(document, "nodes").length, "visibility node"), binding: "batch" } : (() => {
      const mesh = safeIndex(item["mesh"], meshes.length, "visibility mesh");
      return {
        mesh,
        primitive: safeIndex(item["primitive"], array(meshes[mesh], "primitives").length, "visibility primitive")
      };
    })();
    const key = "node" in target ? `node/${target.node}/batch` : `${target.mesh}/${target.primitive}`;
    if (typeof scalar !== "number" || !Number.isFinite(scalar) || targets.has(key))
      throw new TypeError("UVM visibility requires a finite value and unique primitive target");
    targets.add(key);
    return Object.freeze({ ...target, value: scalar });
  }));
}
function uvmVisibilityPointer(index2) {
  if (!integer(index2) || index2 < 0)
    throw new TypeError("invalid visibility index");
  return `/extensions/UV_game_variants/visibility/${index2}/value`;
}
function uvmVisibilityTarget(pointer, visibility) {
  if (typeof pointer !== "string")
    return void 0;
  const match = /^\/extensions\/UV_game_variants\/visibility\/(0|[1-9]\d*)\/value$/u.exec(pointer);
  if (match === null)
    return void 0;
  return visibility[safeIndex(Number(match[1]), visibility.length, "visibility pointer")];
}
function readUvmAnimationClips(document, signal) {
  signal?.throwIfAborted();
  const value = field(document["extensions"], "UV_game_animation_clips");
  if (value === void 0)
    return void 0;
  const catalog = object(value, "UV_game_animation_clips");
  if (!Array.isArray(catalog["clips"]))
    throw new TypeError("UVM clip catalog requires clips");
  const animations = array(document, "animations");
  const ids = /* @__PURE__ */ new Set(), sequences = /* @__PURE__ */ new Set(), linked = /* @__PURE__ */ new Set();
  const clips = [];
  for (const item of catalog["clips"]) {
    signal?.throwIfAborted();
    const record4 = object(item, "UVM clip catalog entry");
    const id = record4["id"], name = record4["name"], duration = record4["durationSeconds"], sequence = record4["sourceSequenceIndex"];
    if (typeof id !== "string" || !id.trim() || ids.has(id) || typeof name !== "string" || typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || !integer(sequence) || sequence < 0 || sequences.has(sequence))
      throw new TypeError("UVM clip catalog identity, duration or sequence is invalid");
    const sourceId = record4["sourceId"], looping = record4["looping"], repeatCount = record4["repeatCount"], kind = record4["kind"], frames = record4["frames"];
    if (sourceId !== void 0 && (typeof sourceId !== "string" || !sourceId) || looping !== void 0 && typeof looping !== "boolean" || repeatCount !== void 0 && (!integer(repeatCount) || repeatCount < 0) || kind !== void 0 && kind !== "animation" && kind !== "rest-pose" || frames !== void 0 && (!integer(frames) || frames < 0))
      throw new TypeError("UVM clip catalog optional metadata is invalid");
    const animation = record4["animation"] === void 0 ? void 0 : safeIndex(record4["animation"], animations.length, "clip animation");
    if (animation !== void 0) {
      if (linked.has(animation))
        throw new TypeError("UVM animation is linked by multiple clips");
      const target = object(animations[animation], "clip animation");
      uvmAnimationPlayback(field(target["extensions"], "UV_game_animation_clips"));
      uvmAnimationEvents(field(target["extensions"], "UV_game_animation_events"), array(document, "nodes").length);
      if (array(target, "channels").length === 0 || array(target, "samplers").length === 0)
        throw new TypeError("UVM catalog must not link an empty glTF animation");
      const declared = field(field(target["extras"], "uv"), "sourceSequenceIndex");
      if (declared !== void 0 && declared !== sequence)
        throw new TypeError("UVM clip and animation sequence indices disagree");
      linked.add(animation);
    }
    ids.add(id);
    sequences.add(sequence);
    clips.push(Object.freeze({
      id,
      name,
      durationSeconds: duration,
      sourceSequenceIndex: sequence,
      ...animation === void 0 ? {} : { animation },
      ...sourceId === void 0 ? {} : { sourceId },
      ...looping === void 0 ? {} : { looping },
      ...repeatCount === void 0 ? {} : { repeatCount },
      ...kind === void 0 ? {} : { kind },
      ...frames === void 0 ? {} : { frames }
    }));
  }
  for (const [index2, animation] of animations.entries()) {
    const scope = field(field(field(animation, "extras"), "uv"), "effectTrackScope");
    if (!linked.has(index2) && scope !== "absolute" && scope !== "global")
      throw new TypeError("UVM clip catalog omits a selectable glTF animation");
  }
  return Object.freeze(clips);
}
function validateUvmAnimationClips(document, signal) {
  readUvmPrimitiveVisibility(document, signal);
  const clips = readUvmAnimationClips(document, signal);
  const sequences = new Set(clips?.map((clip) => clip.sourceSequenceIndex));
  for (const target of readUvmAnimationMaterialTargets(document, signal))
    for (const property of target.properties)
      for (const track of property.sequenceTracks)
        if (!sequences.has(Number(track["sequenceIndex"])))
          throw new TypeError("animation material target references an absent catalog sequence");
  if (clips !== void 0 && !array(document, "extensionsUsed").includes("UV_game_animation_clips"))
    throw new TypeError("UV_game_animation_clips is not declared in extensionsUsed");
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/validation/textures.js
var channel = (value) => integer(value) && value >= 0 && value <= 255;
function colorKeyOf(value, label) {
  const extension = object(value, label);
  if (Object.keys(extension).some((key) => !["color", "tolerance", "extras"].includes(key)))
    throw new TypeError(`${label} has an unknown property`);
  const color = extension["color"];
  if (!Array.isArray(color) || color.length !== 3 || !color.every(channel))
    throw new TypeError(`${label} color must be three stored 8-bit channels`);
  const tolerance = extension["tolerance"] ?? 0;
  if (!channel(tolerance))
    throw new TypeError(`${label} tolerance must be an integer 0..255`);
  return Object.freeze({
    color: Object.freeze([color[0], color[1], color[2]]),
    tolerance
  });
}
function readUvmTextureColorKeys(document, signal) {
  const keys = /* @__PURE__ */ new Map();
  for (const [index2, candidate] of array(document, "textures").entries()) {
    signal?.throwIfAborted();
    const extension = field(field(candidate, "extensions"), "UV_texture_color_key");
    if (extension !== void 0)
      keys.set(index2, colorKeyOf(extension, `texture ${index2} UV_texture_color_key`));
  }
  return keys;
}
function readUvmTextureAlpha(document, signal) {
  const policies = /* @__PURE__ */ new Map();
  for (const [index2, candidate] of array(document, "textures").entries()) {
    signal?.throwIfAborted();
    const extension = field(field(candidate, "extensions"), "UV_texture_alpha");
    if (extension === void 0)
      continue;
    const label = `texture ${index2} UV_texture_alpha`;
    const alpha = object(extension, label);
    if (Object.keys(alpha).some((key) => key !== "ignoreStoredAlpha" && key !== "extras"))
      throw new TypeError(`${label} has an unknown property`);
    const ignore = alpha["ignoreStoredAlpha"];
    if (typeof ignore !== "boolean")
      throw new TypeError(`${label} ignoreStoredAlpha must be a boolean`);
    policies.set(index2, ignore);
  }
  return policies;
}
function validateTextureColorKeys(document, used, signal) {
  const keys = readUvmTextureColorKeys(document, signal);
  if (keys.size > 0 && !used.includes("UV_texture_color_key"))
    throw new TypeError("UV_texture_color_key is not declared in extensionsUsed");
  if (keys.size === 0 && used.includes("UV_texture_color_key"))
    throw new TypeError("UV_texture_color_key is declared but absent");
  const alpha = readUvmTextureAlpha(document, signal);
  if (alpha.size > 0 && !used.includes("UV_texture_alpha"))
    throw new TypeError("UV_texture_alpha is not declared in extensionsUsed");
  if (alpha.size === 0 && used.includes("UV_texture_alpha"))
    throw new TypeError("UV_texture_alpha is declared but absent");
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/validation/spatial.js
function validateSocketMetadata(document, used, signal) {
  signal?.throwIfAborted();
  let count = 0;
  const ids = /* @__PURE__ */ new Set();
  const axes = ["+x", "-x", "+y", "-y", "+z", "-z"];
  for (const [nodeIndex, candidate] of array(document, "nodes").entries()) {
    signal?.throwIfAborted();
    const node = object(candidate, `node ${nodeIndex}`);
    const candidateSocket = field(node["extensions"], "UV_game_socket");
    if (candidateSocket === void 0)
      continue;
    count += 1;
    const socket = object(candidateSocket, `node ${nodeIndex} UV_game_socket`);
    const id = socket["id"];
    if (id !== void 0 && (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/u.test(id) || ids.has(id)))
      throw new TypeError(`node ${nodeIndex} socket ID is invalid or duplicated`);
    if (typeof id === "string")
      ids.add(id);
    if (!nonBlank(socket["role"]))
      throw new TypeError(`node ${nodeIndex} socket needs a role`);
    if (socket["index"] !== void 0 && (!integer(socket["index"]) || socket["index"] < 0)) {
      throw new RangeError(`node ${nodeIndex} socket index is invalid`);
    }
    if (socket["sourceName"] !== void 0 && typeof socket["sourceName"] !== "string") {
      throw new TypeError(`node ${nodeIndex} socket sourceName is invalid`);
    }
    if (socket["forward"] !== void 0 && !oneOf(socket["forward"], axes)) {
      throw new TypeError(`node ${nodeIndex} socket forward axis is invalid`);
    }
    if (socket["up"] !== void 0 && !oneOf(socket["up"], axes)) {
      throw new TypeError(`node ${nodeIndex} socket up axis is invalid`);
    }
    const candidateIdentity = field(socket["extras"], "modkit");
    const identity2 = candidateIdentity === void 0 ? void 0 : object(candidateIdentity, "socket Modkit identity");
    if (identity2 !== void 0 && (!nonBlank(identity2["id"]) || !nonBlank(identity2["nodeId"]))) {
      throw new TypeError(`node ${nodeIndex} socket Modkit identity is invalid`);
    }
    if (id !== void 0 && identity2 !== void 0 && identity2["id"] !== id) {
      throw new TypeError(`node ${nodeIndex} socket IDs disagree`);
    }
  }
  if (count > 0 && !used.includes("UV_game_socket")) {
    throw new TypeError("UV_game_socket is not declared in extensionsUsed");
  }
  if (count === 0 && used.includes("UV_game_socket")) {
    throw new TypeError("UV_game_socket is declared but absent");
  }
}
function validateCollisionMetadata(document, used, signal) {
  signal?.throwIfAborted();
  const nodes = array(document, "nodes");
  const allowedKinds = [
    "box",
    "sphere",
    "capsule",
    "cylinder",
    "convex-hull",
    "mesh",
    "plane"
  ];
  let extensionCount = 0;
  for (const [nodeIndex, candidate] of nodes.entries()) {
    signal?.throwIfAborted();
    const node = object(candidate, `node ${nodeIndex}`);
    const extension = field(node["extensions"], "UV_game_collision");
    if (extension === void 0)
      continue;
    extensionCount += 1;
    if (!used.includes("UV_game_collision")) {
      throw new TypeError(`node ${nodeIndex} uses undeclared UV_game_collision`);
    }
    const collision = object(extension, `node ${nodeIndex} UV_game_collision`);
    const shapes = array(collision, "shapes");
    if (shapes.length === 0)
      throw new TypeError("UV_game_collision.shapes must not be empty");
    if (collision["role"] !== void 0 && !oneOf(collision["role"], ["physics", "hit", "selection", "footprint", "effect", "vision"])) {
      throw new TypeError(`node ${nodeIndex} has an invalid collision role`);
    }
    for (const [shapeIndex, shapeCandidate] of shapes.entries()) {
      signal?.throwIfAborted();
      const label = `node ${nodeIndex} collision shape ${shapeIndex}`;
      const shape = object(shapeCandidate, label);
      if (!oneOf(shape["kind"], allowedKinds))
        throw new TypeError(`${label} has an invalid kind`);
      if (shape["matrix"] !== void 0 && !finiteArray(shape["matrix"], 16)) {
        throw new TypeError(`${label} has an invalid matrix`);
      }
      if (shape["collisionMask"] !== void 0 && (!integer(shape["collisionMask"]) || shape["collisionMask"] < 0)) {
        throw new TypeError(`${label} has an invalid collisionMask`);
      }
      if (shape["kind"] === "box" && (!finiteArray(shape["size"], 3) || shape["size"].some((value) => value <= 0))) {
        throw new TypeError(`${label} has invalid box extents`);
      }
      if (shape["kind"] === "sphere" && !(finite(shape["radius"]) && shape["radius"] > 0)) {
        throw new TypeError(`${label} has an invalid radius`);
      }
      if ((shape["kind"] === "capsule" || shape["kind"] === "cylinder") && (!(finite(shape["radius"]) && shape["radius"] > 0) || !(finite(shape["height"]) && shape["height"] > 0) || shape["axis"] !== void 0 && !oneOf(shape["axis"], ["x", "y", "z"]))) {
        throw new TypeError(`${label} has invalid dimensions or axis`);
      }
      if (shape["kind"] === "plane" && (!finiteArray(shape["normal"], 3) || Math.hypot(...shape["normal"]) <= 1e-12)) {
        throw new TypeError(`${label} has an invalid normal`);
      }
      if ((shape["kind"] === "convex-hull" || shape["kind"] === "mesh") && !integer(shape["positions"])) {
        throw new TypeError(`${label} has an invalid positions accessor`);
      }
      if (shape["kind"] === "mesh" && !integer(shape["indices"])) {
        throw new TypeError(`${label} has an invalid indices accessor`);
      }
    }
  }
  if (used.includes("UV_game_collision") && extensionCount === 0) {
    throw new TypeError("UV_game_collision is declared but absent from all nodes");
  }
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/validation/effects.js
function validateEffectsMetadata(document, used, signal) {
  signal?.throwIfAborted();
  const extension = field(document["extensions"], "UV_game_effects");
  if (extension === void 0) {
    if (used.includes("UV_game_effects"))
      throw new TypeError("UV_game_effects is declared but absent");
    return;
  }
  if (!used.includes("UV_game_effects")) {
    throw new TypeError("UV_game_effects is not declared in extensionsUsed");
  }
  const effects = object(extension, "UV_game_effects");
  if (effects["profile"] !== void 0 && !oneOf(effects["profile"], ["common", "m3", "mdx", "w3d"])) {
    throw new TypeError("UV_game_effects has an invalid profile");
  }
  if (effects["trackTimeUnit"] !== void 0 && !oneOf(effects["trackTimeUnit"], ["seconds", "milliseconds"])) {
    throw new TypeError("UV_game_effects has an invalid trackTimeUnit");
  }
  const nodes = array(document, "nodes");
  const materials = array(document, "materials");
  if (effects["spaceNode"] !== void 0)
    safeIndex(effects["spaceNode"], nodes.length, "UV_game_effects spaceNode");
  for (const kind of ["particles", "ribbons", "forces", "warps", "projectors"]) {
    const entries = effects[kind];
    if (entries === void 0)
      continue;
    if (!Array.isArray(entries))
      throw new TypeError(`UV_game_effects.${kind} must be an array`);
    for (const [index2, candidate] of entries.entries()) {
      signal?.throwIfAborted();
      const entry = object(candidate, `UV_game_effects ${kind} ${index2}`);
      if (!nonBlank(entry["name"]))
        throw new TypeError(`UV_game_effects ${kind} ${index2} needs a name`);
      safeIndex(entry["node"], nodes.length, `UV_game_effects ${kind} ${index2} node`);
      if (oneOf(kind, ["particles", "ribbons", "projectors"])) {
        safeIndex(entry["material"], materials.length, `UV_game_effects ${kind} ${index2} material`);
      }
      if (entry["maxParticles"] !== void 0 && (!integer(entry["maxParticles"]) || entry["maxParticles"] < 0)) {
        throw new RangeError(`UV_game_effects ${kind} ${index2} maxParticles is invalid`);
      }
      if (entry["lifecycleSize"] !== void 0) {
        const lifecycle = object(entry["lifecycleSize"], `UV_game_effects ${kind} ${index2} lifecycleSize`);
        if (!finiteArray(lifecycle["start"], 3) || !finiteArray(lifecycle["middle"], 3) || !finiteArray(lifecycle["end"], 3) || !finite(lifecycle["timeMiddle"])) {
          throw new TypeError(`UV_game_effects ${kind} ${index2} lifecycleSize is invalid`);
        }
      }
    }
  }
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/accessor.js
var componentBytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
var componentCounts = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16
};
function uvmAccessorWidth(type) {
  return typeof type === "string" && Object.hasOwn(componentCounts, type) ? componentCounts[type] : void 0;
}
function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value;
}
function index(value, length, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= length)
    throw new RangeError(`${label} index is outside the UVM document`);
  return value;
}
function nonnegativeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function readComponent(view, offset, type) {
  if (type === 5121)
    return view.getUint8(offset);
  if (type === 5123)
    return view.getUint16(offset, true);
  if (type === 5125)
    return view.getUint32(offset, true);
  if (type === 5126)
    return view.getFloat32(offset, true);
  throw new TypeError(`unsupported UVM accessor component type ${String(type)}`);
}
function readUvmAccessor(document, binary, accessorIndex, budget, purpose, signal) {
  signal?.throwIfAborted();
  if (!nonnegativeInteger(budget.maxScalarBytes))
    throw new TypeError("invalid UVM scalar budget");
  const accessors = Array.isArray(document["accessors"]) ? document["accessors"] : [];
  const bufferViews = Array.isArray(document["bufferViews"]) ? document["bufferViews"] : [];
  const accessor = record(accessors[index(accessorIndex, accessors.length, purpose)], purpose);
  if (accessor["sparse"] !== void 0)
    throw new TypeError(`${purpose} sparse accessors are not supported`);
  const count = accessor["count"];
  const type = accessor["type"];
  const componentType = accessor["componentType"];
  const width = uvmAccessorWidth(type);
  const bytesPerComponent = typeof componentType === "number" ? componentBytes[componentType] : void 0;
  if (!nonnegativeInteger(count) || width === void 0 || bytesPerComponent === void 0 || typeof componentType !== "number")
    throw new TypeError(`${purpose} accessor shape is invalid`);
  const bufferView = record(bufferViews[index(accessor["bufferView"], bufferViews.length, `${purpose} bufferView`)], `${purpose} bufferView`);
  if ((bufferView["buffer"] ?? 0) !== 0)
    throw new TypeError(`${purpose} references an external buffer`);
  const viewOffset = bufferView["byteOffset"] ?? 0;
  const accessorOffset = accessor["byteOffset"] ?? 0;
  const elementBytes = width * bytesPerComponent;
  const stride = bufferView["byteStride"] ?? elementBytes;
  const viewLength = bufferView["byteLength"];
  if (!nonnegativeInteger(viewOffset) || !nonnegativeInteger(accessorOffset) || !nonnegativeInteger(viewLength) || !nonnegativeInteger(stride) || stride < elementBytes)
    throw new TypeError(`${purpose} buffer view range is invalid`);
  const scalarCount = count * width;
  if (!Number.isSafeInteger(scalarCount * 4) || scalarCount * 4 > budget.maxScalarBytes)
    throw new RangeError(`${purpose} exceeds maxScalarBytes budget`);
  const start = viewOffset + accessorOffset;
  const end = count === 0 ? start : start + (count - 1) * stride + elementBytes;
  const viewEnd = viewOffset + viewLength;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(viewEnd) || start < viewOffset || end > viewEnd || viewEnd > binary.byteLength)
    throw new RangeError(`${purpose} accessor exceeds the UVM BIN chunk`);
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const values = purpose === "indices" ? new Uint32Array(scalarCount) : new Float32Array(scalarCount);
  for (let item = 0; item < count; item++) {
    if (item % 4096 === 0)
      signal?.throwIfAborted();
    const itemOffset = start + item * stride;
    for (let component = 0; component < width; component++)
      values[item * width + component] = readComponent(view, itemOffset + component * bytesPerComponent, componentType);
  }
  return Object.freeze({
    values,
    count,
    width,
    componentType,
    normalized: accessor["normalized"] === true
  });
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/key-times.js
function readUvmKeyTimes(value, input, signal) {
  if (value === void 0)
    return void 0;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("invalid UVM keyTimes metadata");
  const record4 = value;
  if (record4["version"] !== 1 || Object.keys(record4).some((key) => !["version", "seconds"].includes(key)) || !Array.isArray(record4["seconds"]) || !record4["seconds"].length)
    throw new TypeError("UVM keyTimes requires version 1 and seconds");
  const seconds = record4["seconds"];
  if (input !== void 0 && (seconds.length !== input.values.length || seconds.length * 8 > input.maxScalarBytes))
    throw new RangeError("UVM keyTimes count or scalar budget mismatch");
  let previous = -Infinity;
  for (let index2 = 0; index2 < seconds.length; index2++) {
    signal?.throwIfAborted();
    const time = seconds[index2];
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0 || time <= previous || input !== void 0 && Math.fround(time) !== input.values[index2])
      throw new TypeError("UVM keyTimes must increase and match the input accessor");
    previous = time;
  }
  return seconds;
}
function uvmKeyTimesMetadata(seconds) {
  return seconds.some((time) => Math.fround(time) !== time) ? { keyTimes: { version: 1, seconds: [...seconds] } } : {};
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/validation/animation.js
function validateAnimationPointers(document, used, signal) {
  signal?.throwIfAborted();
  let count = 0;
  const accessors = array(document, "accessors");
  for (const [animationIndex, candidate] of array(document, "animations").entries()) {
    signal?.throwIfAborted();
    const animation = object(candidate, `animation ${animationIndex}`);
    const samplers = array(animation, "samplers");
    const animationUv = field(animation["extras"], "uv") === void 0 ? void 0 : object(field(animation["extras"], "uv"), `animation ${animationIndex} extras.uv`);
    const scope = animationUv?.["effectTrackScope"];
    const hasGlobalSeqId = Object.prototype.hasOwnProperty.call(animationUv ?? {}, "globalSeqId");
    if (scope !== void 0 && scope !== "global" && scope !== "absolute") {
      throw new TypeError(`animation ${animationIndex} effect track scope is invalid`);
    }
    if (scope === "global" && (!integer(animationUv?.["globalSeqId"]) || animationUv?.["globalSeqId"] < 0)) {
      throw new TypeError(`animation ${animationIndex} globalSeqId is invalid or missing`);
    }
    if (scope !== "global" && hasGlobalSeqId) {
      throw new TypeError(`animation ${animationIndex} globalSeqId needs global scope`);
    }
    if (animationUv?.["sourceSequenceIndex"] !== void 0 && (!integer(animationUv["sourceSequenceIndex"]) || animationUv["sourceSequenceIndex"] < 0)) {
      throw new TypeError(`animation ${animationIndex} sourceSequenceIndex is invalid`);
    }
    const targets = /* @__PURE__ */ new Set();
    for (const [channelIndex, channelCandidate] of array(animation, "channels").entries()) {
      signal?.throwIfAborted();
      const channel2 = object(channelCandidate, `animation ${animationIndex} channel ${channelIndex}`);
      const target = object(channel2["target"], `animation ${animationIndex} channel target`);
      const exactTimes = readUvmKeyTimes(field(field(channel2["extras"], "uv"), "keyTimes"), void 0, signal);
      if (exactTimes !== void 0) {
        const timeSampler = object(samplers[safeIndex(channel2["sampler"], samplers.length, "keyTimes sampler")], "keyTimes sampler");
        const timeAccessor = object(accessors[safeIndex(timeSampler["input"], accessors.length, "keyTimes accessor")], "keyTimes accessor");
        if (timeAccessor["count"] !== exactTimes.length || timeAccessor["type"] !== "SCALAR" || timeAccessor["componentType"] !== 5126)
          throw new TypeError("UVM keyTimes accessor shape mismatch");
      }
      const extension = field(target["extensions"], "KHR_animation_pointer");
      if (target["path"] !== "pointer" && extension === void 0)
        continue;
      count += 1;
      const samplerIndex = safeIndex(channel2["sampler"], samplers.length, `animation ${animationIndex} pointer sampler`);
      const sampler = object(samplers[samplerIndex], `animation ${animationIndex} pointer sampler`);
      const pointer = object(extension, `animation ${animationIndex} KHR_animation_pointer`);
      const pointerPath = pointer["pointer"];
      if (!safeAnimationPointer(pointerPath))
        throw new TypeError(`animation ${animationIndex} pointer target is unsafe or unresolved`);
      const targetValue = resolvePointer(document, pointerPath);
      if (target["path"] !== "pointer" || targetValue === void 0) {
        throw new TypeError(`animation ${animationIndex} pointer target is unsafe or unresolved`);
      }
      if (targets.has(pointerPath)) {
        throw new TypeError(`animation ${animationIndex} pointer target is duplicated`);
      }
      targets.add(pointerPath);
      const interpolation = sampler["interpolation"] ?? "LINEAR";
      if (!oneOf(interpolation, ["STEP", "LINEAR", "CUBICSPLINE"])) {
        throw new TypeError(`animation ${animationIndex} pointer interpolation is invalid`);
      }
      const channelUv = field(channel2["extras"], "uv") === void 0 ? void 0 : object(field(channel2["extras"], "uv"), `animation ${animationIndex} channel extras.uv`);
      const sourceLineType = channelUv?.["sourceLineType"];
      if (sourceLineType !== void 0 && (!integer(sourceLineType) || sourceLineType < 0 || sourceLineType > 3)) {
        throw new TypeError(`animation ${animationIndex} pointer sourceLineType is invalid`);
      }
      if (interpolation === "STEP" && sourceLineType !== void 0 && sourceLineType !== 0 || interpolation === "LINEAR" && sourceLineType !== void 0 && sourceLineType !== 1 || interpolation === "CUBICSPLINE" && sourceLineType !== void 0 && sourceLineType !== 2 && sourceLineType !== 3) {
        throw new TypeError(`animation ${animationIndex} pointer sourceLineType does not match interpolation`);
      }
      const inputIndex = safeIndex(sampler["input"], accessors.length, `animation ${animationIndex} pointer input`);
      const outputIndex = safeIndex(sampler["output"], accessors.length, `animation ${animationIndex} pointer output`);
      const input = object(accessors[inputIndex], `animation ${animationIndex} pointer input`);
      const output = object(accessors[outputIndex], `animation ${animationIndex} pointer output`);
      const targetWidth = finite(targetValue) ? 1 : Array.isArray(targetValue) && targetValue.length > 0 && targetValue.length <= 4 && targetValue.every(finite) ? targetValue.length : void 0;
      const multiplier = interpolation === "CUBICSPLINE" ? 3 : 1;
      if (targetWidth === void 0 || input["normalized"] === true || output["normalized"] === true || input["componentType"] !== 5126 || input["type"] !== "SCALAR" || !integer(input["count"]) || input["count"] <= 0 || output["componentType"] !== 5126 || uvmAccessorWidth(output["type"]) !== targetWidth || output["count"] !== input["count"] * multiplier) {
        throw new TypeError(`animation ${animationIndex} pointer accessor shape is invalid`);
      }
    }
  }
  if (count > 0 && !used.includes("KHR_animation_pointer")) {
    throw new TypeError("KHR_animation_pointer is not declared in extensionsUsed");
  }
  if (count === 0 && used.includes("KHR_animation_pointer")) {
    throw new TypeError("KHR_animation_pointer is declared but absent");
  }
}
function safeAnimationPointer(pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/") || pointer.includes("\0") || /~(?![01])/u.test(pointer))
    return false;
  return !["/buffers", "/bufferViews", "/accessors"].some((prefix) => pointer === prefix || pointer.startsWith(`${prefix}/`));
}
function resolvePointer(root, pointer) {
  let current = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const token = encoded.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(token))
        return void 0;
      const index2 = Number(token);
      if (!integer(index2) || index2 >= current.length)
        return void 0;
      current = current[index2];
    } else if (current !== null && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, token)) {
      current = current[token];
    } else {
      return void 0;
    }
  }
  return current;
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/validation/materials.js
function validateGameMaterialMetadata(document, used, signal) {
  signal?.throwIfAborted();
  let extensionCount = 0;
  for (const [materialIndex, candidate] of array(document, "materials").entries()) {
    signal?.throwIfAborted();
    const material = object(candidate, `material ${materialIndex}`);
    const extension = field(material["extensions"], "UV_game_material");
    if (extension === void 0)
      continue;
    extensionCount += 1;
    const label = `material ${materialIndex} UV_game_material`;
    if (!used.includes("UV_game_material")) {
      throw new TypeError(`${label} is not declared in extensionsUsed`);
    }
    const gameMaterial = object(extension, label);
    if (!nonBlank(gameMaterial["shader"]))
      throw new TypeError(`${label} requires a shader identity`);
    if (gameMaterial["depthWrite"] !== void 0 && typeof gameMaterial["depthWrite"] !== "boolean")
      throw new TypeError(`${label} depthWrite must be boolean`);
    if (gameMaterial["sortPriority"] !== void 0 && !Number.isSafeInteger(gameMaterial["sortPriority"]))
      throw new TypeError(`${label} sortPriority must be an integer`);
    const params = gameMaterial["params"] === void 0 ? {} : object(gameMaterial["params"], `${label} parameters`);
    const snapshot = params["renderModel"];
    if (snapshot === void 0)
      continue;
    const renderModel = object(snapshot, `${label} neutral snapshot`);
    if (renderModel["version"] !== 1) {
      throw new TypeError(`${label} neutral snapshot has an unsupported version`);
    }
    if (renderModel["standard"] === void 0 && renderModel["composite"] === void 0) {
      throw new TypeError(`${label} neutral snapshot has no material payload`);
    }
    if (renderModel["standard"] !== void 0) {
      object(renderModel["standard"], `${label} standard material`);
    }
    if (renderModel["composite"] !== void 0) {
      object(renderModel["composite"], `${label} composite material`);
    }
  }
  if (used.includes("UV_game_material") && extensionCount === 0) {
    throw new TypeError("UV_game_material is declared but absent");
  }
}
var integerIn = (value, minimum, maximum) => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
var unitRgb = (value) => Array.isArray(value) && value.length === 3 && value.every((component) => typeof component === "number" && component >= 0 && component <= 1);
function validateTeamColorRule(teamColor, material, label) {
  const channels = teamColor["keyChannels"];
  if (channels !== void 0 && (!Array.isArray(channels) || channels.length === 0 || channels.some((channel2) => !oneOf(channel2, ["r", "g", "b"])) || new Set(channels).size !== channels.length))
    throw new TypeError(`${label} has invalid keyChannels`);
  if (teamColor["keyThreshold"] !== void 0 && !integerIn(teamColor["keyThreshold"], 0, 255))
    throw new TypeError(`${label} has an invalid keyThreshold`);
  for (const [key, values] of [
    ["intensityChannel", ["r", "g", "b", "a"]],
    ["colorSource", ["team", "object-tint"]],
    ["tint", ["none", "mask-rgb"]]
  ])
    if (teamColor[key] !== void 0 && !oneOf(teamColor[key], [...values]))
      throw new TypeError(`${label} has an invalid ${key}`);
  const scale = teamColor["paletteIndexScale"] ?? 255;
  if (!integerIn(scale, 1, 65535))
    throw new TypeError(`${label} has an invalid paletteIndexScale`);
  const range = teamColor["range"];
  if (range !== void 0 && (!Array.isArray(range) || range.length !== 2 || !integerIn(range[0], 0, scale) || !integerIn(range[1], range[0], scale)))
    throw new TypeError(`${label} has an invalid range`);
  if (teamColor["defaultColor"] !== void 0) {
    const color = teamColor["defaultColor"];
    if (!Array.isArray(color) || color.length !== 4 || !unitRgb(color.slice(0, 3)))
      throw new TypeError(`${label} has an invalid defaultColor`);
  }
  const keyed = teamColor["maskSource"] === "channelKey";
  const ramp = teamColor["ramp"];
  if ((keyed || ramp !== void 0) && teamColor["blend"] !== "replace")
    throw new TypeError(`${label} states a key or a ramp without blend replace`);
  if (keyed && teamColor["maskTexture"] === void 0 && field(material["pbrMetallicRoughness"], "baseColorTexture") === void 0)
    throw new TypeError(`${label} keys no texture`);
  if (ramp !== void 0) {
    const span = Array.isArray(range) ? range[1] - range[0] + 1 : -1;
    if (teamColor["maskSource"] !== "paletteRange" || teamColor["maskTexture"] === void 0 || !Array.isArray(ramp) || ramp.length !== span || !ramp.every(unitRgb))
      throw new TypeError(`${label} has a ramp without its mask, range or one shade per index`);
  }
}
function validateTeamColorMetadata(document, used, signal) {
  signal?.throwIfAborted();
  let extensionCount = 0;
  for (const [materialIndex, candidate] of array(document, "materials").entries()) {
    signal?.throwIfAborted();
    const material = object(candidate, `material ${materialIndex}`);
    const extension = field(material["extensions"], "UV_game_material_team_color");
    if (extension === void 0)
      continue;
    extensionCount += 1;
    const label = `material ${materialIndex} UV_game_material_team_color`;
    if (!used.includes("UV_game_material_team_color")) {
      throw new TypeError(`${label} is not declared in extensionsUsed`);
    }
    const teamColor = object(extension, label);
    if (!oneOf(teamColor["maskSource"], [
      "texture",
      "vertexColor",
      "paletteRange",
      "whole",
      "channelKey"
    ])) {
      throw new TypeError(`${label} has an invalid maskSource`);
    }
    validateTeamColorRule(teamColor, material, label);
    if (teamColor["blend"] !== void 0 && !oneOf(teamColor["blend"], ["multiply", "add", "replace", "overlay", "lerp"])) {
      throw new TypeError(`${label} has an invalid blend`);
    }
    if (teamColor["targets"] !== void 0 && (!Array.isArray(teamColor["targets"]) || teamColor["targets"].length === 0 || teamColor["targets"].some((target) => !oneOf(target, ["baseColor", "emissive", "specular"])) || new Set(teamColor["targets"]).size !== teamColor["targets"].length)) {
      throw new TypeError(`${label} has invalid targets`);
    }
    if (teamColor["strength"] !== void 0 && (!finite(teamColor["strength"]) || teamColor["strength"] < 0)) {
      throw new TypeError(`${label} has an invalid strength`);
    }
    const renderModel = field(teamColor["extras"], "renderModel");
    if (renderModel !== void 0) {
      const remap = object(renderModel, `${label} neutral remap`);
      if (remap["target"] !== "team-color" || !oneOf(remap["operation"], ["replace", "multiply", "hsv-shade", "grain-merge"])) {
        throw new TypeError(`${label} has invalid neutral remap metadata`);
      }
    }
  }
  if (used.includes("UV_game_material_team_color") && extensionCount === 0) {
    throw new TypeError("UV_game_material_team_color is declared but absent");
  }
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/validation/index.js
function validateUvmDocument(document, options = {}) {
  const { binaryByteLength, signal } = options;
  signal?.throwIfAborted();
  if (binaryByteLength !== void 0 && (!integer(binaryByteLength) || binaryByteLength < 0))
    throw new TypeError("invalid UVM binary byte length");
  const asset = object(document["asset"], "UVM asset");
  if (asset["version"] !== "2.0")
    throw new TypeError("UVM asset.version must be 2.0");
  const uv = object(object(asset["extras"], "UVM asset.extras")["uv"], "UVM profile marker");
  if (uv["format"] !== "UVM" || uv["version"] !== "1.0" || uv["profile"] !== "core") {
    throw new TypeError("asset.extras.uv must identify the UVM/core 1.0 profile");
  }
  const used = array(document, "extensionsUsed");
  for (const required2 of ["UV_asset", "UV_provenance"]) {
    if (!used.includes(required2))
      throw new TypeError(`${required2} is not declared in extensionsUsed`);
  }
  if (array(document, "extensionsRequired").some((id) => String(id).startsWith("UV_"))) {
    throw new TypeError("UVM/core must not require a UV extension for base rendering");
  }
  const extensions = object(document["extensions"], "UVM extensions");
  const identity2 = object(extensions["UV_asset"], "UV_asset");
  if (!nonBlank(identity2["id"]) || !nonBlank(identity2["class"])) {
    throw new TypeError("UV_asset requires non-empty id and class");
  }
  const provenance = object(extensions["UV_provenance"], "UV_provenance");
  const source = object(provenance["source"], "UV_provenance.source");
  const importer = object(provenance["importer"], "UV_provenance.importer");
  if (!nonBlank(source["format"]) || !nonBlank(importer["id"]) || !nonBlank(importer["version"])) {
    throw new TypeError("UV_provenance requires source format and importer coordinate");
  }
  if (extensions["UV_source_blob"] !== void 0 || used.includes("UV_source_blob"))
    throw new TypeError("UVM source blobs are not supported; project data into common facets or a bounded format residual");
  validateCollisionMetadata(document, used, signal);
  validateSocketMetadata(document, used, signal);
  validateTeamColorMetadata(document, used, signal);
  validateGameMaterialMetadata(document, used, signal);
  validateTextureColorKeys(document, used, signal);
  validateEffectsMetadata(document, used, signal);
  validateAnimationPointers(document, used, signal);
  validateUvmAnimationClips(document, signal);
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/uvm/values.js
function object2(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value;
}
function field2(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return void 0;
  return value[key];
}
function nonBlank2(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function string(value, label) {
  if (!nonBlank2(value))
    throw new TypeError(`UVM ${label} must be a nonempty string`);
  return value;
}
function array2(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return [];
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : [];
}
function safeIndex2(value, length, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= length)
    throw new RangeError(`${label} index is outside the UVM document`);
  return value;
}
function required(value, label) {
  if (value === void 0)
    throw new TypeError(`missing UVM ${label}`);
  return value;
}
function finiteArray2(value, length) {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === "number" && Number.isFinite(item));
}
function vector3(value) {
  if (!finiteArray2(value, 3))
    throw new TypeError("UVM node TRS must contain finite VEC3/VEC4 values");
  return [required(value[0], "x"), required(value[1], "y"), required(value[2], "z")];
}
function vector4(value) {
  if (!finiteArray2(value, 4))
    throw new TypeError("UVM node TRS must contain finite VEC3/VEC4 values");
  return [
    required(value[0], "x"),
    required(value[1], "y"),
    required(value[2], "z"),
    required(value[3], "w")
  ];
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/materials/environment.js
function vector2(value, length, name) {
  if (!Array.isArray(value) || value.length !== length)
    throw new TypeError(`${name} requires ${length} finite float32 components`);
  const captured = [];
  for (let index2 = 0; index2 < length; index2++) {
    const item = value[index2];
    if (typeof item !== "number" || !Number.isFinite(item) || !Number.isFinite(Math.fround(item)))
      throw new TypeError(`${name} requires ${length} finite float32 components`);
    captured.push(Math.fround(item));
  }
  return Object.freeze(captured);
}
function snapshotEnvironment(value) {
  if (value === void 0)
    return void 0;
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => key !== "worldToEnvironment"))
    throw new TypeError("invalid environment frame");
  const worldToEnvironment = vector2(Reflect.get(value, "worldToEnvironment"), 16, "worldToEnvironment");
  if ([3, 7, 11].some((index2) => worldToEnvironment[index2] !== 0) || worldToEnvironment[15] !== 1)
    throw new TypeError("worldToEnvironment must be affine");
  const envelope = Math.max(...[0, 1, 2].map((row) => [0, 4, 8, 12].reduce((sum, column) => sum + Math.abs(worldToEnvironment[row + column] ?? 0), 0)));
  if (envelope + 6 * envelope ** 3 > 34028234663852886e22 / 2)
    throw new TypeError("worldToEnvironment exceeds safe float32 reflection arithmetic");
  return Object.freeze({ worldToEnvironment });
}
function snapshotEyePosition(value) {
  return value === void 0 ? void 0 : vector2(value, 3, "eyePosition");
}
var SCENE_ENVIRONMENT_RESOURCE = "modkit:scene-environment";
var SKY_SIZE = 16;
var ZENITH = [168, 180, 196];
var HORIZON = [216, 216, 212];
var NADIR = [92, 88, 84];
var DEFAULT_SCENE_ENVIRONMENT = Object.freeze({
  id: SCENE_ENVIRONMENT_RESOURCE,
  dimension: "cube",
  width: SKY_SIZE,
  height: SKY_SIZE,
  rgba: (() => {
    const rgba = new Uint8Array(SKY_SIZE * SKY_SIZE * 4 * 6);
    for (let face = 0; face < 6; face++)
      for (let row = 0; row < SKY_SIZE; row++)
        for (let column = 0; column < SKY_SIZE; column++) {
          const x = (column + 0.5) / SKY_SIZE * 2 - 1, y = (row + 0.5) / SKY_SIZE * 2 - 1;
          const up = (face === 2 ? 1 : face === 3 ? -1 : -y) / Math.hypot(1, x, y);
          const [toward, amount] = up >= 0 ? [ZENITH, up] : [NADIR, Math.min(1, -up * 1.5)];
          const at = ((face * SKY_SIZE + row) * SKY_SIZE + column) * 4;
          for (let channel2 = 0; channel2 < 3; channel2++)
            rgba[at + channel2] = Math.round(HORIZON[channel2] + (toward[channel2] - HORIZON[channel2]) * amount);
          rgba[at + 3] = 255;
        }
    return rgba;
  })()
});
var isEnvironmentBinding = (binding) => binding.dimension === "cube" && (binding.slot === "envi" || binding.slot === "enviMask");

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/frame.js
var WORLD_PROJECTION_UV_SOURCES = Object.freeze([5, 13, 14, 17, 18]);
var IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
var UP_AXIS_ROTATION = Object.freeze([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
var record2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
function renderMaterialFollowsSceneFrame(params) {
  const model = record2(record2(params)?.["renderModel"]);
  if (model === void 0 || model["version"] !== 1)
    return false;
  if (model["worldToMaterial"] !== void 0)
    return true;
  const composite = record2(model["composite"]);
  const materials = composite === void 0 ? [model["standard"]] : array(composite, "passes").map((pass) => record2(pass)?.["material"]);
  return materials.some((material) => Object.values(record2(record2(material)?.["layers"]) ?? {}).some((layer) => {
    const value = record2(layer);
    return typeof value?.["texturePath"] === "string" && typeof value["uvSource"] === "number" && WORLD_PROJECTION_UV_SOURCES.includes(value["uvSource"]);
  }));
}
function withMaterialFrame(material, frame) {
  const extensions = record2(field(material, "extensions"));
  const game = record2(extensions?.["UV_game_material"]);
  const params = record2(game?.["params"]);
  if (extensions === void 0 || game === void 0 || params === void 0)
    return material;
  if (!renderMaterialFollowsSceneFrame(params))
    return material;
  const model = object(params["renderModel"], "render model");
  const current = model["worldToMaterial"];
  const worldToMaterial = multiplyAffine(Array.isArray(current) ? current : IDENTITY, frame);
  return {
    ...material,
    extensions: {
      ...extensions,
      UV_game_material: {
        ...game,
        params: { ...params, renderModel: { ...model, worldToMaterial } }
      }
    }
  };
}
function uvmSceneFrameMatrix(frame) {
  const scale = frame.metersPerSourceUnit;
  const units = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1];
  const upAxis = frame.upAxis === "+z" ? [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1] : IDENTITY;
  const mirror = frame.handedness !== "left" ? IDENTITY : frame.upAxis === "+z" ? [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
  return multiplyAffine(units, multiplyAffine(upAxis, mirror));
}
function uvmSceneFrameInverse(frame) {
  return invertAffine(uvmSceneFrameMatrix(frame));
}
var sameNumbers = (value, expected) => Array.isArray(value) && value.length === expected.length && value.every((item, index2) => item === expected[index2]);
function removeUvmFrameWrappers(source, budget = DEFAULT_UVM_CONTAINER_BUDGET, signal) {
  signal?.throwIfAborted();
  validateUvmDocument(source.document, {
    binaryByteLength: source.binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  const document = source.document;
  const scenes = array(document, "scenes");
  if (scenes.length !== 1 || document["scene"] !== 0)
    throw new TypeError("UVM frame removal requires one explicit default scene");
  const scene = object(scenes[0], "scene");
  const nodes = array(document, "nodes");
  const roots = array(scene, "nodes").map((root) => safeIndex(root, nodes.length, "scene root"));
  const extensions = record2(document["extensions"]) ?? {};
  const unitsRecord = record2(extensions["UV_units"]);
  const removed = [];
  let metersPerSourceUnit = 1;
  let upAxis = "+y";
  let handedness = "right";
  const at = roots.findIndex((root) => ["uv:units", "uv:up-axis", "uv:handedness"].includes(String(record2(nodes[root])?.["name"])));
  let inner = at === -1 ? [] : [roots[at]];
  for (const [name, property] of [
    ["uv:units", "scale"],
    ["uv:up-axis", "rotation"],
    ["uv:handedness", "scale"]
  ]) {
    const index2 = inner.length === 1 ? inner[0] : void 0;
    const node = index2 === void 0 ? void 0 : record2(nodes[index2]);
    if (node?.["name"] !== name)
      continue;
    if (Object.keys(node).some((key) => !["name", property, "children"].includes(key)))
      throw new TypeError(`${name} carries more than the materializer writes`);
    const value = node[property];
    if (name === "uv:units") {
      const scale = Array.isArray(value) ? value[0] : void 0;
      if (typeof scale !== "number" || !(scale > 0) || !sameNumbers(value, [scale, scale, scale]) || unitsRecord?.["metersPerSourceUnit"] !== scale)
        throw new TypeError("uv:units is not the scale UV_units records");
      metersPerSourceUnit = scale;
    } else if (name === "uv:up-axis") {
      if (!sameNumbers(value, UP_AXIS_ROTATION))
        throw new TypeError("uv:up-axis is not the +z-up turn");
      upAxis = "+z";
    } else {
      if (!sameNumbers(value, upAxis === "+z" ? [1, -1, 1] : [1, 1, -1]))
        throw new TypeError("uv:handedness is not the mirror of its axis");
      handedness = "left";
    }
    removed.push(index2);
    inner = array(node, "children").map((child) => safeIndex(child, nodes.length, `${name} child`));
  }
  if (removed.length === 0)
    return { container: source, frame: { metersPerSourceUnit, upAxis, handedness } };
  const first = nodes.length - removed.length;
  if ([...removed].sort((a, b) => a - b).some((index2, order) => index2 !== first + order))
    throw new TypeError("the materializer's frame nodes are not the document's last nodes");
  const outside = (index2, label) => {
    if (typeof index2 === "number" && index2 >= first)
      throw new TypeError(`${label} names a frame node of the materializer`);
  };
  for (const [index2, node] of nodes.entries())
    if (index2 < first)
      for (const child of array(node, "children"))
        outside(child, "a node child");
  for (const skin of array(document, "skins")) {
    for (const joint of array(skin, "joints"))
      outside(joint, "a skin joint");
    outside(field(skin, "skeleton"), "a skin skeleton");
  }
  for (const animation of array(document, "animations"))
    for (const channel2 of array(animation, "channels"))
      outside(field(field(channel2, "target"), "node"), "an animation target");
  const sourceFrame = removed.at(-1);
  const spaced = ["UV_game_effects", "UV_scene_lights"];
  for (const name of spaced) {
    const space = field(extensions[name], "spaceNode");
    if (space !== sourceFrame)
      outside(space, `${name} spaceNode`);
  }
  const matrix2 = uvmSceneFrameMatrix({ metersPerSourceUnit, upAxis, handedness });
  const unframed = (value) => withMaterialFrame(value, matrix2);
  const unitsRemoved = removed.some((index2) => record2(nodes[index2])?.["name"] === "uv:units");
  const kept = Object.fromEntries(Object.entries(extensions).filter(([name]) => !(unitsRemoved && name === "UV_units")).map(([name, value]) => {
    const extension = record2(value);
    if (!spaced.includes(name) || extension === void 0)
      return [name, value];
    if (extension["spaceNode"] !== sourceFrame)
      return [name, value];
    const { spaceNode: _spaceNode, ...rest } = extension;
    return [name, rest];
  }));
  const used = array(document, "extensionsUsed").filter((name) => !(unitsRemoved && name === "UV_units"));
  const result = snapshotJson({
    ...document,
    ...document["materials"] === void 0 ? {} : { materials: array(document, "materials").map(unframed) },
    ...document["extensionsUsed"] === void 0 ? {} : { extensionsUsed: used },
    ...document["extensions"] === void 0 ? {} : { extensions: kept },
    nodes: nodes.slice(0, first),
    scenes: [{ ...scene, nodes: [...roots.slice(0, at), ...inner, ...roots.slice(at + 1)] }]
  }, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes }, signal);
  const container = {
    ...source,
    document: object(result, "unframed UVM document"),
    binary: new Uint8Array(source.binary),
    extraChunks: source.extraChunks.map((chunk) => ({
      type: chunk.type,
      bytes: new Uint8Array(chunk.bytes)
    }))
  };
  validateUvmDocument(container.document, {
    binaryByteLength: container.binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  writeUvmContainer(container, budget, signal);
  return {
    container,
    frame: {
      metersPerSourceUnit,
      upAxis,
      handedness,
      ...unitsRemoved && unitsRecord !== void 0 ? { units: unitsRecord } : {}
    }
  };
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/materials/frame.js
function materialFrame(value) {
  if (!Array.isArray(value) || value.length !== 16 || value[3] !== 0 || value[7] !== 0 || value[11] !== 0 || value[15] !== 1)
    throw new TypeError(MATERIAL_FRAME_CONTRACT);
  const result = new Array(16);
  for (let index2 = 0; index2 < 16; index2++) {
    const component = value[index2];
    if (typeof component !== "number" || !Number.isFinite(component) || !Number.isFinite(Math.fround(component)))
      throw new TypeError(MATERIAL_FRAME_CONTRACT);
    result[index2] = component;
  }
  invertMaterialFrame(result);
  return Object.freeze(result);
}
var MATERIAL_FRAME_CONTRACT = "material worldToMaterial must be a finite affine float32 matrix";
var inverseRows = new Float64Array(32);
function invertMaterialFrame(matrix2) {
  const rows = inverseRows;
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 8; column++)
      rows[row * 8 + column] = column < 4 ? matrix2[column * 4 + row] ?? 0 : Number(column - 4 === row);
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++)
      if (Math.abs(rows[row * 8 + column]) > Math.abs(rows[pivot * 8 + column]))
        pivot = row;
    if (rows[pivot * 8 + column] === 0)
      throw new TypeError("material frame must be invertible");
    const selected = column * 8;
    if (pivot !== column)
      for (let j = 0; j < 8; j++) {
        const value = rows[selected + j];
        rows[selected + j] = rows[pivot * 8 + j];
        rows[pivot * 8 + j] = value;
      }
    const divisor = rows[selected + column];
    for (let j = 0; j < 8; j++)
      rows[selected + j] = rows[selected + j] / divisor;
    for (let row = 0; row < 4; row++) {
      if (row === column)
        continue;
      const target = row * 8, factor = rows[target + column];
      for (let j = 0; j < 8; j++)
        rows[target + j] = rows[target + j] - factor * rows[selected + j];
    }
  }
  const result = new Array(16);
  for (let index2 = 0; index2 < 16; index2++) {
    const value = rows[index2 % 4 * 8 + 4 + Math.floor(index2 / 4)];
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
      throw new TypeError("material frame inverse exceeds float32");
    result[index2] = value;
  }
  return Object.freeze(result);
}
function multiplyMaterialFrames(left, right) {
  const output = new Array(16);
  for (let index2 = 0; index2 < 16; index2++) {
    const row = index2 % 4, column = Math.floor(index2 / 4);
    let value = 0;
    for (let j = 0; j < 4; j++)
      value += (left[j * 4 + row] ?? 0) * (right[column * 4 + j] ?? 0);
    output[index2] = value;
  }
  return materialFrame(output);
}
var IDENTITY_MATERIAL_FRAME = Object.freeze([
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1
]);

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/materials/render-model.js
var RENDER_MATERIAL_SHADER = "modkit.render-material.v1";
var MATERIAL_LAYERS_SHADER = "modkit.material-layers.v1";
function activeLayers(material) {
  return Object.values(material.layers).filter((layer) => layer.slot !== "normalBlend2Mask" || material.normalBlendPolicy?.secondMask !== false);
}
var PRESENTATIONS = ["surface", "screen-distortion", "terrain-projection"];
var record3 = (value, path) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${path} must be an object`);
  return value;
};
var finite2 = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new TypeError(`${path} must be a finite float32 number`);
  return value;
};
var integer2 = (value, path, min, max) => {
  const result = finite2(value, path);
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new TypeError(`${path} must be an integer in ${min}..${max}`);
  return result;
};
var vector5 = (value, path, size) => {
  if (!Array.isArray(value) || value.length !== size)
    throw new TypeError(`${path} must contain ${size} components`);
  for (const component of value)
    finite2(component, path);
};
var flags = (value, path, names, optional = false) => {
  for (const key of names)
    if ((!optional || value[key] !== void 0) && typeof value[key] !== "boolean")
      throw new TypeError(`${path}.${key} must be boolean`);
};
function validateTrack(value, path, size, signal) {
  const track = record3(value, path);
  integer2(track["lineType"], `${path}.lineType`, 0, 1);
  if (track["globalSeqId"] !== null)
    throw new TypeError(`${path}.globalSeqId requires an explicit global sequence timeline`);
  const keys = track["keys"];
  if (!Array.isArray(keys) || keys.length === 0)
    throw new TypeError(`${path}.keys must be nonempty`);
  let previous = -Infinity;
  for (const [index2, item] of keys.entries()) {
    signal?.throwIfAborted();
    const keyPath = `${path}.keys[${index2}]`, key = record3(item, keyPath);
    const frame = finite2(key["frame"], `${keyPath}.frame`);
    if (frame < previous)
      throw new TypeError(`${path} keys must be ordered by frame`);
    previous = frame;
    vector5(key["vector"], `${keyPath}.vector`, size);
    for (const tangent of ["inTan", "outTan"])
      if (key[tangent] !== void 0)
        vector5(key[tangent], `${keyPath}.${tangent}`, size);
  }
}
function animated(value, path, size, signal) {
  const property = record3(value, path);
  if (size === 1)
    finite2(property["value"], `${path}.value`);
  else
    vector5(property["value"], `${path}.value`, size);
  if (property["track"] !== void 0)
    validateTrack(property["track"], `${path}.track`, size, signal);
  const sequences = property["sequenceTracks"];
  if (sequences === void 0)
    return;
  if (!Array.isArray(sequences))
    throw new TypeError(`${path}.sequenceTracks must be an array`);
  const seen = /* @__PURE__ */ new Set();
  for (const [index2, entry] of sequences.entries()) {
    const trackPath = `${path}.sequenceTracks[${index2}]`, track = record3(entry, trackPath);
    const sequence = integer2(track["sequenceIndex"], `${trackPath}.sequenceIndex`, 0, 4294967295);
    if (seen.has(sequence))
      throw new TypeError(`${path} has duplicate sequence ${sequence}`);
    seen.add(sequence);
    flags(track, trackPath, ["concurrent"], true);
    if (track["wrapSeconds"] !== void 0 || track["concurrent"] === true) {
      if (finite2(track["wrapSeconds"], `${trackPath}.wrapSeconds`) <= 0)
        throw new TypeError(`${trackPath}.wrapSeconds must be positive`);
    }
    validateTrack(track["track"], `${trackPath}.track`, size, signal);
  }
}
var LAYER_ANIMATIONS = [
  ["constantColor", 4],
  ["colorMultiply", 1],
  ["colorAdd", 1],
  ["alphaFactor", 1],
  ["uvOffset", 2],
  ["uvAngle", 3],
  ["uvTiling", 2],
  ["uvTriplanarOffset", 3],
  ["uvTriplanarScale", 3]
];
function validateLayer(value, slot, path, signal) {
  const layer = record3(value, path);
  if (layer["slot"] !== slot)
    throw new TypeError(`${path}.slot does not match its layer key`);
  if (layer["texturePath"] !== null && (typeof layer["texturePath"] !== "string" || layer["texturePath"].trim() === ""))
    throw new TypeError(`${path}.texturePath must be a nonempty logical id or null`);
  if (layer["sceneEnvironment"] !== void 0) {
    if (layer["sceneEnvironment"] !== true || slot !== "envi" || layer["texturePath"] !== null || layer["constantColor"] !== void 0)
      throw new TypeError(`${path}.sceneEnvironment is true only on an envi layer without a texture or constant color`);
  } else if (layer["texturePath"] === null && layer["constantColor"] === void 0)
    throw new TypeError(`${path} has no texture or constant color`);
  integer2(layer["uvSource"], `${path}.uvSource`, 0, 18);
  integer2(layer["channels"], `${path}.channels`, 0, 5);
  integer2(layer["op"], `${path}.op`, 0, 6);
  integer2(layer["teamColorMode"], `${path}.teamColorMode`, 0, 2);
  flags(layer, path, ["invert", "clampResult", "wrapX", "wrapY"]);
  for (const [key, size] of LAYER_ANIMATIONS)
    if (layer[key] !== void 0)
      animated(layer[key], `${path}.${key}`, size, signal);
  if (layer["flipbook"] !== void 0) {
    const flip = record3(layer["flipbook"], `${path}.flipbook`);
    integer2(flip["rows"], `${path}.flipbook.rows`, 1, 65535);
    integer2(flip["cols"], `${path}.flipbook.cols`, 1, 65535);
    if (flip["frameSize"] !== void 0) {
      vector5(flip["frameSize"], `${path}.flipbook.frameSize`, 2);
      if (flip["frameSize"].some((component) => component <= 0))
        throw new TypeError(`${path}.flipbook.frameSize must be positive`);
    }
    animated(flip["frame"], `${path}.flipbook.frame`, 1, signal);
  }
  if (layer["fresnel"] !== void 0) {
    const fresnel = record3(layer["fresnel"], `${path}.fresnel`);
    integer2(fresnel["mode"], `${path}.fresnel.mode`, 1, 2);
    integer2(fresnel["transformMode"], `${path}.fresnel.transformMode`, 0, 2);
    for (const key of ["exponent", "min", "maxOffset"])
      finite2(fresnel[key], `${path}.fresnel.${key}`);
    flags(fresnel, `${path}.fresnel`, ["localTransform", "doNotMirror"]);
    for (const key of ["translation", "invertMask"])
      vector5(fresnel[key], `${path}.fresnel.${key}`, 3);
    vector5(fresnel["rotation"], `${path}.fresnel.rotation`, 2);
  }
}
function validateStandard(value, path, signal) {
  const material = record3(value, path);
  if (material["tangentGeneration"] !== void 0) {
    const generation = record3(material["tangentGeneration"], `${path}.tangentGeneration`);
    if (Object.keys(generation).some((key) => key !== "texCoord"))
      throw new TypeError(`${path}.tangentGeneration has unsupported properties`);
    integer2(generation["texCoord"], `${path}.tangentGeneration.texCoord`, 0, 4);
  }
  integer2(material["blendMode"], `${path}.blendMode`, 0, 6);
  integer2(material["specMode"], `${path}.specMode`, 0, 1);
  for (const key of ["priority", "specularity", "specMult", "emisMult"])
    finite2(material[key], `${path}.${key}`);
  const threshold = finite2(material["alphaTestThreshold"], `${path}.alphaTestThreshold`);
  if (threshold < 0 || threshold > 1)
    throw new TypeError(`${path}.alphaTestThreshold must be in 0..1`);
  flags(material, path, [
    "twoSided",
    "unshaded",
    "doubleLambert",
    "clampOutput",
    "usesVertexColor",
    "usesVertexAlpha"
  ]);
  flags(material, path, ["depthPrepass", "specularEnergyConservation"], true);
  for (const key of ["sourceFlags", "sourceAdditionalFlags", "materialClass"])
    if (material[key] !== void 0)
      integer2(material[key], `${path}.${key}`, 0, 4294967295);
  for (const key of ["environmentMultipliers", "emissiveTint"])
    if (material[key] !== void 0)
      vector5(material[key], `${path}.${key}`, 3);
  if (material["parallaxHeight"] !== void 0)
    animated(material["parallaxHeight"], `${path}.parallaxHeight`, 1, signal);
  const factors = material["normalBlendFactors"];
  if (factors !== void 0) {
    if (!Array.isArray(factors) || factors.length !== 8)
      throw new TypeError(`${path}.normalBlendFactors must have 8 entries`);
    for (const [index2, factor] of factors.entries())
      animated(factor, `${path}.normalBlendFactors[${index2}]`, 1, signal);
  }
  if (material["normalMapFormat"] !== void 0 && (typeof material["normalMapFormat"] !== "string" || !["dxt5nm", "bc5", "rgb8", "luminance-alpha"].includes(material["normalMapFormat"])))
    throw new TypeError(`${path}.normalMapFormat is unsupported`);
  if (material["normalMapSpace"] !== void 0 && material["normalMapSpace"] !== "tangent" && material["normalMapSpace"] !== "object")
    throw new TypeError(`${path}.normalMapSpace is unsupported`);
  if (material["normalMapTransform"] !== void 0)
    vector5(material["normalMapTransform"], `${path}.normalMapTransform`, 9);
  const lightingModel = material["lightingModel"] ?? "m3";
  if (lightingModel !== "m3" && lightingModel !== "pbr-metallic-roughness")
    throw new TypeError(`${path}.lightingModel is unsupported`);
  for (const key of ["metallicFactor", "roughnessFactor"])
    if (material[key] !== void 0) {
      const factor = finite2(material[key], `${path}.${key}`);
      if (factor < 0 || factor > 1)
        throw new TypeError(`${path}.${key} must be in 0..1`);
    }
  const colorPipeline = material["colorPipeline"] ?? "m3";
  if (colorPipeline !== "m3" && colorPipeline !== "linear-srgb")
    throw new TypeError(`${path}.colorPipeline is unsupported`);
  if (colorPipeline === "linear-srgb" && lightingModel !== "pbr-metallic-roughness")
    throw new TypeError(`${path}.colorPipeline linear-srgb requires the pbr lighting model`);
  if (material["tonemap"] !== void 0) {
    vector5(material["tonemap"], `${path}.tonemap`, 5);
    const curve = material["tonemap"];
    if (curve.some((term) => term < 0) || !(curve[4] > 0))
      throw new TypeError(`${path}.tonemap needs nonnegative terms and e > 0`);
    if (colorPipeline !== "linear-srgb")
      throw new TypeError(`${path}.tonemap requires the linear-srgb color pipeline`);
  }
  if (material["normalMapSpace"] !== "object" && material["normalMapTransform"] !== void 0)
    throw new TypeError(`${path}.normalMapTransform requires object-space normals`);
  const layers = record3(material["layers"], `${path}.layers`);
  if (material["normalMapSpace"] === "object" && (layers["normal"] === void 0 || ["normalBlend1", "normalBlend2", "normalBlend1Mask", "normalBlend2Mask"].some((slot) => layers[slot] !== void 0)))
    throw new TypeError(`${path}.normalMapSpace object requires one primary normal layer`);
  if (material["normalBlendPolicy"] !== void 0) {
    const policy = record3(material["normalBlendPolicy"], `${path}.normalBlendPolicy`);
    if (policy["mode"] !== "signed-two-detail" || typeof policy["secondMask"] !== "boolean" || Object.keys(policy).some((key) => key !== "mode" && key !== "secondMask"))
      throw new TypeError(`${path}.normalBlendPolicy is unsupported`);
    if (layers["normalBlend1"] === void 0 || layers["normalBlend2"] === void 0)
      throw new TypeError(`${path}.normalBlendPolicy requires both detail layers`);
  }
  for (const [slot, layer] of Object.entries(layers)) {
    if (!isStandardLayerSlot(slot))
      throw new TypeError(`${path} has unknown layer ${slot}`);
    validateLayer(layer, slot, `${path}.layers.${slot}`, signal);
  }
}
function createRenderMaterialSampler(parameters, budget, signal) {
  const params = record3(snapshotJson(parameters, budget, signal), "material params");
  const model = record3(params["renderModel"], "material params.renderModel");
  if (model["version"] !== 1)
    throw new TypeError("unsupported render material version");
  const presentation = model["presentation"] ?? "surface";
  if (typeof presentation !== "string" || !PRESENTATIONS.includes(presentation))
    throw new TypeError("unsupported render material presentation");
  const colorless = presentation !== "surface";
  const worldToMaterial = model["worldToMaterial"] === void 0 ? void 0 : materialFrame(model["worldToMaterial"]);
  let priority;
  let passes;
  if (model["composite"] !== void 0) {
    const composite = record3(model["composite"], "composite material");
    priority = finite2(composite["priority"], "composite material.priority");
    if (!Array.isArray(composite["passes"]) || composite["passes"].length === 0)
      throw new TypeError("composite material.passes must be nonempty");
    for (const [index2, value] of composite["passes"].entries()) {
      const pass = record3(value, `material pass ${index2}`);
      validateStandard(pass["material"], `material pass ${index2}`, signal);
      animated(pass["alphaFactor"], `material pass ${index2}.alphaFactor`, 1, signal);
    }
    passes = composite["passes"].map((pass) => ({
      ...pass,
      material: withSceneEnvironment(pass.material)
    }));
    if (model["standard"] !== void 0)
      validateStandard(model["standard"], "standard material", signal);
  } else {
    validateStandard(model["standard"], "standard material", signal);
    passes = [
      {
        material: withSceneEnvironment(model["standard"]),
        alphaFactor: { value: 1 }
      }
    ];
  }
  const resources = Object.freeze(colorless ? [] : [
    ...new Set(passes.flatMap((pass) => activeLayers(pass.material).flatMap((layer) => layer.texturePath === null || layer.texturePath === SCENE_ENVIRONMENT_RESOURCE ? [] : [layer.texturePath])))
  ]);
  return Object.freeze({
    resources,
    usesSceneEnvironment: !colorless && passes.some((pass) => pass.material.layers.envi?.texturePath === SCENE_ENVIRONMENT_RESOURCE),
    presentation,
    ...worldToMaterial === void 0 ? {} : { worldToMaterial },
    usesWorldProjection: passes.some((pass) => (
      // Rebasing preserves authored coordinates even for a layer that may be enabled later.
      Object.values(pass.material.layers).some((layer) => layer.texturePath !== null && WORLD_PROJECTION_UV_SOURCES.includes(layer.uvSource))
    )),
    sample(time, sampleSignal) {
      if (!Number.isFinite(time.time) || time.time < 0)
        throw new TypeError("material time must be finite and nonnegative");
      if (time.sequenceTime !== void 0 && (!Number.isFinite(time.sequenceTime) || time.sequenceTime < 0))
        throw new TypeError("material sequenceTime must be finite and nonnegative");
      if (time.sequenceIndex !== void 0)
        integer2(time.sequenceIndex, "material sequenceIndex", 0, 4294967295);
      sampleSignal?.throwIfAborted();
      if (colorless)
        return Object.freeze([]);
      return Object.freeze(passes.map((pass, index2) => {
        sampleSignal?.throwIfAborted();
        return Object.freeze({
          material: sampleMaterial(pass.material, time, sampleSignal),
          // Render-model composites use their first pass as the base; its CMS opacity is ignored.
          alpha: index2 === 0 ? 1 : sampleAnimated(pass.alphaFactor, time).value,
          priority: priority ?? pass.material.priority
        });
      }));
    }
  });
}
function withSceneEnvironment(material) {
  const envi = material.layers.envi;
  if (envi?.sceneEnvironment !== true)
    return material;
  const { sceneEnvironment: _, ...layer } = envi;
  void _;
  return {
    ...material,
    layers: { ...material.layers, envi: { ...layer, texturePath: SCENE_ENVIRONMENT_RESOURCE } }
  };
}
function sampleAnimated(value, time) {
  const sequence = time.sequenceIndex === void 0 ? void 0 : value.sequenceTracks?.find((entry) => entry.sequenceIndex === time.sequenceIndex);
  const track = value.sequenceTracks === void 0 ? value.track : sequence?.track;
  let sampled = value.value;
  if (track !== void 0) {
    const components = sampleTrackValue(track, sequence?.concurrent === true ? time.time : time.sequenceTime ?? time.time, [], sequence?.concurrent === true ? { wrapSeconds: sequence.wrapSeconds } : {});
    if (components.length === 0)
      throw new TypeError("material sample produced no components");
    for (const component of components)
      finite2(component, "material sample");
    sampled = typeof value.value === "number" ? components[0] : Object.freeze(components);
  }
  return Object.freeze({ value: sampled });
}
function sampleMaterial(material, time, signal) {
  const layers = {};
  for (const layer of activeLayers(material)) {
    const slot = layer.slot;
    signal?.throwIfAborted();
    if (!isStandardLayerSlot(slot))
      throw new TypeError(`unknown material slot ${slot}`);
    const sampled = { ...layer };
    for (const [key] of LAYER_ANIMATIONS) {
      const property = layer[key];
      if (property !== void 0)
        Object.assign(sampled, {
          [key]: sampleAnimated(property, time)
        });
    }
    if (layer.flipbook !== void 0)
      sampled.flipbook = Object.freeze({
        ...layer.flipbook,
        frame: sampleAnimated(layer.flipbook.frame, time)
      });
    layers[slot] = Object.freeze(sampled);
  }
  return Object.freeze({
    ...material,
    layers: Object.freeze(layers),
    ...material.parallaxHeight === void 0 ? {} : { parallaxHeight: sampleAnimated(material.parallaxHeight, time) },
    ...material.normalBlendFactors === void 0 ? {} : {
      normalBlendFactors: Object.freeze(material.normalBlendFactors.map((factor) => sampleAnimated(factor, time)))
    }
  });
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/model/billboard-math.js
function invertQuat(rotation2) {
  const lengthSq = rotation2[0] * rotation2[0] + rotation2[1] * rotation2[1] + rotation2[2] * rotation2[2] + rotation2[3] * rotation2[3];
  if (lengthSq === 0)
    return [0, 0, 0, 1];
  return [
    -rotation2[0] / lengthSq,
    -rotation2[1] / lengthSq,
    -rotation2[2] / lengthSq,
    rotation2[3] / lengthSq
  ];
}
function multiplyQuat(left, right) {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  return normalizeQuat([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ]);
}
function invertMatrix4OrNull(matrix2) {
  const out = new Float32Array(16);
  const b00 = (matrix2[0] ?? 0) * (matrix2[5] ?? 0) - (matrix2[1] ?? 0) * (matrix2[4] ?? 0);
  const b01 = (matrix2[0] ?? 0) * (matrix2[6] ?? 0) - (matrix2[2] ?? 0) * (matrix2[4] ?? 0);
  const b02 = (matrix2[0] ?? 0) * (matrix2[7] ?? 0) - (matrix2[3] ?? 0) * (matrix2[4] ?? 0);
  const b03 = (matrix2[1] ?? 0) * (matrix2[6] ?? 0) - (matrix2[2] ?? 0) * (matrix2[5] ?? 0);
  const b04 = (matrix2[1] ?? 0) * (matrix2[7] ?? 0) - (matrix2[3] ?? 0) * (matrix2[5] ?? 0);
  const b05 = (matrix2[2] ?? 0) * (matrix2[7] ?? 0) - (matrix2[3] ?? 0) * (matrix2[6] ?? 0);
  const b06 = (matrix2[8] ?? 0) * (matrix2[13] ?? 0) - (matrix2[9] ?? 0) * (matrix2[12] ?? 0);
  const b07 = (matrix2[8] ?? 0) * (matrix2[14] ?? 0) - (matrix2[10] ?? 0) * (matrix2[12] ?? 0);
  const b08 = (matrix2[8] ?? 0) * (matrix2[15] ?? 0) - (matrix2[11] ?? 0) * (matrix2[12] ?? 0);
  const b09 = (matrix2[9] ?? 0) * (matrix2[14] ?? 0) - (matrix2[10] ?? 0) * (matrix2[13] ?? 0);
  const b10 = (matrix2[9] ?? 0) * (matrix2[15] ?? 0) - (matrix2[11] ?? 0) * (matrix2[13] ?? 0);
  const b11 = (matrix2[10] ?? 0) * (matrix2[15] ?? 0) - (matrix2[11] ?? 0) * (matrix2[14] ?? 0);
  let determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(determinant) < 1e-12)
    return null;
  determinant = 1 / determinant;
  out[0] = ((matrix2[5] ?? 0) * b11 - (matrix2[6] ?? 0) * b10 + (matrix2[7] ?? 0) * b09) * determinant;
  out[1] = ((matrix2[2] ?? 0) * b10 - (matrix2[1] ?? 0) * b11 - (matrix2[3] ?? 0) * b09) * determinant;
  out[2] = ((matrix2[13] ?? 0) * b05 - (matrix2[14] ?? 0) * b04 + (matrix2[15] ?? 0) * b03) * determinant;
  out[3] = ((matrix2[10] ?? 0) * b04 - (matrix2[9] ?? 0) * b05 - (matrix2[11] ?? 0) * b03) * determinant;
  out[4] = ((matrix2[6] ?? 0) * b08 - (matrix2[4] ?? 0) * b11 - (matrix2[7] ?? 0) * b07) * determinant;
  out[5] = ((matrix2[0] ?? 0) * b11 - (matrix2[2] ?? 0) * b08 + (matrix2[3] ?? 0) * b07) * determinant;
  out[6] = ((matrix2[14] ?? 0) * b02 - (matrix2[12] ?? 0) * b05 - (matrix2[15] ?? 0) * b01) * determinant;
  out[7] = ((matrix2[8] ?? 0) * b05 - (matrix2[10] ?? 0) * b02 + (matrix2[11] ?? 0) * b01) * determinant;
  out[8] = ((matrix2[4] ?? 0) * b10 - (matrix2[5] ?? 0) * b08 + (matrix2[7] ?? 0) * b06) * determinant;
  out[9] = ((matrix2[1] ?? 0) * b08 - (matrix2[0] ?? 0) * b10 - (matrix2[3] ?? 0) * b06) * determinant;
  out[10] = ((matrix2[12] ?? 0) * b04 - (matrix2[13] ?? 0) * b02 + (matrix2[15] ?? 0) * b00) * determinant;
  out[11] = ((matrix2[9] ?? 0) * b02 - (matrix2[8] ?? 0) * b04 - (matrix2[11] ?? 0) * b00) * determinant;
  out[12] = ((matrix2[5] ?? 0) * b07 - (matrix2[4] ?? 0) * b09 - (matrix2[6] ?? 0) * b06) * determinant;
  out[13] = ((matrix2[0] ?? 0) * b09 - (matrix2[1] ?? 0) * b07 + (matrix2[2] ?? 0) * b06) * determinant;
  out[14] = ((matrix2[13] ?? 0) * b01 - (matrix2[12] ?? 0) * b03 - (matrix2[14] ?? 0) * b00) * determinant;
  out[15] = ((matrix2[8] ?? 0) * b03 - (matrix2[9] ?? 0) * b01 + (matrix2[10] ?? 0) * b00) * determinant;
  return out;
}
function rotationTranslationScaleOriginMatrix(rotation2, translation2, scaling, origin) {
  const x = rotation2[0];
  const y = rotation2[1];
  const z = rotation2[2];
  const w = rotation2[3];
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
  const sx = scaling[0];
  const sy = scaling[1];
  const sz = scaling[2];
  const ox = origin[0];
  const oy = origin[1];
  const oz = origin[2];
  const out = new Float32Array(16);
  out[0] = (1 - yy - zz) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - xx - zz) * sy;
  out[6] = (yz + wx) * sy;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - xx - yy) * sz;
  out[12] = translation2[0] + ox - (out[0] * ox + out[4] * oy + out[8] * oz);
  out[13] = translation2[1] + oy - (out[1] * ox + out[5] * oy + out[9] * oz);
  out[14] = translation2[2] + oz - (out[2] * ox + out[6] * oy + out[10] * oz);
  out[15] = 1;
  return out;
}
function multiplyMatrix4(a, b) {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[col * 4 + row] = (a[0 * 4 + row] ?? 0) * (b[col * 4 + 0] ?? 0) + (a[1 * 4 + row] ?? 0) * (b[col * 4 + 1] ?? 0) + (a[2 * 4 + row] ?? 0) * (b[col * 4 + 2] ?? 0) + (a[3 * 4 + row] ?? 0) * (b[col * 4 + 3] ?? 0);
    }
  }
  return out;
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/model/billboards.js
var AIM_LOCKS = ["free", "frame-x", "frame-y", "frame-z", "own-x", "own-y"];
function needed(value, label) {
  if (value === void 0)
    throw new TypeError("billboard " + label + " absent");
  return value;
}
function rotation(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === "number" && Number.isFinite(item) && Number.isFinite(Math.fround(item))) || Math.hypot(...value) === 0)
    throw new TypeError("billboard quaternion must be finite and nonzero");
  return normalizeQuat(value);
}
function matrix(value) {
  if (value.length !== 16 || !value.every(Number.isFinite) || [3, 7, 11].some((index2) => value[index2] !== 0) || value[15] !== 1)
    throw new TypeError("billboard matrix must be finite affine");
  const result = Float32Array.from(value);
  if (!result.every(Number.isFinite))
    throw new RangeError("billboard matrix exceeds float32");
  return result;
}
function position(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => typeof item === "number" && Number.isFinite(item)))
    throw new TypeError("billboard position must contain three finite numbers");
  return [value[0], value[1], value[2]];
}
function snapshotModelBillboards(values, maxBytes, signal) {
  const owned = snapshotJson(values, { maxBytes, maxDepth: 8, maxNodes: Math.floor(maxBytes / 16) }, signal);
  if (!Array.isArray(owned))
    throw new TypeError("billboard constraints must be an array");
  const seen = /* @__PURE__ */ new Set();
  for (const item of owned) {
    if (!item || typeof item.nodeId !== "string" || !item.nodeId || seen.has(item.nodeId))
      throw new TypeError("invalid or duplicate billboard constraint");
    if (item.mode === "inverse-camera") {
      if (Object.keys(item).some((key) => !["nodeId", "mode", "basisRotations"].includes(key)) || !Array.isArray(item.basisRotations) || item.basisRotations.length > 4)
        throw new TypeError("invalid inverse-camera billboard constraint");
      for (const basis of item.basisRotations)
        rotation(basis);
    } else if (item.mode === "face-camera") {
      if (Object.keys(item).some((key) => !["nodeId", "mode", "rotationAxes", "pivot"].includes(key)) || !["z", "xz"].includes(item.rotationAxes))
        throw new TypeError("invalid face-camera billboard constraint");
      position(item.pivot);
    } else if (item.mode === "aim") {
      if (Object.keys(item).some((key) => !["nodeId", "mode", "aim", "lock", "correction", "rootCorrection"].includes(key)) || item.aim !== "view" && item.aim !== "eye" || !AIM_LOCKS.includes(item.lock))
        throw new TypeError("invalid aim billboard constraint");
      if (item.correction !== void 0)
        rotation(item.correction);
      if (item.rootCorrection !== void 0)
        rotation(item.rootCorrection);
    } else
      throw new TypeError("invalid billboard mode");
    seen.add(item.nodeId);
  }
  return owned;
}
function translation(value) {
  return Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, value[0], value[1], value[2], 1);
}
function rotationX(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return Float32Array.of(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1);
}
function rotationZ(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return Float32Array.of(c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
}
function applyModelFaceCameraBillboard(sourceWorld, constraint, cameraPosition) {
  const world = matrix(sourceWorld);
  const inverse = invertMatrix4OrNull(world);
  if (inverse === null)
    throw new TypeError("face-camera billboard world is singular");
  const camera = position(cameraPosition);
  const pivot = position(constraint.pivot);
  const x = (inverse[0] ?? 0) * camera[0] + (inverse[4] ?? 0) * camera[1] + (inverse[8] ?? 0) * camera[2] + (inverse[12] ?? 0) - pivot[0];
  let y = (inverse[1] ?? 0) * camera[0] + (inverse[5] ?? 0) * camera[1] + (inverse[9] ?? 0) * camera[2] + (inverse[13] ?? 0) - pivot[1];
  const z = (inverse[2] ?? 0) * camera[0] + (inverse[6] ?? 0) * camera[1] + (inverse[10] ?? 0) * camera[2] + (inverse[14] ?? 0) - pivot[2];
  let result = multiplyMatrix4(world, translation(pivot));
  if (constraint.rotationAxes === "xz") {
    const pitch = Math.atan2(z, y);
    result = multiplyMatrix4(result, rotationX(pitch));
    y = Math.hypot(y, z);
  }
  result = multiplyMatrix4(result, rotationZ(-Math.atan2(x, y)));
  result = multiplyMatrix4(result, translation([-pivot[0], -pivot[1], -pivot[2]]));
  if (!result.every(Number.isFinite))
    throw new RangeError("face-camera billboard exceeds float32");
  return result;
}
function billboardCameraRotation(view) {
  const inverse = invertMatrix4OrNull(matrix(view));
  if (inverse === null)
    throw new TypeError("billboard camera view is singular");
  return decomposeMatrix4(inverse).rotation;
}
function applyModelBillboards(pose, bindings, constraints, cameraRotation, hierarchyFrame, maxBytes, signal, cameraPosition) {
  signal?.throwIfAborted();
  const inverseConstraints = constraints.filter((item) => item.mode === "inverse-camera" || item.mode === "aim");
  if (cameraRotation === void 0 || inverseConstraints.length === 0)
    return pose;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || pose.length * 2048 + inverseConstraints.length * 256 > maxBytes)
    throw new RangeError("billboard pose exceeds byte budget");
  const byNode = new Map(inverseConstraints.map((item) => [item.nodeId, item])), source = /* @__PURE__ */ new Map(), bones = new Map(bindings.map((item) => [item.boneIndex, item]));
  for (const item of pose) {
    if (source.has(item.boneIndex))
      throw new TypeError("duplicate billboard pose bone");
    source.set(item.boneIndex, item);
  }
  if (!pose.some((item) => byNode.has(item.nodeId)))
    return pose;
  const cameraInFrame = multiplyQuat(invertQuat(decomposeMatrix4(matrix(hierarchyFrame)).rotation), rotation(cameraRotation));
  const frameInverse = invertMatrix4OrNull(matrix(hierarchyFrame));
  const eye = cameraPosition === void 0 || frameInverse === null ? void 0 : transformPoint(frameInverse, position(cameraPosition));
  const camera = {
    forward: rotateVector(cameraInFrame, [0, 0, -1]),
    up: rotateVector(cameraInFrame, [0, 1, 0]),
    axisX: rotateVector(cameraInFrame, [1, 0, 0]),
    ...eye === void 0 ? {} : { eye }
  };
  const adjusted = /* @__PURE__ */ new Map(), output = /* @__PURE__ */ new Map();
  for (const entry of pose) {
    const chain = [], visiting = /* @__PURE__ */ new Set();
    let cursor = entry.boneIndex;
    while (cursor !== null && !adjusted.has(cursor)) {
      if (visiting.has(cursor))
        throw new TypeError("cyclic billboard hierarchy");
      visiting.add(cursor);
      chain.push(cursor);
      const parent = needed(bones.get(cursor), "bone binding").parentBoneIndex;
      if (parent === void 0)
        throw new TypeError("billboard parent is unknown");
      cursor = parent;
    }
    for (const index2 of chain.reverse()) {
      signal?.throwIfAborted();
      const bone = needed(bones.get(index2), "binding"), original = needed(source.get(index2), "source pose"), parent = bone.parentBoneIndex;
      if (parent === void 0)
        throw new TypeError("billboard parent is unknown");
      const originalWorld = matrix(original.worldMatrix), originalParent = parent === null ? null : matrix(needed(source.get(parent), "parent pose").worldMatrix), inverseOriginalParent = originalParent === null ? null : invertMatrix4OrNull(originalParent);
      const local = originalParent !== null && inverseOriginalParent !== null ? multiplyMatrix4(inverseOriginalParent, originalWorld) : originalWorld;
      const adjustedParent = parent === null ? void 0 : needed(adjusted.get(parent), "adjusted parent");
      let world = adjustedParent === void 0 ? local : multiplyMatrix4(adjustedParent, local);
      const constraint = byNode.get(original.nodeId);
      if (constraint !== void 0) {
        const localTransform = decomposeMatrix4(local), parentInverse = adjustedParent === void 0 ? [0, 0, 0, 1] : invertQuat(decomposeMatrix4(adjustedParent).rotation);
        let facing;
        if (constraint.mode === "inverse-camera") {
          facing = multiplyQuat(parentInverse, cameraInFrame);
          for (const basis of constraint.basisRotations)
            facing = multiplyQuat(facing, rotation(basis));
          facing = multiplyQuat(facing, localTransform.rotation);
        } else {
          const aimed = aimRotation(constraint, camera, world, parent === null, localTransform.rotation);
          if (aimed !== void 0)
            facing = multiplyQuat(parentInverse, aimed);
        }
        if (facing !== void 0) {
          const billboardLocal = rotationTranslationScaleOriginMatrix(normalizeQuat(facing), localTransform.translation, localTransform.scaling, [0, 0, 0]);
          world = adjustedParent === void 0 ? billboardLocal : multiplyMatrix4(adjustedParent, billboardLocal);
        }
      }
      if (!world.every(Number.isFinite))
        throw new RangeError("billboard world exceeds float32");
      adjusted.set(index2, world);
      const skin = bone.inverseBindMatrix === void 0 ? void 0 : multiplyMatrix4(world, matrix(bone.inverseBindMatrix));
      if (skin !== void 0 && !skin.every(Number.isFinite))
        throw new RangeError("billboard skin exceeds float32");
      output.set(index2, {
        boneIndex: index2,
        nodeId: original.nodeId,
        worldMatrix: Array.from(world),
        ...skin === void 0 ? {} : { skinningMatrix: Array.from(skin) }
      });
    }
  }
  signal?.throwIfAborted();
  return pose.map((item) => needed(output.get(item.boneIndex), "result"));
}
var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
var unit = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : v;
};
var unit2 = (a, b) => {
  const length = Math.hypot(a, b);
  return length > 0 ? [a / length, b / length] : [a, b];
};
function rotateVector(q, v) {
  const u = [q[0], q[1], q[2]];
  const c1 = cross(u, v);
  const t = [c1[0] * 2, c1[1] * 2, c1[2] * 2];
  const c2 = cross(u, t);
  return [v[0] + q[3] * t[0] + c2[0], v[1] + q[3] * t[1] + c2[1], v[2] + q[3] * t[2] + c2[2]];
}
function transformPoint(m, p) {
  const row = (r) => (m[r] ?? 0) * p[0] + (m[4 + r] ?? 0) * p[1] + (m[8 + r] ?? 0) * p[2] + (m[12 + r] ?? 0);
  return [row(0), row(1), row(2)];
}
var AXIS_EPSILON = 2384185791015625e-22;
var DEGENERATE_LENGTH_SQUARED = 1e-4;
var ORTHONORMAL_TOLERANCE = 1e-3;
function aimRotation(constraint, camera, world, root, spin) {
  let d;
  if (constraint.aim === "eye") {
    if (camera.eye === void 0)
      return void 0;
    d = unit(sub([world[12] ?? 0, world[13] ?? 0, world[14] ?? 0], camera.eye));
  } else
    d = camera.forward;
  if (d.every((component) => Math.abs(component) < AXIS_EPSILON))
    return void 0;
  let rows = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  switch (constraint.lock) {
    case "frame-x": {
      let v = [0, d[1], d[2]];
      if (d[1] * d[1] + d[2] * d[2] < DEGENERATE_LENGTH_SQUARED)
        v = camera.axisX;
      v = unit(v);
      const p = unit2(-v[2], v[1]);
      rows = [[1, 0, 0], v, [0, p[0], p[1]]];
      break;
    }
    case "frame-y": {
      let v = [d[0], 0, d[2]];
      if (d[2] * d[2] + d[0] * d[0] < DEGENERATE_LENGTH_SQUARED)
        v = camera.up;
      v = unit(v);
      const p = unit2(-v[2], v[0]);
      rows = [v, [0, 1, 0], [p[0], 0, p[1]]];
      break;
    }
    case "frame-z": {
      let v = [d[0], d[1], 0];
      if (d[1] * d[1] + d[0] * d[0] < DEGENERATE_LENGTH_SQUARED)
        v = camera.up;
      v = unit(v);
      const p = unit2(v[1], -v[0]);
      rows = [[p[0], p[1], 0], v, [0, 0, 1]];
      break;
    }
    case "own-x":
    case "own-y": {
      const column = constraint.lock === "own-x" ? 0 : 4;
      const a = unit([world[column] ?? 0, world[column + 1] ?? 0, world[column + 2] ?? 0]);
      const c = cross(a, d);
      if (dot(c, c) < DEGENERATE_LENGTH_SQUARED)
        return void 0;
      const cn = unit(c);
      rows = constraint.lock === "own-x" ? [a, cn, cross(a, cn)] : [cn, cross(a, cn), a];
      break;
    }
    case "free": {
      const e = cross(d, camera.up);
      if (dot(e, e) < DEGENERATE_LENGTH_SQUARED)
        break;
      const en = unit(e);
      rows = [en, d, unit(cross(en, d))];
      break;
    }
  }
  if (rows.some((row) => Math.abs(dot(row, row) - 1) >= ORTHONORMAL_TOLERANCE))
    return void 0;
  let q = normalizeQuat(quaternionFromRotationMatrix([...rows[0], ...rows[1], ...rows[2]]));
  if (root) {
    q = multiplyQuat(q, spin);
    if (constraint.rootCorrection !== void 0)
      q = multiplyQuat(q, rotation(constraint.rootCorrection));
  } else if (constraint.correction !== void 0)
    q = multiplyQuat(q, rotation(constraint.correction));
  return q;
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/uvm/billboards.js
var UVM_NODE_BILLBOARD = "UV_node_billboard";
function readUvmBillboards(document, maxBytes, signal) {
  signal?.throwIfAborted();
  const nodes = array2(document, "nodes"), values = [];
  let bytes = 0;
  for (const [index2, node] of nodes.entries()) {
    signal?.throwIfAborted();
    const raw = field2(field2(node, "extensions"), UVM_NODE_BILLBOARD);
    if (raw === void 0)
      continue;
    bytes += 512;
    if (bytes > maxBytes)
      throw new RangeError("UVM billboard constraints exceed byte budget");
    const value = object2(raw, "node billboard");
    if (value["schemaVersion"] === 1 && value["mode"] === "inverse-camera") {
      if (Object.keys(value).some((key) => !["schemaVersion", "mode", "basisRotations"].includes(key)))
        throw new TypeError("unsupported UVM node billboard");
      values.push({
        nodeId: `node-${index2}`,
        mode: "inverse-camera",
        basisRotations: value["basisRotations"]
      });
    } else if (value["schemaVersion"] === 1 && value["mode"] === "face-camera") {
      if (Object.keys(value).some((key) => !["schemaVersion", "mode", "rotationAxes", "pivot"].includes(key)))
        throw new TypeError("unsupported UVM node billboard");
      values.push({
        nodeId: `node-${index2}`,
        mode: "face-camera",
        rotationAxes: value["rotationAxes"],
        pivot: value["pivot"]
      });
    } else if (value["schemaVersion"] === 1 && value["mode"] === "aim") {
      if (Object.keys(value).some((key) => !["schemaVersion", "mode", "aim", "lock", "correction", "rootCorrection"].includes(key)))
        throw new TypeError("unsupported UVM node billboard");
      values.push({
        nodeId: `node-${index2}`,
        mode: "aim",
        aim: value["aim"],
        lock: value["lock"],
        ...value["correction"] === void 0 ? {} : { correction: value["correction"] },
        ...value["rootCorrection"] === void 0 ? {} : { rootCorrection: value["rootCorrection"] }
      });
    } else
      throw new TypeError("unsupported UVM node billboard");
  }
  if (values.length > 0 && !array2(document, "extensionsUsed").includes(UVM_NODE_BILLBOARD))
    throw new TypeError("UVM node billboard declaration absent");
  return snapshotModelBillboards(values, maxBytes, signal);
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/uvm/rig.js
var identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function clipEvents(animation, nodeCount) {
  const events = uvmAnimationEvents(field2(animation["extensions"], "UV_game_animation_events"), nodeCount);
  return events.length === 0 ? {} : {
    events: events.map((event) => ({
      timeSeconds: event.t,
      name: event.name,
      ...event.socket === void 0 ? {} : { nodeId: `node-${event.socket}` },
      ...event.payload === void 0 ? {} : { payload: event.payload },
      ...event.duration === void 0 ? {} : { durationSeconds: event.duration }
    }))
  };
}
function uvMetadata(value) {
  const extras = value["extras"];
  if (extras === void 0)
    return {};
  const uv = object2(extras, "UVM extras")["uv"];
  return uv === void 0 ? {} : object2(uv, "UVM metadata");
}
function decodeUvmRig(document, readAccessor, maxScalarBytes, sceneNodes, signal) {
  signal?.throwIfAborted();
  const nodes = array2(document, "nodes").map((value) => object2(value, "UVM node"));
  const skins = array2(document, "skins").map((value) => object2(value, "UVM skin"));
  const parents = /* @__PURE__ */ new Map();
  for (const [parent, node] of nodes.entries()) {
    for (const child of array2(node, "children")) {
      const childIndex = safeIndex2(child, nodes.length, "joint parent");
      if (parents.has(childIndex))
        throw new TypeError("UVM node has multiple parents");
      parents.set(childIndex, parent);
    }
  }
  const done = /* @__PURE__ */ new Set();
  const rootByNode = /* @__PURE__ */ new Map();
  for (let node = 0; node < nodes.length; node++) {
    const path = /* @__PURE__ */ new Set();
    let cursor = node;
    let root = node;
    while (cursor !== void 0 && !done.has(cursor)) {
      if (path.has(cursor))
        throw new TypeError("UVM node hierarchy is cyclic");
      path.add(cursor);
      root = cursor;
      cursor = parents.get(cursor);
    }
    if (cursor !== void 0)
      root = required(rootByNode.get(cursor), "hierarchy root");
    for (const item of path) {
      done.add(item);
      rootByNode.set(item, root);
    }
  }
  let decodedBytes = 0;
  const read = (accessor, label) => {
    signal?.throwIfAborted();
    const result = readAccessor(accessor, maxScalarBytes - decodedBytes, label);
    decodedBytes += result.values.byteLength;
    if (!result.values.every(Number.isFinite))
      throw new TypeError(`UVM ${label} contains non-finite values`);
    return result;
  };
  const bindings = [];
  const animations = array2(document, "animations").map((value) => object2(value, "UVM animation"));
  const catalog = readUvmAnimationClips(document, signal);
  const visibility = readUvmPrimitiveVisibility(document, signal);
  const animatedNodes = /* @__PURE__ */ new Set();
  for (const animation of animations) {
    for (const candidate of array2(animation, "channels")) {
      const channel2 = object2(candidate, "UVM animation channel");
      const target = object2(channel2["target"] ?? {}, "UVM animation target");
      if (typeof target["path"] === "string" && ["translation", "rotation", "scale"].includes(target["path"]))
        animatedNodes.add(safeIndex2(target["node"], nodes.length, "animation target"));
    }
  }
  let incompleteBindings = 0;
  for (const [skinIndex, skin] of skins.entries()) {
    const joints = array2(skin, "joints").map((joint) => safeIndex2(joint, nodes.length, "skin joint"));
    if (joints.length === 0 || new Set(joints).size !== joints.length)
      throw new TypeError("UVM skin needs unique joints");
    const slots = new Map(joints.map((joint, slot) => [safeIndex2(joint, nodes.length, "skin joint"), slot]));
    if (joints.some((joint) => rootByNode.get(joint) !== rootByNode.get(required(joints[0], "first joint"))))
      throw new TypeError("UVM skin joints have no common root");
    if (skin["skeleton"] !== void 0) {
      const skeletonRoot = safeIndex2(skin["skeleton"], nodes.length, "skeleton root");
      const descendants = /* @__PURE__ */ new Set([skeletonRoot]);
      for (const joint of joints) {
        const path = [];
        let current = joint;
        while (current !== void 0 && !descendants.has(current)) {
          path.push(current);
          current = parents.get(current);
        }
        if (current === void 0)
          throw new TypeError("UVM declared skeleton root is not a common ancestor");
        for (const child of path)
          descendants.add(child);
      }
    }
    const matrices = skin["inverseBindMatrices"] === void 0 ? void 0 : read(skin["inverseBindMatrices"], "inverse bind matrices");
    if (matrices !== void 0 && (matrices.width !== 16 || matrices.componentType !== 5126 || matrices.normalized || matrices.count < joints.length))
      throw new TypeError("UVM inverse bind matrices must be float MAT4 values for every joint");
    for (const [boneIndex, joint] of joints.entries()) {
      const node = required(nodes[joint], "skin joint");
      let parent = parents.get(joint);
      let identityChain = true;
      while (parent !== void 0 && !slots.has(parent) && !animatedNodes.has(parent)) {
        identityChain &&= required(sceneNodes[parent], "parent scene node").transform.every((value, index2) => value === (index2 % 5 === 0 ? 1 : 0));
        parent = parents.get(parent);
      }
      const parentBoneIndex = parent === void 0 ? null : identityChain ? slots.get(parent) : void 0;
      const localPose = node["matrix"] === void 0 ? {
        translation: vector3(node["translation"] ?? [0, 0, 0]),
        rotation: vector4(node["rotation"] ?? [0, 0, 0, 1]),
        scale: vector3(node["scale"] ?? [1, 1, 1])
      } : void 0;
      if (parentBoneIndex === void 0 || localPose === void 0)
        incompleteBindings++;
      const inverseBindMatrix = matrices === void 0 ? identity() : Array.from(matrices.values.subarray(boneIndex * 16, boneIndex * 16 + 16));
      if (inverseBindMatrix[3] !== 0 || inverseBindMatrix[7] !== 0 || inverseBindMatrix[11] !== 0 || inverseBindMatrix[15] !== 1)
        throw new TypeError("UVM inverse bind matrix must be affine");
      bindings.push({
        partId: `skin-${skinIndex}`,
        hierarchyId: `skin-${skinIndex}`,
        boneIndex,
        boneName: typeof node["name"] === "string" ? node["name"] : null,
        provenance: "direct",
        nodeId: `node-${joint}`,
        inverseBindMatrix,
        ...parentBoneIndex === void 0 ? {} : { parentBoneIndex },
        ...localPose === void 0 ? {} : { localPose }
      });
    }
  }
  const clips = [];
  for (const [clipIndex, animation] of animations.entries()) {
    const samplers = array2(animation, "samplers").map((value) => object2(value, "UVM animation sampler"));
    const channels = [];
    const targets = /* @__PURE__ */ new Set();
    const frames = /* @__PURE__ */ new Set();
    let unsupportedChannels = 0;
    let durationSeconds = 0;
    for (const candidate of array2(animation, "channels")) {
      const channel2 = object2(candidate, "UVM animation channel");
      const sampler = required(samplers[safeIndex2(channel2["sampler"], samplers.length, "animation sampler")], "animation sampler");
      const input = read(sampler["input"], "animation time");
      if (input.width !== 1 || input.componentType !== 5126 || input.normalized || input.count === 0)
        throw new TypeError("UVM animation time accessor shape is invalid");
      let previous = -Infinity;
      for (const time of input.values) {
        if (time < 0 || time <= previous)
          throw new TypeError("UVM animation times must be nonnegative and strictly increasing");
        previous = time;
        frames.add(time);
        durationSeconds = Math.max(durationSeconds, time);
      }
      const target = object2(channel2["target"] ?? {}, "UVM animation target");
      const targetPath = target["path"];
      const visible = targetPath === "pointer" ? uvmVisibilityTarget(field2(field2(target["extensions"], "KHR_animation_pointer"), "pointer"), visibility) : void 0;
      if (visible === void 0 && (typeof targetPath !== "string" || !["translation", "rotation", "scale", "weights"].includes(targetPath))) {
        unsupportedChannels++;
        continue;
      }
      const node = visible === void 0 ? safeIndex2(target["node"], nodes.length, "animation target") : void 0;
      const morphWeights = targetPath === "weights";
      if (node !== void 0 && !morphWeights && required(nodes[node], "animation target")["matrix"] !== void 0)
        throw new TypeError("UVM animated node cannot use matrix");
      const morphTargets = (() => {
        if (!morphWeights || node === void 0)
          return 0;
        const meshes = array2(document, "meshes");
        const mesh = required(nodes[node], "morph node")["mesh"];
        if (mesh === void 0)
          throw new TypeError("UVM weights channel targets a node without a mesh");
        const primitive = array2(object2(meshes[safeIndex2(mesh, meshes.length, "morph mesh")], "morph mesh"), "primitives")[0];
        const targets2 = primitive === void 0 ? [] : array2(object2(primitive, "morph primitive"), "targets");
        if (targets2.length === 0)
          throw new TypeError("UVM weights channel targets a mesh without morph targets");
        return targets2.length;
      })();
      const targetId = visible === void 0 ? `node-${node}` : "node" in visible ? `node-${visible.node}` : `mesh-${visible.mesh}-primitive-${visible.primitive}`;
      const key = `${targetId}/${targetPath}`;
      if (targets.has(key))
        throw new TypeError("UVM animation repeats a node property");
      targets.add(key);
      const interpolation = sampler["interpolation"] ?? "LINEAR";
      if (typeof interpolation !== "string" || !["STEP", "LINEAR", "CUBICSPLINE"].includes(interpolation))
        throw new TypeError("UVM animation interpolation is invalid");
      const cubic = interpolation === "CUBICSPLINE";
      const output = read(sampler["output"], "animation value");
      const width = morphWeights ? morphTargets : visible !== void 0 ? 1 : targetPath === "rotation" ? 4 : 3;
      if (output.width !== (morphWeights ? 1 : width) || output.count * output.width !== input.count * (cubic ? 3 : 1) * width || output.componentType !== 5126 || output.normalized)
        throw new TypeError("UVM animation input/output accessor shape is invalid");
      const metadata2 = uvMetadata(channel2);
      const keyTimes = readUvmKeyTimes(metadata2["keyTimes"], { values: input.values, maxScalarBytes: maxScalarBytes - decodedBytes }, signal);
      if (keyTimes !== void 0)
        decodedBytes += keyTimes.length * 8;
      const samples = Array.from(keyTimes ?? input.values, (timeSeconds, frame) => {
        const at = (slot) => {
          const start = (cubic ? frame * 3 + slot : frame) * width;
          return Array.from(output.values.subarray(start, start + width));
        };
        const value = at(cubic ? 1 : 0);
        if (width === 4 && !morphWeights && Math.abs(Math.hypot(...value) - 1) > 1e-4)
          throw new TypeError("UVM animation quaternion is not a unit quaternion");
        return cubic ? { frame, timeSeconds, value, inTangent: at(0), outTangent: at(2) } : { frame, timeSeconds, value };
      });
      if (metadata2["globalSeqId"] !== void 0) {
        unsupportedChannels++;
        continue;
      }
      if (metadata2["concurrent"] !== void 0 && typeof metadata2["concurrent"] !== "boolean")
        throw new TypeError("UVM animation concurrent flag is invalid");
      if (metadata2["wrapSeconds"] !== void 0 && (metadata2["concurrent"] !== true || typeof metadata2["wrapSeconds"] !== "number" || !Number.isFinite(metadata2["wrapSeconds"]) || metadata2["wrapSeconds"] <= 0))
        throw new TypeError("UVM animation independent wrap duration is invalid");
      if (metadata2["repeatCount"] !== void 0 && (metadata2["concurrent"] !== true || typeof metadata2["repeatCount"] !== "number" || !Number.isSafeInteger(metadata2["repeatCount"]) || metadata2["repeatCount"] < 0 || metadata2["wrapSeconds"] === void 0))
        throw new TypeError("UVM animation independent repeat count is invalid");
      channels.push({
        target: targetId,
        kind: visible !== void 0 ? "visibility" : String(targetPath),
        firstFrame: 0,
        lastFrame: samples.length - 1,
        samples,
        interpolation: interpolation === "STEP" ? "step" : cubic ? "cubic-spline" : width === 4 && !morphWeights ? "spherical-linear" : "linear",
        ...metadata2["concurrent"] === void 0 ? {} : { concurrent: metadata2["concurrent"] },
        ...metadata2["wrapSeconds"] === void 0 ? {} : { wrapSeconds: metadata2["wrapSeconds"] },
        ...metadata2["repeatCount"] === void 0 ? {} : { repeatCount: metadata2["repeatCount"] }
      });
    }
    const metadata = uvMetadata(animation);
    if (metadata["sourceDurationSeconds"] !== void 0) {
      if (typeof metadata["sourceDurationSeconds"] !== "number" || !Number.isFinite(metadata["sourceDurationSeconds"]) || metadata["sourceDurationSeconds"] < 0)
        throw new TypeError("UVM source animation duration is invalid");
      durationSeconds = metadata["sourceDurationSeconds"];
    }
    if (metadata["looping"] !== void 0 && typeof metadata["looping"] !== "boolean")
      throw new TypeError("UVM animation looping flag is invalid");
    if (metadata["repeatCount"] !== void 0 && (typeof metadata["repeatCount"] !== "number" || !Number.isSafeInteger(metadata["repeatCount"]) || metadata["repeatCount"] < 0))
      throw new TypeError("UVM animation repeat count is invalid");
    const sequenceIndex = metadata["sourceSequenceIndex"];
    if (sequenceIndex !== void 0 && (typeof sequenceIndex !== "number" || !Number.isSafeInteger(sequenceIndex) || sequenceIndex < 0))
      throw new TypeError("UVM animation sequence index is invalid");
    clips.push({
      id: `animation-${clipIndex}`,
      name: typeof animation["name"] === "string" ? animation["name"] : "",
      kind: frames.size > 1 ? "animation" : "rest-pose",
      provenance: "direct",
      frames: frames.size,
      durationSeconds,
      channels,
      ...metadata["looping"] === void 0 ? {} : { looping: metadata["looping"] },
      ...metadata["repeatCount"] === void 0 ? {} : { repeatCount: metadata["repeatCount"] },
      ...uvmAnimationPlayback(field2(animation["extensions"], "UV_game_animation_clips")),
      ...clipEvents(animation, nodes.length),
      ...unsupportedChannels === 0 ? {} : { unsupportedChannels },
      ...sequenceIndex === void 0 ? {} : { sequenceIndex }
    });
  }
  const selectable = catalog === void 0 ? clips : catalog.map((entry) => {
    const sampled = entry.animation === void 0 ? void 0 : required(clips[entry.animation], "catalog animation");
    return {
      ...sampled,
      id: entry.id,
      name: entry.name,
      durationSeconds: entry.durationSeconds,
      sequenceIndex: entry.sourceSequenceIndex,
      kind: entry.kind ?? sampled?.kind ?? (entry.durationSeconds > 0 ? "animation" : "rest-pose"),
      provenance: "direct",
      frames: entry.frames ?? sampled?.frames ?? 0,
      channels: sampled?.channels ?? [],
      ...entry.looping === void 0 ? {} : { looping: entry.looping },
      ...entry.repeatCount === void 0 ? {} : { repeatCount: entry.repeatCount }
    };
  });
  const jointNodes = new Set(bindings.map((binding) => binding.nodeId));
  const nodePoses = [...animatedNodes].filter((node) => !jointNodes.has(`node-${node}`)).map((node) => {
    const source = required(nodes[node], "animated node");
    return {
      nodeId: `node-${node}`,
      localPose: {
        translation: vector3(source["translation"] ?? [0, 0, 0]),
        rotation: vector4(source["rotation"] ?? [0, 0, 0, 1]),
        scale: vector3(source["scale"] ?? [1, 1, 1])
      }
    };
  });
  return { bindings, nodePoses, clips: selectable, incompleteBindings, decodedBytes };
}
function uvmMeshSkins(document) {
  const result = /* @__PURE__ */ new Map();
  const skins = array2(document, "skins");
  for (const candidate of array2(document, "nodes")) {
    const node = object2(candidate, "UVM node");
    if (node["mesh"] === void 0)
      continue;
    const mesh = safeIndex2(node["mesh"], array2(document, "meshes").length, "skinned mesh");
    const skin = node["skin"] === void 0 ? null : safeIndex2(node["skin"], skins.length, "mesh skin");
    if (result.has(mesh) && result.get(mesh) !== skin)
      throw new TypeError("UVM mesh instances use different skin bindings, which the mesh facet cannot represent");
    result.set(mesh, skin);
  }
  return result;
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/uvm/geometry.js
function floatValues(accessor) {
  if (!(accessor.values instanceof Float32Array))
    throw new TypeError("UVM vertex values must be float32");
  return accessor.values;
}
function identityTransform() {
  return Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function nodeTransform(node) {
  const hasTrs = ["translation", "rotation", "scale"].some((key) => node[key] !== void 0);
  if (node["matrix"] !== void 0) {
    if (hasTrs || !finiteArray2(node["matrix"], 16))
      throw new TypeError("UVM node matrix must be finite and cannot coexist with TRS");
    return { transform: Object.freeze([...node["matrix"]]) };
  }
  if (!hasTrs)
    return { transform: identityTransform() };
  const translation2 = node["translation"] === void 0 ? [0, 0, 0] : node["translation"];
  const rotation2 = node["rotation"] === void 0 ? [0, 0, 0, 1] : node["rotation"];
  const scale = node["scale"] === void 0 ? [1, 1, 1] : node["scale"];
  if (!finiteArray2(translation2, 3) || !finiteArray2(rotation2, 4) || !finiteArray2(scale, 3))
    throw new TypeError("UVM node TRS must contain finite VEC3/VEC4 values");
  if (Math.abs(Math.hypot(...rotation2) - 1) > 1e-4)
    throw new TypeError("UVM node rotation must be a unit quaternion");
  const transform = new Float32Array(16);
  composeTrsMatrix(transform, 0, translation2, rotation2, scale);
  if (!transform.every(Number.isFinite))
    throw new RangeError("UVM node TRS exceeds the finite transform range");
  return {
    transform: Object.freeze(Array.from(transform)),
    trs: Object.freeze({
      translation: Object.freeze([...translation2]),
      rotation: Object.freeze([...rotation2]),
      scale: Object.freeze([...scale])
    })
  };
}
function decodeUvmGeometry(document, binary, budget, signal) {
  const nodes = array2(document, "nodes");
  const meshes = array2(document, "meshes");
  const materials = array2(document, "materials");
  const textures = array2(document, "textures");
  const animations = array2(document, "animations");
  signal?.throwIfAborted();
  const meshSkins = uvmMeshSkins(document);
  const hiddenPrimitiveIds = new Set(readUvmPrimitiveVisibility(document, signal).flatMap((item) => "mesh" in item && item.value <= 0 ? [`mesh-${item.mesh}-primitive-${item.primitive}`] : []));
  const primitives = [];
  let decodedGeometryBytes = 0;
  const remaining = () => ({
    maxScalarBytes: budget.maxScalarBytes - decodedGeometryBytes
  });
  const charge = (bytes) => {
    if (!Number.isSafeInteger(bytes) || bytes > budget.maxScalarBytes - decodedGeometryBytes)
      throw new RangeError("UVM geometry exceeds maxScalarBytes budget");
    decodedGeometryBytes += bytes;
  };
  const modelMeshes = meshes.map((candidate, meshIndex) => {
    signal?.throwIfAborted();
    const mesh = object2(candidate, `mesh ${meshIndex}`);
    const extras = mesh["extras"];
    const names = extras !== null && typeof extras === "object" && !Array.isArray(extras) ? extras["targetNames"] : void 0;
    const targetNames = Array.isArray(names) ? names : [];
    let targetCount;
    const primitiveIds = array2(mesh, "primitives").map((candidatePrimitive, primitiveIndex) => {
      const primitive = object2(candidatePrimitive, `mesh ${meshIndex} primitive ${primitiveIndex}`);
      if ((primitive["mode"] ?? 4) !== 4)
        throw new TypeError("UVM/core currently requires triangles");
      const attributes = object2(primitive["attributes"], "UVM primitive attributes");
      const position2 = readUvmAccessor(document, binary, attributes["POSITION"], remaining(), "positions", signal);
      const positions = floatValues(position2);
      if (position2.width !== 3 || position2.componentType !== 5126 || position2.normalized) {
        throw new TypeError("UVM POSITION must be a float VEC3 accessor");
      }
      if (!positions.every(Number.isFinite))
        throw new TypeError("UVM POSITION contains non-finite values");
      charge(positions.byteLength);
      let indices;
      if (primitive["indices"] === void 0) {
        charge(position2.count * 4);
        indices = Uint32Array.from({ length: position2.count }, (_unused, index2) => index2);
      } else {
        const accessor = readUvmAccessor(document, binary, primitive["indices"], remaining(), "indices", signal);
        if (accessor.width !== 1 || accessor.normalized || ![5121, 5123, 5125].includes(accessor.componentType))
          throw new TypeError("UVM indices must be unsigned integer SCALAR values");
        indices = accessor.values;
        charge(indices.byteLength);
      }
      if (indices.length % 3 !== 0)
        throw new TypeError("UVM indices must form triangles");
      if (indices.some((index2) => index2 >= position2.count))
        throw new RangeError("UVM index exceeds POSITION count");
      const vertexAttribute = (semantic, width) => {
        if (attributes[semantic] === void 0)
          return void 0;
        const attribute = readUvmAccessor(document, binary, attributes[semantic], remaining(), semantic, signal);
        const color = semantic === "COLOR_0";
        if (attribute.componentType === 5126 && attribute.normalized)
          throw new TypeError(`UVM ${semantic} float accessor cannot use normalized`);
        const normalizedInteger = (color || semantic === "WEIGHTS_0" || semantic.startsWith("TEXCOORD_")) && attribute.normalized && [5121, 5123].includes(attribute.componentType);
        if (attribute.width !== width && !(color && attribute.width === 3) || attribute.count !== position2.count || attribute.componentType !== 5126 && !normalizedInteger) {
          throw new TypeError(`UVM ${semantic} must be a supported VEC${width} matching POSITION count`);
        }
        if (!attribute.values.every(Number.isFinite))
          throw new TypeError(`UVM ${semantic} contains non-finite values`);
        let values = floatValues(attribute);
        if (normalizedInteger) {
          const divisor = attribute.componentType === 5121 ? 255 : 65535;
          for (let index2 = 0; index2 < values.length; index2 += 1)
            values[index2] = required(values[index2], semantic) / divisor;
        }
        if (color && attribute.width === 3) {
          charge(position2.count * 16);
          values = new Float32Array(position2.count * 4);
          for (let index2 = 0; index2 < position2.count; index2 += 1) {
            values.set(attribute.values.subarray(index2 * 3, index2 * 3 + 3), index2 * 4);
            values[index2 * 4 + 3] = 1;
          }
        } else
          charge(values.byteLength);
        if (color) {
          for (let index2 = 0; index2 < values.length; index2 += 1)
            values[index2] = Math.min(1, Math.max(0, required(values[index2], semantic)));
        }
        return values;
      };
      const normals = vertexAttribute("NORMAL", 3);
      const tangents = vertexAttribute("TANGENT", 4);
      const colors = vertexAttribute("COLOR_0", 4);
      const boneWeights = vertexAttribute("WEIGHTS_0", 4);
      let boneIndices;
      let hierarchyId;
      if (attributes["JOINTS_0"] !== void 0 || boneWeights !== void 0) {
        if (attributes["JOINTS_1"] !== void 0 || attributes["WEIGHTS_1"] !== void 0)
          throw new TypeError("UVM joint sets beyond four influences need a richer geometry facet");
        const skin = meshSkins.get(meshIndex);
        if (skin === void 0 || skin === null || boneWeights === void 0 || attributes["JOINTS_0"] === void 0)
          throw new TypeError("UVM joint indices and weights need a paired mesh skin binding");
        const joints = readUvmAccessor(document, binary, attributes["JOINTS_0"], remaining(), "joint indices", signal);
        const jointCount = array2(array2(document, "skins")[skin], "joints").length;
        if (joints.width !== 4 || joints.count !== position2.count || joints.normalized || ![5121, 5123].includes(joints.componentType) || joints.values.some((value) => value >= jointCount))
          throw new TypeError("UVM joint indices must reference valid skin slots");
        charge(joints.values.byteLength);
        boneIndices = Uint32Array.from(joints.values);
        if (boneWeights.some((value) => value < 0 || value > 1))
          throw new TypeError("UVM skin weights are outside zero to one");
        for (let offset = 0; offset < boneWeights.length; offset += 4) {
          const sum = required(boneWeights[offset], "skin weight") + required(boneWeights[offset + 1], "skin weight") + required(boneWeights[offset + 2], "skin weight") + required(boneWeights[offset + 3], "skin weight");
          if (Math.abs(sum - 1) > 1e-4)
            throw new TypeError("UVM skin weights must sum to one");
        }
        hierarchyId = `skin-${skin}`;
      }
      const textureCoordinateSets = Object.keys(attributes).filter((semantic) => /^TEXCOORD_(?:0|[1-9][0-9]*)$/u.test(semantic)).map((semantic) => {
        const set = Number(semantic.slice("TEXCOORD_".length));
        if (!Number.isSafeInteger(set))
          throw new TypeError("UVM UV set index is invalid");
        return { set, coordinates: required(vertexAttribute(semantic, 2), semantic) };
      }).sort((a, b) => a.set - b.set);
      if (textureCoordinateSets.some((channel2, index2) => channel2.set !== index2)) {
        throw new TypeError("UVM UV sets must be consecutive from zero");
      }
      const textureCoordinates = textureCoordinateSets.find((channel2) => channel2.set === 0)?.coordinates;
      const targetList = primitive["targets"];
      if (targetList !== void 0 && !Array.isArray(targetList))
        throw new TypeError("UVM morph targets must be an array");
      const morphTargets = (Array.isArray(targetList) ? targetList : []).map((candidateTarget, targetIndex) => {
        const target = object2(candidateTarget, `mesh ${meshIndex} primitive ${primitiveIndex} morph target ${targetIndex}`);
        const delta = (semantic) => {
          if (target[semantic] === void 0)
            return void 0;
          const accessor = readUvmAccessor(document, binary, target[semantic], remaining(), `morph ${semantic}`, signal);
          if (accessor.width !== 3 || accessor.count !== position2.count || accessor.componentType !== 5126 || accessor.normalized)
            throw new TypeError(`UVM morph ${semantic} must be float VEC3 deltas matching POSITION`);
          const values = floatValues(accessor);
          if (!values.every(Number.isFinite))
            throw new TypeError(`UVM morph ${semantic} contains non-finite values`);
          charge(values.byteLength);
          return values;
        };
        const deltas = delta("POSITION");
        if (deltas === void 0)
          charge(position2.count * 12);
        const normalDeltas = delta("NORMAL");
        const tangentDeltas = delta("TANGENT");
        const name = targetNames[targetIndex];
        return {
          ...typeof name === "string" ? { name } : {},
          positions: deltas ?? new Float32Array(position2.count * 3),
          ...normalDeltas === void 0 ? {} : { normals: normalDeltas },
          ...tangentDeltas === void 0 ? {} : { tangents: tangentDeltas }
        };
      });
      if (targetCount !== void 0 && targetCount !== morphTargets.length)
        throw new TypeError("UVM mesh primitives must carry the same number of morph targets");
      targetCount = morphTargets.length;
      charge(textureCoordinates?.byteLength ?? 0);
      const id = `mesh-${meshIndex}-primitive-${primitiveIndex}`;
      primitives.push({
        id,
        topology: "triangles",
        positions,
        indices,
        ...normals === void 0 ? {} : { normals },
        ...tangents === void 0 ? {} : { tangents },
        ...colors === void 0 ? {} : { colors },
        ...boneIndices === void 0 ? {} : {
          boneIndices,
          boneWeights: required(boneWeights, "skin weights"),
          hierarchyId: required(hierarchyId, "skin hierarchy")
        },
        ...textureCoordinates === void 0 ? {} : { textureCoordinates },
        ...textureCoordinateSets.length === 0 ? {} : { textureCoordinateSets },
        ...primitive["material"] !== void 0 ? {
          materialId: `material-${safeIndex2(primitive["material"], materials.length, "primitive material")}`
        } : {},
        ...morphTargets.length === 0 ? {} : { morphTargets },
        ...hiddenPrimitiveIds.has(id) ? { hidden: true } : {}
      });
      return id;
    });
    const weights = mesh["weights"];
    if (weights !== void 0 && (!Array.isArray(weights) || weights.length !== (targetCount ?? 0) || !weights.every((weight) => typeof weight === "number" && Number.isFinite(weight))))
      throw new TypeError("UVM mesh weights must be one finite number per morph target");
    return {
      id: `mesh-${meshIndex}`,
      ...typeof mesh["name"] === "string" ? { name: mesh["name"] } : {},
      primitiveIds,
      ...Array.isArray(weights) && weights.length > 0 ? { morphWeights: Object.freeze([...weights]) } : {}
    };
  });
  const modelNodes = nodes.map((candidate, nodeIndex) => {
    const node = object2(candidate, `node ${nodeIndex}`);
    const childIds = (Array.isArray(node["children"]) ? node["children"] : []).map((child) => `node-${safeIndex2(child, nodes.length, `node ${nodeIndex} child`)}`);
    const meshIds = node["mesh"] === void 0 ? [] : [`mesh-${safeIndex2(node["mesh"], meshes.length, "node mesh")}`];
    return {
      id: `node-${nodeIndex}`,
      ...typeof node["name"] === "string" ? { name: node["name"] } : {},
      childIds,
      meshIds,
      ...nodeTransform(node)
    };
  });
  return Object.freeze({
    nodes: modelNodes,
    meshes: modelMeshes,
    primitives,
    materials: materials.length,
    textures: textures.length,
    animations: animations.length,
    decodedGeometryBytes
  });
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/uvm/model.js
function readUvmModel(document, binary, budget, signal) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(budget.maxScalarBytes) || budget.maxScalarBytes < 0)
    throw new TypeError("invalid UVM scalar budget");
  const scene = decodeUvmGeometry(document, binary, budget, signal);
  const rig = decodeUvmRig(document, (accessor, maxScalarBytes, purpose) => readUvmAccessor(document, binary, accessor, { maxScalarBytes }, purpose, signal), budget.maxScalarBytes - scene.decodedGeometryBytes, scene.nodes, signal);
  return Object.freeze({ scene, rig });
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/uvm/images.js
function uvmImageResourceId(document, index2) {
  const images = array2(document, "images");
  const image = object2(images[safeIndex2(index2, images.length, "image")], "image");
  if (typeof image["name"] === "string" && image["name"].length > 0)
    return image["name"];
  if (typeof image["uri"] === "string" && !image["uri"].startsWith("data:"))
    return uvmImageLogicalId(image["uri"]);
  return `uvm-image-${index2}`;
}
function opaqueTexels(rgba) {
  const opaque = rgba.slice();
  for (let alpha = 3; alpha < opaque.length; alpha += 4)
    opaque[alpha] = 255;
  return opaque;
}
function uvmImageFilters(document) {
  const textures = array2(document, "textures");
  const samplers = document["samplers"] === void 0 ? [] : array2(document, "samplers");
  const byImage = /* @__PURE__ */ new Map();
  for (const candidate of textures) {
    const texture = object2(candidate, "texture");
    const source = texture["source"];
    const samplerIndex = texture["sampler"];
    if (typeof source !== "number" || typeof samplerIndex !== "number")
      continue;
    const magnified = object2(samplers[samplerIndex] ?? {}, "sampler")["magFilter"];
    const filter = magnified === 9728 ? "nearest" : magnified === 9729 ? "linear" : void 0;
    if (filter === void 0)
      continue;
    const known = byImage.get(source);
    byImage.set(source, known === void 0 || known === filter ? filter : null);
  }
  const filters = /* @__PURE__ */ new Map();
  for (const [image, filter] of byImage)
    if (filter !== null)
      filters.set(uvmImageResourceId(document, image), filter);
  return filters;
}
function prepareUvmTextureImages(document, binary, indices, maxEmbeddedBytes, signal) {
  const textures = array2(document, "textures"), images = array2(document, "images");
  const imageIndices = indices.map((textureIndex) => {
    const texture = object2(textures[safeIndex2(textureIndex, textures.length, "texture")], "texture");
    return safeIndex2(texture["source"], images.length, "texture image");
  });
  return prepareUvmImages(document, binary, imageIndices, maxEmbeddedBytes, signal).map((image, index2) => Object.freeze({ ...image, texture: indices[index2] }));
}
function prepareUvmImages(document, binary, indices, maxEmbeddedBytes, signal) {
  if (!Number.isSafeInteger(maxEmbeddedBytes) || maxEmbeddedBytes < 0)
    throw new TypeError("invalid image budget");
  const images = array2(document, "images"), views = array2(document, "bufferViews");
  const captured = /* @__PURE__ */ new Map();
  let remaining = maxEmbeddedBytes;
  return indices.map((index2) => {
    signal?.throwIfAborted();
    const imageIndex = safeIndex2(index2, images.length, "image");
    let source = captured.get(imageIndex);
    if (source === void 0) {
      const image = object2(images[imageIndex], "image");
      const mediaType = image["mimeType"] === void 0 ? void 0 : string(image["mimeType"], "image mimeType");
      if (image["uri"] === void 0 === (image["bufferView"] === void 0))
        throw new TypeError("UVM image requires exactly one URI or bufferView");
      if (image["uri"] !== void 0) {
        const uri = string(image["uri"], "image URI");
        if (uri.startsWith("data:")) {
          const comma = uri.indexOf(",");
          if (comma < 0)
            throw new TypeError("invalid image data URI");
          const declaration = uri.slice(5, comma), payload = uri.slice(comma + 1);
          const declaredType = declaration.split(";")[0];
          if (mediaType !== void 0 && declaredType !== "" && declaredType !== mediaType)
            throw new TypeError("image data URI and mimeType disagree");
          let bytes;
          if (declaration.endsWith(";base64")) {
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(payload))
              throw new TypeError("invalid image base64");
            const length = payload.length / 4 * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
            if (length > remaining)
              throw new RangeError("embedded images exceed budget");
            bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
          } else {
            let length = 0;
            for (let i = 0; i < payload.length; i++, length++) {
              if (payload[i] === "%") {
                if (!/^[0-9a-f]{2}$/iu.test(payload.slice(i + 1, i + 3)))
                  throw new TypeError("invalid image URI escape");
                i += 2;
              } else if (payload.charCodeAt(i) > 127)
                throw new TypeError("image URI bytes must be percent encoded");
            }
            if (length > remaining)
              throw new RangeError("embedded images exceed budget");
            bytes = new Uint8Array(length);
            for (let i = 0, j = 0; i < payload.length; i++, j++) {
              if (payload[i] === "%") {
                bytes[j] = parseInt(payload.slice(i + 1, i + 3), 16);
                i += 2;
              } else
                bytes[j] = payload.charCodeAt(i);
            }
          }
          remaining -= bytes.length;
          const type = mediaType ?? declaredType;
          source = { kind: "embedded", bytes, ...type ? { mediaType: type } : {} };
        } else
          source = {
            kind: "logical",
            requirement: {
              id: `uvm-image-${imageIndex}`,
              logicalId: uvmImageLogicalId(uri),
              role: "texture",
              scopes: [
                "sibling-directory",
                "workspace-dependency-layer",
                "current-mount",
                "enclosing-container"
              ]
            }
          };
      } else {
        const view = object2(views[safeIndex2(image["bufferView"], views.length, "image bufferView")], "image bufferView");
        const offset = view["byteOffset"] ?? 0, length = view["byteLength"];
        if (view["buffer"] !== 0 || view["byteStride"] !== void 0 || typeof offset !== "number" || typeof length !== "number" || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > binary.length || length > binary.length - offset)
          throw new TypeError("image bufferView must name a bounded slice of the UVM BIN chunk");
        if (length > remaining)
          throw new RangeError("embedded images exceed budget");
        remaining -= length;
        source = {
          kind: "embedded",
          bytes: binary.slice(offset, offset + length),
          ...mediaType === void 0 ? {} : { mediaType }
        };
      }
      captured.set(imageIndex, source);
    }
    return Object.freeze({ image: imageIndex, source });
  });
}
function uvmImageTexels(result, options = {}) {
  if (options.channels !== void 0 && options.channels !== "color" && options.channels !== "data")
    throw new TypeError("invalid image channel interpretation");
  const { info, region } = result;
  if (!["top-left", "bottom-left"].includes(info.orientation))
    throw new TypeError("image orientation is unknown");
  if (options.channels !== "data" && !["none", "straight", "premultiplied", "unknown"].includes(info.alphaMode))
    throw new TypeError("image alpha mode is invalid");
  if (!(region.pixels instanceof Uint8Array) || region.pixelFormat !== "rgba8" || region.width !== info.width || region.height !== info.height || !Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) || info.width <= 0 || info.height <= 0 || !Number.isSafeInteger(region.rowStride) || region.rowStride < info.width * 4 || region.rowStride * (info.height - 1) + info.width * 4 > region.pixels.length)
    throw new TypeError("invalid image region");
  const rgba = new Uint8Array(info.width * info.height * 4);
  for (let y = 0; y < info.height; y++) {
    const sourceY = info.orientation === "top-left" ? y : info.height - 1 - y;
    rgba.set(region.pixels.subarray(sourceY * region.rowStride, sourceY * region.rowStride + info.width * 4), y * info.width * 4);
  }
  if (options.channels !== "data" && info.alphaMode === "premultiplied")
    for (let i = 0; i < rgba.length; i += 4) {
      const alpha = rgba[i + 3] ?? 0;
      for (let channel2 = 0; channel2 < 3; channel2++)
        rgba[i + channel2] = alpha === 0 ? 0 : Math.min(255, Math.round((rgba[i + channel2] ?? 0) * 255 / alpha));
    }
  return rgba;
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/legacy/rig-kernels.js
var BufferBuilder = class {
  chunks = [];
  length = 0;
  append(bytes) {
    const aligned = this.length + 3 & ~3;
    if (aligned > this.length)
      this.push(new Uint8Array(aligned - this.length));
    const offset = this.length;
    this.push(bytes);
    return offset;
  }
  finish() {
    const result = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
  push(bytes) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }
};
var IDENTITY_MATRIX = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function encodeSkeleton(model, nodes, buffer, bufferViews, accessors) {
  if (model.skeleton.bones.length === 0) {
    return { skins: [], rootNodes: [], boneNodes: [], encodedBones: 0 };
  }
  const bones = [...model.skeleton.bones].sort((left, right) => left.index - right.index);
  for (const [index2, bone] of bones.entries()) {
    if (bone.index !== index2 || bone.parentIndex < -1 || bone.parentIndex >= bones.length) {
      throw new ModkitError({
        code: "CONFIG_INVALID",
        message: "UVM skeleton bone indices must be contiguous and parents must be in range.",
        context: { bone: bone.index, parent: bone.parentIndex, expected: index2 }
      });
    }
    const visited = /* @__PURE__ */ new Set([bone.index]);
    let parent = bone.parentIndex;
    while (parent >= 0) {
      if (visited.has(parent)) {
        throw new ModkitError({
          code: "CONFIG_INVALID",
          message: "UVM skeleton hierarchy contains a cycle.",
          context: { bone: bone.index, parent }
        });
      }
      visited.add(parent);
      parent = bones[parent]?.parentIndex ?? -1;
    }
  }
  for (const [meshIndex, mesh] of model.meshes.entries()) {
    for (const joint of mesh.boneIndices ?? []) {
      if (joint >= bones.length) {
        throw new ModkitError({
          code: "CONFIG_INVALID",
          message: "UVM mesh joint index is outside the skeleton.",
          context: { meshIndex, joint, bones: bones.length }
        });
      }
    }
  }
  const firstBoneNode = nodes.length;
  const boneNodes = bones.map((_bone, index2) => firstBoneNode + index2);
  const children = bones.map(() => []);
  const rootNodes = [];
  for (const bone of bones) {
    const node = firstBoneNode + bone.index;
    if (bone.parentIndex < 0)
      rootNodes.push(node);
    else
      children[bone.parentIndex]?.push(node);
  }
  for (const bone of bones) {
    const boneChildren = children[bone.index] ?? [];
    nodes.push({
      name: bone.name || `Bone_${bone.index}`,
      ...boneChildren.length > 0 ? { children: boneChildren } : {},
      ...bone.flags === void 0 ? {} : { extras: { sourceFlags: bone.flags } }
    });
  }
  const matrices = new Float32Array(bones.length * 16);
  for (const bone of bones) {
    const offset = bone.index * 16;
    const source = model.skeleton.skinningInverses === "identity" ? IDENTITY_MATRIX : bone.inverseBindMatrix ?? IDENTITY_MATRIX;
    if (source.length !== 16 || Array.from(source).some((value) => !Number.isFinite(value))) {
      throw new ModkitError({
        code: "CONFIG_INVALID",
        message: "UVM inverse bind matrices must contain sixteen finite values.",
        context: { bone: bone.index, values: source.length }
      });
    }
    matrices.set(source, offset);
  }
  const inverseBindMatrices = addAccessor(buffer, bufferViews, accessors, matrices, "MAT4", 5126);
  return {
    skins: [
      {
        joints: boneNodes,
        inverseBindMatrices,
        ...rootNodes[0] === void 0 ? {} : { skeleton: rootNodes[0] }
      }
    ],
    rootNodes,
    boneNodes,
    encodedBones: bones.length
  };
}
function addJointAttribute(attributes, mesh, vertexCount, buffer, bufferViews, accessors) {
  if (mesh.boneIndices) {
    if (mesh.boneIndices.length !== vertexCount * 4)
      throw invalidAttribute("JOINTS_0", mesh.boneIndices.length, vertexCount * 4);
    attributes.JOINTS_0 = addAccessor(buffer, bufferViews, accessors, mesh.boneIndices, "VEC4", 5123, 34962);
  }
  if (mesh.boneWeights)
    addAttribute(attributes, "WEIGHTS_0", mesh.boneWeights, vertexCount, 4, buffer, bufferViews, accessors);
}
function addAttribute(attributes, semantic, values, vertexCount, width, buffer, bufferViews, accessors) {
  if (!values)
    return;
  if (values.length !== vertexCount * width)
    throw invalidAttribute(semantic, values.length, vertexCount * width);
  attributes[semantic] = addAccessor(buffer, bufferViews, accessors, values, vectorType(width), 5126, 34962);
}
function encodeAnimationChannel(track, width, node, path, samplers, channels, buffer, bufferViews, accessors, concurrent, wrapSeconds) {
  if (track.keys.length === 0)
    return false;
  if (track.globalSeqId !== null && (!Number.isSafeInteger(track.globalSeqId) || track.globalSeqId < 0)) {
    return false;
  }
  if (track.globalSeqId !== null && concurrent)
    return false;
  if (track.lineType < 0 || track.lineType > 3)
    return false;
  let previous = Number.NEGATIVE_INFINITY;
  const times = new Float32Array(track.keys.length);
  const cubic = track.lineType === 2 || track.lineType === 3;
  const values = new Float32Array(track.keys.length * width * (cubic ? 3 : 1));
  for (const [index2, key] of track.keys.entries()) {
    if (!Number.isFinite(key.frame) || key.frame < 0 || key.frame <= previous || key.vector.length !== width || key.vector.some((value) => !Number.isFinite(value))) {
      return false;
    }
    previous = key.frame;
    times[index2] = key.frame;
  }
  if (cubic) {
    if (!encodeCubicEffectValues(track, times, width, values))
      return false;
  } else {
    for (const [index2, key] of track.keys.entries())
      values.set(key.vector, index2 * width);
  }
  const input = addAccessor(buffer, bufferViews, accessors, times, "SCALAR", 5126, void 0, bounds(times, 1));
  const output = addAccessor(buffer, bufferViews, accessors, values, width === 4 ? "VEC4" : "VEC3", 5126);
  const sampler = samplers.push({
    input,
    output,
    interpolation: track.lineType === 0 ? "STEP" : cubic ? "CUBICSPLINE" : "LINEAR"
  }) - 1;
  channels.push({
    sampler,
    target: { node, path },
    ...cubic || track.globalSeqId !== null || concurrent ? {
      extras: {
        uv: {
          sourceLineType: track.lineType,
          ...track.globalSeqId === null ? {} : { globalSeqId: track.globalSeqId },
          ...concurrent ? { concurrent: true, wrapSeconds } : {}
        }
      }
    } : {}
  });
  return true;
}
function encodeCubicEffectValues(track, times, components, values) {
  for (const [index2, key] of track.keys.entries()) {
    const previous = track.keys[index2 - 1];
    const next = track.keys[index2 + 1];
    const previousSpan = index2 > 0 ? times[index2] - times[index2 - 1] : 0;
    const nextSpan = index2 + 1 < times.length ? times[index2 + 1] - times[index2] : 0;
    const incoming = cubicDerivative(track.lineType, key.inTan, key.vector, previous?.vector, previousSpan, false, components);
    const outgoing = cubicDerivative(track.lineType, key.outTan, key.vector, next?.vector, nextSpan, true, components);
    if (!incoming || !outgoing)
      return false;
    const base = index2 * components * 3;
    values.set(incoming, base);
    values.set(key.vector, base + components);
    values.set(outgoing, base + components * 2);
  }
  return true;
}
function cubicDerivative(lineType, tangent, value, adjacent, span, outgoing, components) {
  if (span === 0)
    return Array.from({ length: components }, () => 0);
  if (!(span > 0) || value.length !== components || adjacent?.length !== components)
    return void 0;
  const result = [];
  for (let component = 0; component < components; component += 1) {
    const current = value[component];
    const neighboring = adjacent[component];
    const authored = tangent?.[component];
    let derivative;
    if (Number.isFinite(authored)) {
      derivative = lineType === 2 ? authored / span : outgoing ? 3 * (authored - current) / span : 3 * (current - authored) / span;
    } else {
      derivative = outgoing ? (neighboring - current) / span : (current - neighboring) / span;
    }
    if (!Number.isFinite(derivative))
      return void 0;
    result.push(derivative);
  }
  return result;
}
function addAccessor(buffer, bufferViews, accessors, values, type, componentType, target, range) {
  const bytes = littleEndianBytes(values);
  const byteOffset = buffer.append(bytes);
  const bufferView = bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: bytes.length,
    ...target === void 0 ? {} : { target }
  }) - 1;
  const width = accessorWidth(type);
  const accessor = {
    bufferView,
    componentType,
    count: values.length / width,
    type,
    ...range ? { min: range.min, max: range.max } : {}
  };
  accessors.push(accessor);
  return accessors.length - 1;
}
function littleEndianBytes(values) {
  const bytes = new Uint8Array(values.length * values.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index2) => {
    const offset = index2 * values.BYTES_PER_ELEMENT;
    if (values instanceof Float32Array)
      view.setFloat32(offset, value, true);
    else if (values instanceof Uint32Array)
      view.setUint32(offset, value, true);
    else
      view.setUint16(offset, value, true);
  });
  return bytes;
}
function bounds(values, width) {
  const min = Array(width).fill(Number.POSITIVE_INFINITY);
  const max = Array(width).fill(Number.NEGATIVE_INFINITY);
  for (let index2 = 0; index2 < values.length; index2 += width) {
    for (let component = 0; component < width; component += 1) {
      const value = values[index2 + component];
      const currentMin = min[component];
      const currentMax = max[component];
      if (value === void 0 || currentMin === void 0 || currentMax === void 0) {
        throw new ModkitError({
          code: "CONFIG_INVALID",
          message: "UVM attribute bounds cannot be computed from an incomplete vector.",
          context: { index: index2, component, width }
        });
      }
      min[component] = Math.min(currentMin, value);
      max[component] = Math.max(currentMax, value);
    }
  }
  return { min, max };
}
function accessorWidth(type) {
  if (type === "VEC2")
    return 2;
  if (type === "VEC3")
    return 3;
  if (type === "VEC4")
    return 4;
  if (type === "MAT4")
    return 16;
  return 1;
}
function vectorType(width) {
  if (width === 2)
    return "VEC2";
  if (width === 3)
    return "VEC3";
  if (width === 4)
    return "VEC4";
  throw new ModkitError({
    code: "CONFIG_INVALID",
    message: "Unsupported UVM accessor width.",
    context: { width }
  });
}
function invalidAttribute(semantic, actual, expected) {
  return new ModkitError({
    code: "CONFIG_INVALID",
    message: "UVM mesh attribute length does not match its vertex count.",
    context: { semantic, actual, expected }
  });
}

// ../node_modules/.pnpm/@modkit+uv@file+vendor+modkit-uv-1.0.0.tgz/node_modules/@modkit/uv/dist/model/accessor-write.js
function appendUvmAccessors(source, inputs, budget = { ...DEFAULT_UVM_CONTAINER_BUDGET, maxScalarBytes: 536870912 }, signal) {
  signal?.throwIfAborted();
  checkUvmContainerBudget(budget);
  if (!Number.isSafeInteger(budget.maxScalarBytes) || budget.maxScalarBytes < 0)
    throw new TypeError("invalid UVM accessor working budget");
  if (!Array.isArray(inputs) || inputs.length > budget.maxNodes)
    throw new RangeError("UVM accessor input count exceeds maxNodes");
  let appendedBytes = 0;
  const requests = inputs.map((input) => ({
    values: input.values,
    type: input.type,
    target: input.target
  }));
  for (const input of requests) {
    signal?.throwIfAborted();
    const width = uvmAccessorWidth(input.type), values = input.values;
    if (!(values instanceof Float32Array || values instanceof Uint16Array || values instanceof Uint32Array) || width === void 0 || values.length === 0 || values.length % width !== 0 || input.target !== void 0 && input.target !== 34962 && input.target !== 34963)
      throw new TypeError("invalid UVM accessor input shape");
    if (input.target === 34963 && (input.type !== "SCALAR" || values instanceof Float32Array))
      throw new TypeError("index buffer requires an unsigned integer scalar accessor");
    appendedBytes += Math.ceil(values.byteLength / 4) * 4;
  }
  const workingBytes = source.binary.byteLength * 3 + appendedBytes * 4;
  if (!Number.isSafeInteger(workingBytes) || workingBytes > budget.maxScalarBytes)
    throw new RangeError("UVM accessor append exceeds maxScalarBytes");
  if (source.binary.length + appendedBytes > Math.min(budget.maxInputBytes, 2147483644))
    throw new RangeError("UVM accessor append exceeds maxInputBytes");
  for (const input of requests)
    for (let i = 0; i < input.values.length; i++) {
      if (i % 4096 === 0)
        signal?.throwIfAborted();
      if (!Number.isFinite(input.values[i]))
        throw new TypeError("UVM accessor values must be finite");
    }
  for (const key of ["buffers", "bufferViews", "accessors"])
    if (source.document[key] !== void 0 && !Array.isArray(source.document[key]))
      throw new TypeError(`UVM ${key} must be an array`);
  writeUvmContainer(source, budget, signal);
  validateUvmDocument(source.document, {
    binaryByteLength: source.binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  if (inputs.length === 0)
    return { container: source, accessors: [] };
  if (source.format !== "glb")
    throw new TypeError("accessor append requires embedded GLB storage");
  const buffers = array(source.document, "buffers");
  const first = object(buffers[0] ?? {}, "buffer 0");
  const declared = first["byteLength"] ?? 0;
  if (first["uri"] !== void 0 || typeof declared !== "number" || !Number.isSafeInteger(declared) || declared < 0 || declared > source.binary.length || source.binary.length - declared > 3)
    throw new TypeError("buffer 0 does not describe embedded BIN storage");
  const jsonBudget = {
    maxDepth: budget.maxDepth,
    maxNodes: budget.maxNodes,
    maxBytes: budget.maxJsonBytes
  };
  const document = object(snapshotJson(source.document, jsonBudget, signal), "document");
  const views = [...array(document, "bufferViews")];
  const accessors = [...array(document, "accessors")];
  const buffer = new BufferBuilder();
  buffer.append(source.binary);
  const added = [];
  for (const input of requests) {
    signal?.throwIfAborted();
    const componentType = input.values instanceof Float32Array ? 5126 : input.values instanceof Uint16Array ? 5123 : 5125;
    added.push(addAccessor(buffer, views, accessors, input.values, input.type, componentType, input.target));
  }
  const binary = buffer.finish();
  const next = snapshotJson({
    ...document,
    buffers: [{ ...first, byteLength: binary.length }, ...buffers.slice(1)],
    bufferViews: views,
    accessors
  }, jsonBudget, signal);
  const container = {
    format: source.format,
    document: next,
    binary,
    extraChunks: source.extraChunks.map((chunk) => ({
      type: chunk.type,
      bytes: new Uint8Array(chunk.bytes)
    }))
  };
  validateUvmDocument(next, {
    binaryByteLength: binary.length,
    ...signal === void 0 ? {} : { signal }
  });
  writeUvmContainer(container, budget, signal);
  return { container, accessors: Object.freeze(added) };
}

// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/model-math/pbr.js
var dot2 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var clamp01 = (value) => Math.min(1, Math.max(0, value));
function shadePbr(surface, normal, view, light, ambient) {
  const roughness = clamp01(surface.roughness);
  const metallic = clamp01(surface.metallic);
  const alpha = Math.max(roughness * roughness, 1e-3);
  const alpha2 = alpha * alpha;
  const nDotL = clamp01(dot2(normal, light.direction));
  const nDotV = Math.max(dot2(normal, view), 1e-4);
  const half = [
    light.direction[0] + view[0],
    light.direction[1] + view[1],
    light.direction[2] + view[2]
  ];
  const halfLength = Math.hypot(half[0], half[1], half[2]) || 1;
  const nDotH = clamp01(dot2(normal, half) / halfLength);
  const vDotH = clamp01(dot2(view, half) / halfLength);
  const d = alpha2 / (Math.PI * (nDotH * nDotH * (alpha2 - 1) + 1) ** 2);
  const visibility = 0.5 / Math.max(nDotL * Math.sqrt(nDotV * nDotV * (1 - alpha2) + alpha2) + nDotV * Math.sqrt(nDotL * nDotL * (1 - alpha2) + alpha2), 1e-6);
  const r0 = roughness * -1 + 1;
  const r1 = roughness * -0.0275 + 0.0425;
  const r2 = roughness * -0.572 + 1.04;
  const r3 = roughness * 0.022 - 0.04;
  const a004 = Math.min(r0 * r0, 2 ** (-9.28 * nDotV)) * r0 + r1;
  const scale = a004 * -1.04 + r2;
  const bias = a004 * 1.04 + r3;
  const occlusion = surface.occlusion ?? 1;
  return [0, 1, 2].map((channel2) => {
    const base = surface.baseColor[channel2];
    const diffuse = base * (1 - metallic);
    const f0 = 0.04 + (base - 0.04) * metallic;
    const fresnel = f0 + (1 - f0) * (1 - vDotH) ** 5;
    const direct = ((1 - fresnel) * diffuse + Math.PI * fresnel * d * visibility) * light.color[channel2] * nDotL;
    const environment = ambient[channel2] * (diffuse + f0 * scale + bias) * occlusion;
    return direct + environment + (surface.emissive?.[channel2] ?? 0);
  });
}
function tonemap(value, curve) {
  const [a, b, c, d, e] = curve;
  const x = Math.max(0, value);
  return clamp01(x * (a * x + b) / (x * (c * x + d) + e));
}
var TONEMAP_GLSL = `vec3 modkitTonemap(vec3 x, vec4 abcd, float e) {
  x = max(x, vec3(0.0));
  return clamp(x * (abcd.x * x + abcd.y) / (x * (abcd.z * x + abcd.w) + e), 0.0, 1.0);
}`;
var SRGB_GLSL = `vec3 modkitSrgbToLinear(vec3 value) {
  return mix(value / 12.92, pow((value + 0.055) / 1.055, vec3(2.4)), vec3(greaterThan(value, vec3(0.04045))));
}
vec3 modkitLinearToSrgb(vec3 value) {
  return mix(value * 12.92, 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055, vec3(greaterThan(value, vec3(0.0031308))));
}`;
var PBR_GLSL = `vec3 modkitPbr(vec3 baseColor, float metallic, float roughness, float occlusion, vec3 emissive,
    vec3 normal, vec3 view, vec3 lightDirection, vec3 lightColor, vec3 ambient) {
  roughness = clamp(roughness, 0.0, 1.0);
  metallic = clamp(metallic, 0.0, 1.0);
  float alpha = max(roughness * roughness, 1e-3);
  float alpha2 = alpha * alpha;
  float nDotL = clamp(dot(normal, lightDirection), 0.0, 1.0);
  float nDotV = max(dot(normal, view), 1e-4);
  vec3 halfVector = lightDirection + view;
  float halfLength = length(halfVector);
  halfVector = halfLength > 0.0 ? halfVector / halfLength : halfVector;
  float nDotH = clamp(dot(normal, halfVector), 0.0, 1.0);
  float vDotH = clamp(dot(view, halfVector), 0.0, 1.0);
  float distribution = alpha2 / (3.14159265358979 * pow(nDotH * nDotH * (alpha2 - 1.0) + 1.0, 2.0));
  float visibility = 0.5 / max(nDotL * sqrt(nDotV * nDotV * (1.0 - alpha2) + alpha2)
    + nDotV * sqrt(nDotL * nDotL * (1.0 - alpha2) + alpha2), 1e-6);
  vec4 r = roughness * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
  float a004 = min(r.x * r.x, exp2(-9.28 * nDotV)) * r.x + r.y;
  vec2 environmentBrdf = vec2(-1.04, 1.04) * a004 + r.zw;
  vec3 diffuse = baseColor * (1.0 - metallic);
  vec3 f0 = mix(vec3(0.04), baseColor, metallic);
  vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - vDotH, 5.0);
  vec3 direct = ((1.0 - fresnel) * diffuse + 3.14159265358979 * fresnel * distribution * visibility)
    * lightColor * nDotL;
  vec3 environment = ambient * (diffuse + f0 * environmentBrdf.x + environmentBrdf.y) * occlusion;
  return direct + environment + emissive;
}`;

// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/model-math/standard-material-glsl.js
var FRAGMENT_LAYER_SLOTS = [
  "diffuse",
  "decal",
  "specular",
  "gloss",
  "emissive1",
  "emissive2",
  "emissiveMask",
  "envi",
  "enviMask",
  "normal",
  "normalBlend1Mask",
  "normalBlend2Mask",
  "normalBlend1",
  "normalBlend2",
  "height",
  "lightMap",
  "ao",
  "teamColorMask",
  "alpha1",
  "alpha2",
  "metalness",
  "roughness"
];
var TEXTURE_FALLBACK_PRIORITY = [
  "diffuse",
  "alpha1",
  "alpha2",
  "normal",
  "normalBlend1",
  "normalBlend2",
  "normalBlend1Mask",
  "normalBlend2Mask",
  "emissive1",
  "emissive2",
  "emissiveMask",
  "specular",
  "gloss",
  "decal",
  "lightMap",
  "ao",
  "envi",
  "enviMask",
  "height",
  "teamColorMask",
  "metalness",
  "roughness"
];
function uvSourceKind(uvSource) {
  if (uvSource === 0)
    return { kind: "explicit", set: 0 };
  if (uvSource === 1)
    return { kind: "explicit", set: 1 };
  if (uvSource === 2)
    return { kind: "reflectCube" };
  if (uvSource === 3)
    return { kind: "reflectSphere" };
  if (uvSource === 4)
    return { kind: "planarLocal", axis: 2 };
  if (uvSource === 5)
    return { kind: "planarWorld", axis: 2 };
  if (uvSource === 6)
    return { kind: "particle" };
  if (uvSource === 7)
    return { kind: "cube" };
  if (uvSource === 8)
    return { kind: "sphere" };
  if (uvSource === 9)
    return { kind: "explicit", set: 2 };
  if (uvSource === 10)
    return { kind: "explicit", set: 3 };
  if (uvSource === 11)
    return { kind: "planarLocal", axis: 0 };
  if (uvSource === 12)
    return { kind: "planarLocal", axis: 1 };
  if (uvSource === 13)
    return { kind: "planarWorld", axis: 0 };
  if (uvSource === 14)
    return { kind: "planarWorld", axis: 1 };
  if (uvSource === 15)
    return { kind: "screen" };
  if (uvSource === 16)
    return { kind: "triplanarLocal" };
  if (uvSource === 17)
    return { kind: "triplanarWorld" };
  if (uvSource === 18)
    return { kind: "triplanarWorldLocalZ" };
  return { kind: "approximated" };
}
function buildMaterialDefines(material, options = {}) {
  const layers = [];
  const textureBudget = Number.isFinite(options.maxTextureSamplers) ? Math.max(0, Math.floor(options.maxTextureSamplers ?? 0)) : Number.POSITIVE_INFINITY;
  const texturedSlots = new Set(TEXTURE_FALLBACK_PRIORITY.filter((slot) => material.layers[slot]?.texturePath != null).slice(0, textureBudget));
  let maxUvSet = 0;
  for (const slot of FRAGMENT_LAYER_SLOTS) {
    const layer = material.layers[slot];
    if (!layer)
      continue;
    const source = uvSourceKind(layer.uvSource);
    if (source.kind === "explicit")
      maxUvSet = Math.max(maxUvSet, source.set);
    layers.push({
      slot,
      hasTexture: layer.texturePath !== null && texturedSlots.has(slot),
      uvSource: layer.uvSource,
      channels: layer.channels,
      op: layer.op,
      teamColorMode: layer.teamColorMode,
      invert: layer.invert,
      clampResult: layer.clampResult,
      hasColorMultiply: layer.colorMultiply !== void 0,
      hasColorAdd: layer.colorAdd !== void 0,
      hasAlphaFactor: layer.alphaFactor !== void 0,
      ...layer.fresnel ? { fresnel: layer.fresnel } : {},
      hasUvTransform: layer.uvOffset !== void 0 || layer.uvAngle !== void 0 || layer.uvTiling !== void 0 || layer.uvTriplanarOffset !== void 0 || layer.uvTriplanarScale !== void 0 || layer.flipbook !== void 0
    });
  }
  return {
    layers,
    normalMapFormat: options.normalMapFormat ?? material.normalMapFormat ?? "dxt5nm",
    normalMapSpace: material.normalMapSpace ?? "tangent",
    specMode: material.specMode,
    unshaded: material.unshaded,
    doubleLambert: material.doubleLambert,
    clampOutput: material.clampOutput,
    usesVertexColor: material.usesVertexColor,
    usesVertexAlpha: material.usesVertexAlpha,
    ...material.specularEnergyConservation === true ? { specularEnergyConservation: true } : {},
    ...material.blendMode === 2 ? { modAlpha: true } : {},
    alphaTest: material.alphaTestThreshold > 0,
    uvSetCount: maxUvSet + 1,
    ...options.gpuSkinning === true ? { gpuSkinning: true } : {},
    ...options.hardwareInstancing === true ? { hardwareInstancing: true } : {},
    ...options.bakedPoseInstancing === true && options.gpuSkinning === true && options.hardwareInstancing === true ? { bakedPoseInstancing: true } : {},
    ...options.sceneLighting === true ? { sceneLighting: true } : {},
    ...material.lightingModel === "pbr-metallic-roughness" ? { pbr: true } : {},
    // an unshaded material is drawn as stored, without light to sum linearly
    ...material.lightingModel === "pbr-metallic-roughness" && material.colorPipeline === "linear-srgb" && !material.unshaded ? { linearColor: true, ...material.tonemap === void 0 ? {} : { tonemap: true } } : {}
  };
}
function canonicalDefineKey(defines) {
  const layerKeys = defines.layers.map((layer) => `${layer.slot}:${layer.hasTexture ? "t" : "c"}${layer.uvSource}.${layer.channels}.${layer.op}.${layer.teamColorMode}${layer.invert ? "i" : ""}${layer.clampResult ? "k" : ""}${layer.hasColorMultiply ? "m" : ""}${layer.hasColorAdd ? "a" : ""}${layer.hasAlphaFactor ? "f" : ""}${layer.hasUvTransform ? "u" : ""}${layer.fresnel ? `;fr=${layer.fresnel.mode},${layer.fresnel.exponent},${layer.fresnel.min},${layer.fresnel.maxOffset},${layer.fresnel.transformMode},${layer.fresnel.localTransform ? 1 : 0},${layer.fresnel.doNotMirror ? 1 : 0},${layer.fresnel.translation.join(",")},${layer.fresnel.invertMask.join(",")},${layer.fresnel.rotation.join(",")}` : ""}`).join("|");
  return `layers[${layerKeys}];n=${defines.normalMapFormat}.${defines.normalMapSpace};spec=${defines.specMode};${defines.unshaded ? "U" : ""}${defines.doubleLambert ? "D" : ""}${defines.clampOutput ? "C" : ""}${defines.usesVertexColor ? "vc" : ""}${defines.usesVertexAlpha ? "va" : ""}${defines.modAlpha ? "ma" : ""}${defines.alphaTest ? "at" : ""}${defines.specularEnergyConservation ? "ec" : ""};uv=${defines.uvSetCount};${defines.gpuSkinning ? "skin" : ""}${defines.hardwareInstancing ? "inst" : ""}${defines.bakedPoseInstancing ? "baked" : ""}${defines.sceneLighting ? ";scene" : ""}${defines.pbr ? ";pbr" : ""}${defines.linearColor ? ";linear" : ""}${defines.tonemap ? ";tonemap" : ""}`;
}
function standardBlendModeName(blendMode, alphaTestThreshold) {
  switch (blendMode) {
    case 1:
      return "blend";
    case 2:
      return "additive";
    case 3:
      return "add-alpha";
    case 4:
      return "modulate";
    case 5:
      return "modulate2x";
    case 6:
      return "premultiplied";
    default:
      return alphaTestThreshold > 0 ? "alpha-test" : "opaque";
  }
}
function chooseChannelCpu(channels, texel) {
  switch (channels) {
    case 2:
      return [texel[3], texel[3], texel[3], texel[3]];
    case 3:
      return [texel[0], texel[0], texel[0], texel[0]];
    case 4:
      return [texel[1], texel[1], texel[1], texel[1]];
    case 5:
      return [texel[2], texel[2], texel[2], texel[2]];
    case 0:
      return [texel[0], texel[1], texel[2], 1];
    default:
      return [texel[0], texel[1], texel[2], texel[3]];
  }
}
function computeLayerColorCpu(sample, teamColor, viewNormal = [0, 0, 1], eyeToVertex = [0, 0, -1]) {
  return nativeLayerColor(sample, teamColor, viewNormal, eyeToVertex);
}
function calculateLayerFresnelCpu(fresnel, viewNormal, eyeToVertex) {
  return nativeLayerFresnel(fresnel, viewNormal, eyeToVertex);
}
function combineLayerColorCpu(op, color, result, teamColor) {
  return nativeCombineLayer(op, color, result, teamColor);
}
function decodeNormalCpu(texel, format) {
  if (format === "rgb8") {
    return [texel[0] * 2 - 1, texel[1] * 2 - 1, texel[2] * 2 - 1];
  }
  const x = format === "bc5" || format === "luminance-alpha" ? texel[0] * 2 - 1 : texel[3] * 2 - 1;
  const y = (format === "luminance-alpha" ? texel[3] : texel[1]) * 2 - 1;
  const z = Math.sqrt(Math.max(0, 1 - (x * x + y * y)));
  return [x, y, z];
}
var DEFAULT_AMBIENT = [0.02, 0.02, 0.02, 0];
var PBR_VIEWER_LIGHT = [0.75, 0.75, 0.75];
var PBR_VIEWER_AMBIENT = [0.25, 0.25, 0.25];
function clamp012(v) {
  return Math.min(Math.max(v, 0), 1);
}
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normalize3(value) {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 1e-8 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 1];
}
function blendNormalCpu(base, detail, factor) {
  const amount = clamp012(factor);
  return normalize3([
    base[0] + (detail[0] - base[0]) * amount,
    base[1] + (detail[1] - base[1]) * amount,
    base[2] + (detail[2] - base[2]) * amount
  ]);
}
function composeStandardPixelCpu(input) {
  const teamColor = input.teamColor ?? [1, 0, 0];
  const teamColors = {diffuse: input.teamColorDiffuse ?? teamColor, emissive: input.teamColorEmissive ?? teamColor, exponents: input.teamColorExponents ?? [1, 1]};
  const ambient = input.ambient ?? DEFAULT_AMBIENT;
  const lightDir = input.lightDir ?? [0, 0, 1];
  const halfVec = input.halfVec ?? [0, 0, -1];
  const layers = input.layers;
  let normal = layers.normal ? decodeNormalCpu(layers.normal.texel, input.normalMapFormat ?? "dxt5nm") : input.vertexNormal ?? [0, 0, 1];
  const normalBlendFactors = input.normalBlendFactors ?? [1, 0, 0, 0, 1, 0, 0, 0];
  for (const blendIndex of [1, 2]) {
    const detailSlot = blendIndex === 1 ? "normalBlend1" : "normalBlend2";
    const maskSlot = blendIndex === 1 ? "normalBlend1Mask" : "normalBlend2Mask";
    const detail = layers[detailSlot];
    if (!detail)
      continue;
    const maskLayer = layers[maskSlot];
    const mask = maskLayer ? computeLayerColorCpu(maskLayer, teamColors) : [1, 0, 0, 0];
    const factorOffset = blendIndex === 1 ? 0 : 4;
    const factor = mask[0] * (normalBlendFactors[factorOffset] ?? 0) + mask[1] * (normalBlendFactors[factorOffset + 1] ?? 0) + mask[2] * (normalBlendFactors[factorOffset + 2] ?? 0) + mask[3] * (normalBlendFactors[factorOffset + 3] ?? 0);
    normal = blendNormalCpu(normal, decodeNormalCpu(detail.texel, input.normalMapFormat ?? "dxt5nm"), factor);
  }
  normal = normalize3(normal);
  let color = [0, 0, 0];
  if (layers.diffuse) {
    color = combineLayerColorCpu(layers.diffuse.op, computeLayerColorCpu(layers.diffuse, teamColors), color, teamColors);
  }
  if (layers.decal) {
    color = combineLayerColorCpu(layers.decal.op, computeLayerColorCpu(layers.decal, teamColors), color, teamColors);
  }
  const ambientOcclusion = layers.ao ? computeLayerColorCpu(layers.ao, teamColors)[3] : 1;
  const lightmapDiffuse = layers.lightMap ? computeLayerColorCpu(layers.lightMap, teamColors).slice(0, 3).map(value => value * 2) : void 0;
  const linear = input.linearColor !== void 0;
  const inPipeline = (value) => linear ? [
    srgbToLinear(clamp012(value[0])),
    srgbToLinear(clamp012(value[1])),
    srgbToLinear(clamp012(value[2])),
    value[3]
  ] : [value[0], value[1], value[2], value[3]];
  const applyEmissive = (base) => {
    let final2 = [base[0], base[1], base[2]];
    let addEmissive = false;
    let emissive = [0, 0, 0];
    if (layers.emissive1) {
      const temp = inPipeline(computeLayerColorCpu(layers.emissive1, teamColors));
      const op = layers.emissive1.op;
      if (op === 0 || op === 1 || op === 3) {
        final2 = combineLayerColorCpu(op, temp, final2, teamColors);
      } else {
        emissive = combineLayerColorCpu(op, temp, emissive, teamColors);
        addEmissive = true;
      }
    }
    if (layers.emissive2) {
      const temp = inPipeline(computeLayerColorCpu(layers.emissive2, teamColors));
      const op = layers.emissive2.op;
      if (!addEmissive && (op === 0 || op === 1 || op === 3)) {
        final2 = combineLayerColorCpu(op, temp, final2, teamColors);
      } else {
        emissive = combineLayerColorCpu(op, temp, emissive, teamColors);
        addEmissive = true;
      }
    }
    if (addEmissive) {
      const mask = layers.emissiveMask ? computeLayerColorCpu(layers.emissiveMask, teamColors)[0] : 1;
      const tint = input.emissiveTint ?? [1, 1, 1];
      final2 = [
        final2[0] + emissive[0] * tint[0] * input.emisMult * mask,
        final2[1] + emissive[1] * tint[1] * input.emisMult * mask,
        final2[2] + emissive[2] * tint[2] * input.emisMult * mask
      ];
    }
    return final2;
  };
  const applyEnvironment = (base, diffuseLight, specularLight) => {
    if (!layers.envi)
      return base;
    const environment = inPipeline(computeLayerColorCpu(layers.envi, teamColors));
    let mask;
    if (layers.enviMask) {
      const sampledMask = computeLayerColorCpu(layers.enviMask, teamColors);
      const rgbaMaskScale = layers.enviMask.channels === 1 ? sampledMask[3] : 1;
      mask = [
        sampledMask[0] * rgbaMaskScale * environment[3],
        sampledMask[1] * rgbaMaskScale * environment[3],
        sampledMask[2] * rgbaMaskScale * environment[3],
        sampledMask[3] * environment[3]
      ];
    } else {
      mask = [environment[3], environment[3], environment[3], environment[3]];
    }
    const multipliers = input.environmentMultipliers ?? [1, 0, 0];
    const diffuseColors = Array.isArray(diffuseLight) ? diffuseLight : [diffuseLight, diffuseLight, diffuseLight];
    const environmentValue = [
      environment[0] * (multipliers[0] + diffuseColors[0] * multipliers[1] + specularLight[0] * multipliers[2]),
      environment[1] * (multipliers[0] + diffuseColors[1] * multipliers[1] + specularLight[1] * multipliers[2]),
      environment[2] * (multipliers[0] + diffuseColors[2] * multipliers[1] + specularLight[2] * multipliers[2])
    ];
    if (layers.envi.op === 0) {
      return [
        base[0] * environmentValue[0] * mask[0],
        base[1] * environmentValue[1] * mask[1],
        base[2] * environmentValue[2] * mask[2]
      ];
    }
    if (layers.envi.op === 2) {
      return [
        base[0] + environmentValue[0] * mask[0],
        base[1] + environmentValue[1] * mask[1],
        base[2] + environmentValue[2] * mask[2]
      ];
    }
    if (layers.envi.op === 3) {
      return [
        base[0] + (environmentValue[0] - base[0]) * mask[3],
        base[1] + (environmentValue[1] - base[1]) * mask[3],
        base[2] + (environmentValue[2] - base[2]) * mask[3]
      ];
    }
    return base;
  };
  const scene = input.sceneLighting;
  let final = scene === void 0 && input.pbr === void 0 ? [ambient[0], ambient[1], ambient[2], ambient[3]] : [0, 0, 0, 0];
  const specularCpu = (lambert) => {
    if (!layers.specular || !(lambert > 0))
      return [0, 0, 0];
    const specColor = computeLayerColorCpu(layers.specular, teamColors);
    let power = input.specularity;
    if (layers.gloss) {
      const gloss = computeLayerColorCpu(layers.gloss, teamColors)[3];
      power *= gloss * gloss;
    }
    let energy = 1;
    if (input.specularEnergyConservation === true) {
      const p = Math.min(Math.max(power, 1), 512);
      energy = clamp012(-4444e-9 * p * p + 4333e-6 * p + 20834e-7);
    }
    const factor = Math.pow(clamp012(-dot3(halfVec, normal)), power) * input.specMult * energy;
    return input.specMode === 1 ? [specColor[3] * factor, specColor[3] * factor, specColor[3] * factor] : [specColor[0] * factor, specColor[1] * factor, specColor[2] * factor];
  };
  if (input.pbr !== void 0 && !input.unshaded) {
    const channel2 = (slot) => {
      const layer = layers[slot];
      return layer === void 0 ? 1 : computeLayerColorCpu(layer, teamColors)[0];
    };
    const base = inPipeline([color[0], color[1], color[2], 1]);
    const n = normalize3(normal), l = normalize3(lightDir);
    let rgb = shadePbr({
      baseColor: [base[0], base[1], base[2]],
      metallic: input.pbr.metallicFactor * channel2("metalness"),
      roughness: input.pbr.roughnessFactor * channel2("roughness")
    }, n, normalize3(input.viewDir ?? [0, 0, 1]), { direction: l, color: scene === void 0 ? PBR_VIEWER_LIGHT : scene.lightColor }, scene === void 0 ? PBR_VIEWER_AMBIENT : scene.ambientColor);
    rgb = applyEmissive(applyEnvironment(rgb, Math.max(dot3(n, l), 0), [0, 0, 0]));
    if (input.linearColor !== void 0) {
      const curve = input.linearColor.tonemap;
      rgb = rgb.map((value) => linearToSrgb(curve === void 0 ? clamp012(value) : tonemap(value, curve)));
    }
    final = [rgb[0], rgb[1], rgb[2], final[3]];
  } else if (input.unshaded) {
    const diffuseLight = lightmapDiffuse ?? [1, 1, 1];
    const rgb = applyEmissive(applyEnvironment(color.map((value, index) => value * diffuseLight[index]), diffuseLight, [0, 0, 0]));
    final = [final[0] + rgb[0], final[1] + rgb[1], final[2] + rgb[2], final[3]];
  } else if (scene !== void 0) {
    const nl = dot3(normal, lightDir);
    const lambert = input.doubleLambert ? clamp012(-1 + 2 * nl) : clamp012(nl);
    const spec = lightmapDiffuse === void 0 ? specularCpu(lambert) : [0, 0, 0];
    const diffuseLight = lightmapDiffuse ?? scene.ambientColor.map((value, index) => value * ambientOcclusion + scene.lightColor[index] * lambert);
    const lit = (channel2) => color[channel2] * diffuseLight[channel2] + spec[channel2] * scene.lightColor[channel2];
    const rgb = applyEmissive(applyEnvironment([lit(0), lit(1), lit(2)], diffuseLight, spec));
    final = [final[0] + rgb[0], final[1] + rgb[1], final[2] + rgb[2], final[3]];
  } else {
    const nl = dot3(normal, lightDir);
    const lambert = input.doubleLambert ? clamp012(-1 + 2 * nl) : clamp012(nl);
    if (lambert > 0) {
      const spec = specularCpu(lambert);
      let rgb = [
        (color[0] + spec[0]) * lambert,
        (color[1] + spec[1]) * lambert,
        (color[2] + spec[2]) * lambert
      ];
      rgb = applyEnvironment(rgb, lambert, spec);
      rgb = applyEmissive(rgb);
      final = [final[0] + rgb[0], final[1] + rgb[1], final[2] + rgb[2], final[3]];
    }
  }
  let alpha = layers.diffuse ? computeLayerColorCpu(layers.diffuse, teamColors)[3] : 1;
  let fade = input.materialAlpha ?? 1;
  if (layers.alpha1)
    alpha *= computeLayerColorCpu(layers.alpha1, teamColors)[3];
  if (layers.alpha2)
    alpha *= computeLayerColorCpu(layers.alpha2, teamColors)[3];
  final[3] = alpha * (input.materialAlpha ?? 1);
  if (layers.teamColorMask) {
    const mask = computeLayerColorCpu(layers.teamColorMask, teamColors)[0];
    final = [
      final[0] + (teamColor[0] - 0.5) * mask,
      final[1] + (teamColor[1] - 0.5) * mask,
      final[2] + (teamColor[2] - 0.5) * mask,
      final[3]
    ];
  }
  if (input.vertexColor) {
    const usesColor = input.usesVertexColor ?? true;
    const usesAlpha = input.usesVertexAlpha ?? true;
    if (usesColor) {
      final = [
        final[0] * input.vertexColor[0],
        final[1] * input.vertexColor[1],
        final[2] * input.vertexColor[2],
        final[3]
      ];
    }
    if (usesAlpha) {
      final[3] *= input.vertexColor[3];
      fade *= input.vertexColor[3];
    }
  }
  if (input.modAlpha === true)
    final = [final[0] * fade, final[1] * fade, final[2] * fade, final[3]];
  if (input.clampOutput) {
    final = [clamp012(final[0]), clamp012(final[1]), clamp012(final[2]), clamp012(final[3])];
  }
  const alphaTestPassed = input.alphaTestThreshold <= 0 || final[3] >= input.alphaTestThreshold;
  return { rgba: final, alphaTestPassed };
}
function layerUniformName(slot, suffix) {
  return `u_${slot}${suffix}`;
}
function glslFloat(value) {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}
function uvExpression(layer) {
  const source = uvSourceKind(layer.uvSource);
  let base = "v_uv0";
  let angleComponent = "z";
  if (source.kind === "explicit")
    base = `v_uv${source.set}`;
  else if (source.kind === "reflectCube")
    base = "cubeUv(reflectionDirection())";
  else if (source.kind === "reflectSphere")
    base = "sphereUvDirection(reflectionDirection())";
  else if (source.kind === "cube")
    base = "cubeUv(normalize(v_viewNormal))";
  else if (source.kind === "sphere")
    base = "sphereUvDirection(normalize(v_viewNormal))";
  else if (source.kind === "planarLocal") {
    base = `planarLocalUv(v_modelPosition, ${glslFloat(source.axis)})`;
    angleComponent = axisComponent(source.axis);
  } else if (source.kind === "planarWorld") {
    base = `planarWorldUv(v_worldPosition, ${glslFloat(source.axis)})`;
    angleComponent = axisComponent(source.axis);
  } else if (source.kind === "screen") {
    base = "(v_clipPosition.xy / max(abs(v_clipPosition.w), 0.0001) * vec2(0.5, -0.5) + 0.5)";
  } else
    base = "v_uv0";
  return transformUvExpression(layer, base, angleComponent, layer.slot !== "height");
}
function axisComponent(axis) {
  return axis === 0 ? "x" : axis === 1 ? "y" : "z";
}
function planarUvExpression(position2, axis) {
  return axis === 0 ? `${position2}.yz` : axis === 1 ? `${position2}.xz` : `${position2}.xy`;
}
function transformUvExpression(layer, base, angleComponent, parallax) {
  if (!layer.hasUvTransform)
    return parallax ? `(${base} + g_parallaxOffset)` : base;
  const rotated = `rotateUv(${base}, ${layerUniformName(layer.slot, "UvAngle")}.${angleComponent})`;
  const transformed = `((${rotated} - vec2(0.5) - ${layerUniformName(layer.slot, "UvOffset")}) * ${layerUniformName(layer.slot, "UvTiling")} + vec2(0.5))`;
  return parallax ? `(${transformed} + g_parallaxOffset)` : transformed;
}
function triplanarUvExpression(layer, position2, axis, parallax) {
  let transformedPosition = position2;
  if (layer.hasUvTransform) {
    const scale = layerUniformName(layer.slot, "UvTriplanarScale");
    const offset = layerUniformName(layer.slot, "UvTriplanarOffset");
    transformedPosition = `((${position2} + ${offset}) * ${scale})`;
  }
  const base = planarUvExpression(transformedPosition, axis);
  return transformUvExpression(layer, base, axisComponent(axis), parallax);
}
function layerTexelFunction(layer) {
  if (!layer.hasTexture)
    return "";
  const source = uvSourceKind(layer.uvSource);
  const map = layerUniformName(layer.slot, "Map");
  const functionName = `sampleLayerTexel_${layer.slot}`;
  if (source.kind !== "triplanarLocal" && source.kind !== "triplanarWorld" && source.kind !== "triplanarWorldLocalZ") {
    return `vec4 ${functionName}() {
  return texture2D(${map}, ${uvExpression(layer)});
}`;
  }
  const local = source.kind === "triplanarLocal";
  const hybrid = source.kind === "triplanarWorldLocalZ";
  const position2 = local ? "v_modelPosition" : "v_worldPosition";
  const normal = local ? "v_modelNormal" : hybrid ? "vec3(v_worldNormal.xy, v_modelNormal.z)" : "v_worldNormal";
  const parallax = layer.slot !== "height";
  const uvX = triplanarUvExpression(layer, position2, 0, parallax);
  const uvY = triplanarUvExpression(layer, position2, 1, parallax);
  const uvZ = triplanarUvExpression(layer, hybrid ? "v_modelPosition" : position2, 2, parallax);
  return `vec4 ${functionName}() {
  vec3 weights = computeTriPlanarWeights(${normal});
  return texture2D(${map}, ${uvX}) * weights.x +
    texture2D(${map}, ${uvY}) * weights.y +
    texture2D(${map}, ${uvZ}) * weights.z;
}`;
}
function layerFunction(layer) {
  const lines = [];
  const name = `computeLayer_${layer.slot}`;
  const texelFunction = layerTexelFunction(layer);
  if (texelFunction)
    lines.push(texelFunction);
  lines.push(`vec4 ${name}() {`);
  if (layer.hasTexture) {
    lines.push(`  vec4 texel = sampleLayerTexel_${layer.slot}();`);
  } else {
    lines.push(`  vec4 texel = ${layerUniformName(layer.slot, "Color")};`);
  }
  lines.push(`  vec4 result = chooseChannel(${glslFloat(layer.channels)}, texel);`);
  if (layer.hasAlphaFactor)
    lines.push(`  result.a *= ${layerUniformName(layer.slot, "AlphaFactor")};`);
  if (layer.channels !== 0 && layer.teamColorMode === 1)
    lines.push("  result = vec4(mix(u_teamColorDiffuse, result.rgb, clamp(pow(texel.a, u_teamColorExponents.x), 0.0, 1.0)), 1.0);");
  else if (layer.channels !== 0 && layer.teamColorMode === 2)
    lines.push("  result = vec4(mix(u_teamColorEmissive, result.rgb, texel.a), 1.0);");
  if (layer.invert)
    lines.push("  result = vec4(1.0) - result;");
  if (layer.hasColorMultiply)
    lines.push(`  result *= ${layerUniformName(layer.slot, "Multiply")};`);
  if (layer.hasColorAdd)
    lines.push(`  result += ${layerUniformName(layer.slot, "Add")};`);
  if (layer.clampResult)
    lines.push("  result = clamp(result, 0.0, 1.0);");
  if (layer.fresnel) {
    lines.push(`  result *= calculateLayerFresnel(v_viewNormal, v_viewPosition, ${glslFloat(layer.fresnel.exponent)}, ${glslFloat(layer.fresnel.min)}, ${glslFloat(layer.fresnel.maxOffset)}, ${glslFloat(layer.fresnel.mode)}, ${layer.fresnel.doNotMirror ? "1.0" : "0.0"});`);
  }
  lines.push("  return result;");
  lines.push("}");
  return lines.join("\n");
}
function layerUniformDeclarations(layer) {
  const lines = [];
  if (layer.hasTexture)
    lines.push(`uniform sampler2D ${layerUniformName(layer.slot, "Map")};`);
  else
    lines.push(`uniform vec4 ${layerUniformName(layer.slot, "Color")};`);
  if (layer.hasColorMultiply)
    lines.push(`uniform float ${layerUniformName(layer.slot, "Multiply")};`);
  if (layer.hasColorAdd)
    lines.push(`uniform float ${layerUniformName(layer.slot, "Add")};`);
  if (layer.hasAlphaFactor)
    lines.push(`uniform float ${layerUniformName(layer.slot, "AlphaFactor")};`);
  if (layer.hasUvTransform) {
    lines.push(`uniform vec2 ${layerUniformName(layer.slot, "UvOffset")};`);
    lines.push(`uniform vec2 ${layerUniformName(layer.slot, "UvTiling")};`);
    lines.push(`uniform vec3 ${layerUniformName(layer.slot, "UvAngle")};`);
    lines.push(`uniform vec3 ${layerUniformName(layer.slot, "UvTriplanarOffset")};`);
    lines.push(`uniform vec3 ${layerUniformName(layer.slot, "UvTriplanarScale")};`);
  }
  return lines.join("\n");
}
function combineExpression(op, colorVar, resultVar) {
  switch (op) {
    case 0:
      return `${resultVar} *= ${colorVar}.rgb;`;
    case 1:
      return `${resultVar} *= ${colorVar}.rgb * 2.0;`;
    case 2:
      return `${resultVar} += ${colorVar}.rgb * ${colorVar}.a;`;
    case 3:
      return `${resultVar} = mix(${resultVar}, ${colorVar}.rgb, ${colorVar}.a);`;
    case 4:
      return `${resultVar} += clamp(pow(${colorVar}.a, u_teamColorExponents.y), 0.0, 1.0) * u_teamColorEmissive;`;
    case 5:
      return `${resultVar} += ${colorVar}.a * u_teamColorDiffuse;`;
    case 6:
      return `${resultVar} += ${colorVar}.rgb;`;
    default:
      return "";
  }
}
var SHARED_FRAGMENT_HELPERS = `
vec4 chooseChannel(float channel, vec4 texel) {
  if (channel == 3.0) {
    texel = texel.rrrr;
  } else if (channel == 4.0) {
    texel = texel.gggg;
  } else if (channel == 5.0) {
    texel = texel.bbbb;
  } else if (channel == 2.0) {
    texel = texel.aaaa;
  } else if (channel == 0.0) {
    texel.a = 1.0;
  }
  return texel;
}

vec2 g_parallaxOffset = vec2(0.0);

float calculateLayerFresnel(
  vec3 viewNormal,
  vec3 eyeToVertex,
  float exponent,
  float minimum,
  float maxOffset,
  float mode,
  float doNotMirror
) {
  vec3 normal = normalize(viewNormal);
  vec3 direction = normalize(eyeToVertex);
  float edge = doNotMirror > 0.5
    ? 1.0 - clamp(-dot(normal, direction), 0.0, 1.0)
    : 1.0 - abs(dot(normal, direction));
  float factor = pow(max(edge, 0.0001), max(exponent, 0.0));
  if (mode == 2.0) factor = 1.0 - factor;
  return clamp(factor * maxOffset + minimum, 0.0, 1.0);
}

vec3 blendNormal(vec3 baseNormal, vec3 detailNormal, float amount) {
  return normalize(mix(baseNormal, detailNormal, clamp(amount, 0.0, 1.0)));
}

vec2 rotateUv(vec2 uv, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  vec2 centered = uv - vec2(0.5);
  return mat2(c, -s, s, c) * centered + vec2(0.5);
}

vec3 reflectionDirection() {
  return reflect(normalize(v_viewPosition), normalize(v_viewNormal));
}

vec2 sphereUvDirection(vec3 direction) {
  vec3 r = normalize(direction);
  return r.xz * vec2(0.5, -0.5) + 0.5;
}

vec2 planarComponents(vec3 position, float axis) {
  if (axis == 0.0) return position.yz;
  if (axis == 1.0) return position.xz;
  return position.xy;
}

vec2 planarLocalUv(vec3 position, float axis) {
  vec2 uv = planarComponents(position, axis) * 0.09375;
  uv.y = 1.0 - uv.y;
  return uv;
}

vec2 planarWorldUv(vec3 position, float axis) {
  vec2 uv = planarComponents(position, axis) * u_terrainTiling.xy + u_terrainTiling.zw;
  uv.y = 1.0 - uv.y;
  return uv;
}

vec3 computeTriPlanarWeights(vec3 normalValue) {
  vec3 weights = clamp((abs(normalize(normalValue)) - vec3(0.2)) * 7.0, 0.0, 1.0);
  weights = weights * weights * weights;
  float total = weights.x + weights.y + weights.z;
  return total > 0.0001 ? weights / total : vec3(0.0, 0.0, 1.0);
}

vec2 cubeUv(vec3 direction) {
  vec3 d = normalize(direction);
  vec3 a = abs(d);
  vec2 faceUv;
  vec2 cell;
  if (a.x >= a.y && a.x >= a.z) {
    faceUv = vec2(d.x > 0.0 ? -d.z : d.z, d.y) / max(a.x, 0.0001);
    cell = d.x > 0.0 ? vec2(2.0, 1.0) : vec2(0.0, 1.0);
  } else if (a.y >= a.z) {
    faceUv = vec2(d.x, d.y > 0.0 ? -d.z : d.z) / max(a.y, 0.0001);
    cell = d.y > 0.0 ? vec2(1.0, 2.0) : vec2(1.0, 0.0);
  } else {
    faceUv = vec2(d.z > 0.0 ? d.x : -d.x, d.y) / max(a.z, 0.0001);
    cell = d.z > 0.0 ? vec2(1.0, 1.0) : vec2(3.0, 1.0);
  }
  return (faceUv * 0.5 + 0.5 + cell) / vec2(4.0, 3.0);
}
`;
function normalDecodeGlsl(format) {
  if (format === "rgb8") {
    return `vec3 decodeNormal(vec4 texel) {
  return texel.xyz * 2.0 - 1.0;
}`;
  }
  const xy = format === "bc5" ? "texel.xy" : format === "luminance-alpha" ? "texel.xw" : "texel.wy";
  return `vec3 decodeNormal(vec4 texel) {
  vec3 n;
  n.xy = 2.0 * ${xy} - 1.0;
  n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
  return n;
}`;
}
function buildStandardFragmentSource(defines, options = {}) {
  const layerBySlot = new Map(defines.layers.map((layer) => [layer.slot, layer]));
  const hasDecodedNormal = layerBySlot.has("normal") || layerBySlot.has("normalBlend1") || layerBySlot.has("normalBlend2");
  const precision = options.precision === void 0 ? "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif" : options.precision;
  const parts = precision ? [precision, ""] : [];
  for (let i = 0; i < defines.uvSetCount; i += 1)
    parts.push(`varying vec2 v_uv${i};`);
  parts.push("varying vec3 v_normal;");
  parts.push("varying vec3 v_lightDir;");
  parts.push("varying vec3 v_halfVec;");
  parts.push("varying vec3 v_viewDir;");
  parts.push("varying vec3 v_viewPosition;");
  parts.push("varying vec3 v_viewNormal;");
  parts.push("varying vec3 v_modelPosition;");
  parts.push("varying vec3 v_modelNormal;");
  parts.push("varying vec3 v_worldPosition;");
  parts.push("varying vec3 v_worldNormal;");
  parts.push("varying vec4 v_clipPosition;");
  if (defines.usesVertexColor || defines.usesVertexAlpha)
    parts.push("varying vec4 v_vertexColor;");
  parts.push("");
  if (defines.bakedPoseInstancing) {
    parts.push("varying vec3 v_instanceTeamColor;");
    parts.push("#define u_teamColor v_instanceTeamColor");
  } else {
    parts.push("uniform vec3 u_teamColor;");
  }
  parts.push("uniform vec3 u_teamColorDiffuse, u_teamColorEmissive;");
  parts.push("uniform vec2 u_teamColorExponents;");
  parts.push("uniform vec4 u_ambient;");
  if (defines.sceneLighting) {
    parts.push("uniform vec3 u_sceneAmbientColor;");
    parts.push("uniform vec3 u_sceneLightColor;");
  }
  parts.push("uniform float u_specularity;");
  parts.push("uniform float u_specMult;");
  parts.push("uniform float u_emisMult;");
  parts.push("uniform vec3 u_emissiveTint;");
  parts.push("uniform vec3 u_environmentMultipliers;");
  parts.push("uniform vec4 u_terrainTiling;");
  parts.push("uniform float u_materialAlpha;");
  if (layerBySlot.has("normalBlend1"))
    parts.push("uniform vec4 u_normalBlend1Factors;");
  if (layerBySlot.has("normalBlend2"))
    parts.push("uniform vec4 u_normalBlend2Factors;");
  if (layerBySlot.has("height"))
    parts.push("uniform float u_parallaxHeight;");
  if (defines.alphaTest)
    parts.push("uniform float u_alphaTestThreshold;");
  if (defines.pbr)
    parts.push("uniform float u_metallicFactor;", "uniform float u_roughnessFactor;");
  if (defines.tonemap)
    parts.push("uniform vec4 u_tonemapCurve;", "uniform float u_tonemapE;");
  for (const layer of defines.layers)
    parts.push(layerUniformDeclarations(layer));
  parts.push(SHARED_FRAGMENT_HELPERS);
  if (defines.pbr)
    parts.push(PBR_GLSL);
  if (defines.linearColor)
    parts.push(SRGB_GLSL);
  if (defines.tonemap)
    parts.push(TONEMAP_GLSL);
  if (hasDecodedNormal)
    parts.push(normalDecodeGlsl(defines.normalMapFormat));
  for (const layer of defines.layers)
    parts.push(layerFunction(layer));
  const body = [];
  body.push("void main() {");
  body.push(defines.sceneLighting || defines.pbr ? "  vec4 final = vec4(0.0);" : "  vec4 final = u_ambient;");
  if (layerBySlot.has("height")) {
    body.push("  float parallaxSample = computeLayer_height().r - 0.5;");
    body.push("  vec3 parallaxView = normalize(v_viewDir);");
    body.push("  g_parallaxOffset = parallaxView.xy / max(abs(parallaxView.z), 0.15) * parallaxSample * u_parallaxHeight;");
  }
  if (layerBySlot.has("normal")) {
    body.push(layerBySlot.get("normal")?.hasTexture ? "  vec3 normal = decodeNormal(sampleLayerTexel_normal());" : "  vec3 normal = decodeNormal(u_normalColor);");
  } else if (hasDecodedNormal) {
    body.push("  vec3 normal = vec3(0.0, 0.0, 1.0);");
  } else {
    body.push("  vec3 normal = v_normal;");
  }
  for (const blendIndex of [1, 2]) {
    const detailSlot = blendIndex === 1 ? "normalBlend1" : "normalBlend2";
    const detail = layerBySlot.get(detailSlot);
    if (!detail)
      continue;
    const maskSlot = blendIndex === 1 ? "normalBlend1Mask" : "normalBlend2Mask";
    const detailTexel = detail.hasTexture ? `sampleLayerTexel_${detailSlot}()` : `u_${detailSlot}Color`;
    const mask = layerBySlot.has(maskSlot) ? `computeLayer_${maskSlot}()` : "vec4(1.0, 0.0, 0.0, 0.0)";
    body.push(`  vec4 ${maskSlot}Value = ${mask};`);
    body.push(`  float ${detailSlot}Factor = dot(${maskSlot}Value, u_${detailSlot}Factors);`);
    body.push(`  normal = blendNormal(normal, decodeNormal(${detailTexel}), ${detailSlot}Factor);`);
  }
  body.push("  normal = normalize(normal);");
  body.push("  vec3 color = vec3(0.0);");
  const diffuse = layerBySlot.get("diffuse");
  if (diffuse) {
    body.push("  vec4 diffuseColor = computeLayer_diffuse();");
    body.push(`  ${combineExpression(diffuse.op, "diffuseColor", "color")}`);
  }
  const decal = layerBySlot.get("decal");
  if (decal) {
    body.push("  vec4 decalColor = computeLayer_decal();");
    body.push(`  ${combineExpression(decal.op, "decalColor", "color")}`);
  }
  body.push(layerBySlot.has("ao") ? "  float ambientOcclusion = computeLayer_ao().a;" : "  float ambientOcclusion = 1.0;");
  body.push(layerBySlot.has("lightMap") ? "  bool useLightmap = true;\n  vec3 lightmapDiffuse = computeLayer_lightMap().rgb * 2.0;" : "  bool useLightmap = false;\n  vec3 lightmapDiffuse = vec3(0.0);");
  const inPipeline = (indent, name) => defines.linearColor ? [`${indent}${name}.rgb = modkitSrgbToLinear(clamp(${name}.rgb, 0.0, 1.0));`] : [];
  const emissiveBlock = (indent, target) => {
    const lines = [];
    const emis1 = layerBySlot.get("emissive1");
    const emis2 = layerBySlot.get("emissive2");
    if (!emis1 && !emis2)
      return lines;
    lines.push(`${indent}vec3 emissive = vec3(0.0);`);
    lines.push(`${indent}bool addEmissive = false;`);
    if (emis1) {
      lines.push(`${indent}vec4 emis1Color = computeLayer_emissive1();`);
      lines.push(...inPipeline(indent, "emis1Color"));
      if (emis1.op === 0 || emis1.op === 1 || emis1.op === 3) {
        lines.push(`${indent}${combineExpression(emis1.op, "emis1Color", target)}`);
      } else {
        lines.push(`${indent}${combineExpression(emis1.op, "emis1Color", "emissive")}`);
        lines.push(`${indent}addEmissive = true;`);
      }
    }
    if (emis2) {
      lines.push(`${indent}vec4 emis2Color = computeLayer_emissive2();`);
      lines.push(...inPipeline(indent, "emis2Color"));
      if (emis2.op === 0 || emis2.op === 1 || emis2.op === 3) {
        lines.push(`${indent}if (!addEmissive) {`);
        lines.push(`${indent}  ${combineExpression(emis2.op, "emis2Color", target)}`);
        lines.push(`${indent}} else {`);
        lines.push(`${indent}  ${combineExpression(emis2.op, "emis2Color", "emissive")}`);
        lines.push(`${indent}}`);
      } else {
        lines.push(`${indent}${combineExpression(emis2.op, "emis2Color", "emissive")}`);
        lines.push(`${indent}addEmissive = true;`);
      }
    }
    const mask = layerBySlot.has("emissiveMask") ? "computeLayer_emissiveMask().r" : "1.0";
    lines.push(`${indent}if (addEmissive) { ${target} += emissive * u_emissiveTint * u_emisMult * ${mask}; }`);
    return lines;
  };
  const environmentBlock = (indent, target, diffuseLight, specularLight) => {
    const environment = layerBySlot.get("envi");
    if (!environment || environment.op !== 0 && environment.op !== 2 && environment.op !== 3) {
      return [];
    }
    const lines = [
      `${indent}vec4 environmentColor = computeLayer_envi();`,
      ...inPipeline(indent, "environmentColor")
    ];
    const maskLayer = layerBySlot.get("enviMask");
    if (maskLayer) {
      lines.push(`${indent}vec4 environmentMask = computeLayer_enviMask();`);
      if (maskLayer.channels === 1)
        lines.push(`${indent}environmentMask.rgb *= environmentMask.a;`);
      lines.push(`${indent}environmentMask *= environmentColor.a;`);
    } else {
      lines.push(`${indent}vec4 environmentMask = vec4(environmentColor.a);`);
    }
    lines.push(`${indent}vec3 environmentLight = vec3(u_environmentMultipliers.x + (${diffuseLight}) * u_environmentMultipliers.y) + (${specularLight}) * u_environmentMultipliers.z;`);
    lines.push(`${indent}vec3 environmentValue = environmentColor.rgb * environmentLight;`);
    if (environment.op === 0) {
      lines.push(`${indent}${target} *= environmentValue * environmentMask.rgb;`);
    } else if (environment.op === 2) {
      lines.push(`${indent}${target} += environmentValue * environmentMask.rgb;`);
    } else {
      lines.push(`${indent}${target} = mix(${target}, environmentValue, environmentMask.a);`);
    }
    return lines;
  };
  const specularBlock = (indent) => {
    if (!layerBySlot.has("specular"))
      return [`${indent}vec3 spec = vec3(0.0);`];
    return [
      `${indent}vec4 specColor = computeLayer_specular();`,
      `${indent}float specPower = u_specularity;`,
      ...layerBySlot.has("gloss") ? [
        `${indent}float gloss = computeLayer_gloss().a;`,
        `${indent}specPower *= gloss * gloss;`
      ] : [],
      ...defines.specularEnergyConservation ? [
        `${indent}float specClamped = clamp(specPower, 1.0, 512.0);`,
        `${indent}float specEnergy = clamp(-0.000004444 * specClamped * specClamped + 0.004333 * specClamped + 0.0020834, 0.0, 1.0);`
      ] : [`${indent}float specEnergy = 1.0;`],
      // WebGL follows the native OpenGL variant's epsilon before pow; this
      // avoids undefined pow(0,0) while preserving an authored zero exponent.
      `${indent}float specFactor = lambert > 0.0 ? pow(max(clamp(-dot(v_halfVec, normal), 0.0, 1.0), 0.0001), specPower) * u_specMult * specEnergy : 0.0;`,
      defines.specMode === 1 ? `${indent}vec3 spec = vec3(specColor.a) * specFactor;` : `${indent}vec3 spec = specColor.rgb * specFactor;`
    ];
  };
  if (defines.pbr && !defines.unshaded) {
    const channel2 = (slot) => layerBySlot.has(slot) ? ` * computeLayer_${slot}().r` : "";
    const vector6 = (value) => `vec3(${value.map(glslFloat).join(", ")})`;
    const light = defines.sceneLighting ? "u_sceneLightColor" : vector6(PBR_VIEWER_LIGHT);
    const ambient = defines.sceneLighting ? "u_sceneAmbientColor" : vector6(PBR_VIEWER_AMBIENT);
    body.push(`  vec3 pbrBase = ${defines.linearColor ? "modkitSrgbToLinear(clamp(color, 0.0, 1.0))" : "color"};`, `  float pbrMetallic = u_metallicFactor${channel2("metalness")};`, `  float pbrRoughness = u_roughnessFactor${channel2("roughness")};`, "  vec3 pbrNormal = normalize(normal);", "  vec3 pbrLight = normalize(v_lightDir);", "  vec3 pbrView = normalize(v_viewDir);", `  vec3 shaded = modkitPbr(pbrBase, pbrMetallic, pbrRoughness, 1.0, vec3(0.0), pbrNormal, pbrView, pbrLight, ${light}, ${ambient});`);
    body.push(...environmentBlock("  ", "shaded", "max(dot(pbrNormal, pbrLight), 0.0)", "vec3(0.0)"));
    body.push(...emissiveBlock("  ", "shaded"));
    if (defines.linearColor)
      body.push(defines.tonemap ? "  shaded = modkitLinearToSrgb(modkitTonemap(shaded, u_tonemapCurve, u_tonemapE));" : "  shaded = modkitLinearToSrgb(clamp(shaded, 0.0, 1.0));");
    body.push("  final.rgb += shaded;");
  } else if (defines.unshaded) {
    body.push("  vec3 lightDiffuse = useLightmap ? lightmapDiffuse : vec3(1.0);");
    body.push("  vec3 shaded = color * lightDiffuse;");
    body.push(...environmentBlock("  ", "shaded", "lightDiffuse", "vec3(0.0)"));
    body.push(...emissiveBlock("  ", "shaded"));
    body.push("  final.rgb += shaded;");
  } else if (defines.sceneLighting) {
    body.push(defines.doubleLambert ? "  float lambert = clamp(-1.0 + 2.0 * dot(normal, v_lightDir), 0.0, 1.0);" : "  float lambert = clamp(dot(normal, v_lightDir), 0.0, 1.0);");
    body.push(...specularBlock("  "));
    body.push("  vec3 lightDiffuse = useLightmap ? lightmapDiffuse : u_sceneAmbientColor * ambientOcclusion + u_sceneLightColor * lambert;");
    body.push("  vec3 lightSpecular = useLightmap ? vec3(0.0) : spec * u_sceneLightColor;");
    body.push("  vec3 shaded = color * lightDiffuse + lightSpecular;");
    body.push(...environmentBlock("  ", "shaded", "lightDiffuse", "useLightmap ? vec3(0.0) : spec"));
    body.push(...emissiveBlock("  ", "shaded"));
    body.push("  final.rgb += shaded;");
  } else {
    if (defines.doubleLambert) {
      body.push("  float lambert = clamp(-1.0 + 2.0 * dot(normal, v_lightDir), 0.0, 1.0);");
    } else {
      body.push("  float lambert = clamp(dot(normal, v_lightDir), 0.0, 1.0);");
    }
    body.push("  if (lambert > 0.0) {");
    body.push(...specularBlock("    "));
    body.push("    vec3 shaded = (color + spec) * lambert;");
    body.push(...environmentBlock("    ", "shaded", "lambert", "spec"));
    body.push(...emissiveBlock("    ", "shaded"));
    body.push("    final.rgb += shaded;");
    body.push("  }");
  }
  body.push(diffuse ? "  float alpha = computeLayer_diffuse().a;" : "  float alpha = 1.0;");
  if (defines.modAlpha)
    body.push("  float fade = u_materialAlpha;");
  if (layerBySlot.has("alpha1"))
    body.push("  alpha *= computeLayer_alpha1().a;");
  if (layerBySlot.has("alpha2"))
    body.push("  alpha *= computeLayer_alpha2().a;");
  body.push("  final.a = alpha * u_materialAlpha;");
  if (layerBySlot.has("teamColorMask")) {
    body.push("  float teamColorMask = computeLayer_teamColorMask().r;");
    body.push("  final.rgb += (u_teamColor - vec3(0.5)) * teamColorMask;");
  }
  if (defines.usesVertexColor)
    body.push("  final.rgb *= v_vertexColor.rgb;");
  if (defines.usesVertexAlpha)
    body.push("  final.a *= v_vertexColor.a;");
  if (defines.modAlpha)
    body.push(`  final.rgb *= fade${defines.usesVertexAlpha ? " * v_vertexColor.a" : ""};`);
  if (defines.clampOutput)
    body.push("  final = clamp(final, 0.0, 1.0);");
  if (defines.alphaTest)
    body.push("  if (final.a < u_alphaTestThreshold) discard;");
  body.push("  gl_FragColor = final;");
  body.push("}");
  parts.push(body.join("\n"));
  return parts.join("\n");
}
function buildStandardVertexSource(defines) {
  const parts = [];
  parts.push("uniform mat4 u_viewProjection;");
  parts.push("uniform mat4 u_modelView;");
  parts.push("uniform mat4 u_model;");
  parts.push("uniform vec3 u_lightPosition;");
  parts.push("uniform vec3 u_eyePosition;");
  parts.push("");
  parts.push("attribute vec3 a_position;");
  parts.push("attribute vec3 a_normal;");
  parts.push("attribute vec4 a_tangent;");
  if (defines.gpuSkinning) {
    parts.push("attribute vec4 a_boneIndices;");
    parts.push("attribute vec4 a_boneWeights;");
    parts.push("uniform sampler2D u_boneTexture;");
    parts.push("uniform vec2 u_boneTextureSize;");
    parts.push("uniform bool u_gpuSkinningEnabled;");
  }
  if (defines.hardwareInstancing) {
    parts.push("attribute vec4 a_instanceMatrix0;");
    parts.push("attribute vec4 a_instanceMatrix1;");
    parts.push("attribute vec4 a_instanceMatrix2;");
    parts.push("attribute vec4 a_instanceMatrix3;");
    parts.push("uniform bool u_hardwareInstancing;");
  }
  if (defines.bakedPoseInstancing) {
    parts.push("attribute vec4 a_instancePose;");
    parts.push("attribute vec4 a_instanceTeamColor;");
    parts.push("uniform bool u_bakedPoseInstancing;");
    parts.push("uniform vec3 u_teamColor;");
  }
  if (defines.usesVertexColor || defines.usesVertexAlpha)
    parts.push("attribute vec4 a_color;");
  for (let i = 0; i < defines.uvSetCount; i += 1)
    parts.push(`attribute vec2 a_uv${i};`);
  parts.push("");
  for (let i = 0; i < defines.uvSetCount; i += 1)
    parts.push(`varying vec2 v_uv${i};`);
  parts.push("varying vec3 v_normal;");
  parts.push("varying vec3 v_lightDir;");
  parts.push("varying vec3 v_halfVec;");
  parts.push("varying vec3 v_viewDir;");
  parts.push("varying vec3 v_viewPosition;");
  parts.push("varying vec3 v_viewNormal;");
  parts.push("varying vec3 v_modelPosition;");
  parts.push("varying vec3 v_modelNormal;");
  parts.push("varying vec3 v_worldPosition;");
  parts.push("varying vec3 v_worldNormal;");
  parts.push("varying vec4 v_clipPosition;");
  if (defines.usesVertexColor || defines.usesVertexAlpha)
    parts.push("varying vec4 v_vertexColor;");
  if (defines.bakedPoseInstancing)
    parts.push("varying vec3 v_instanceTeamColor;");
  parts.push("");
  if (defines.gpuSkinning)
    parts.push(`mat4 readBoneMatrix(float boneIndex, float row) {
  float base = boneIndex * 4.0;
  float y = (row + 0.5) / u_boneTextureSize.y;
  vec4 c0 = texture2D(u_boneTexture, vec2((base + 0.5) / u_boneTextureSize.x, y));
  vec4 c1 = texture2D(u_boneTexture, vec2((base + 1.5) / u_boneTextureSize.x, y));
  vec4 c2 = texture2D(u_boneTexture, vec2((base + 2.5) / u_boneTextureSize.x, y));
  vec4 c3 = texture2D(u_boneTexture, vec2((base + 3.5) / u_boneTextureSize.x, y));
  return mat4(c0, c1, c2, c3);
}
`);
  if (defines.bakedPoseInstancing && defines.gpuSkinning)
    parts.push(`mat4 weightedPoseMatrix(float row) {
  return readBoneMatrix(a_boneIndices.x, row) * a_boneWeights.x +
    readBoneMatrix(a_boneIndices.y, row) * a_boneWeights.y +
    readBoneMatrix(a_boneIndices.z, row) * a_boneWeights.z +
    readBoneMatrix(a_boneIndices.w, row) * a_boneWeights.w;
}
`);
  parts.push(`vec3 toTangentSpace(vec3 v, vec3 t, vec3 b, vec3 n) {
  return vec3(dot(v, t), dot(v, b), dot(v, n));
}

void main() {
  vec3 sourcePosition = a_position;
  vec3 sourceNormal = a_normal;
  vec3 sourceTangent = a_tangent.xyz;${defines.bakedPoseInstancing && defines.gpuSkinning ? `
  if (u_bakedPoseInstancing) {
    mat4 skinMatrix =
      weightedPoseMatrix(a_instancePose.x) * (1.0 - a_instancePose.z) +
      weightedPoseMatrix(a_instancePose.y) * a_instancePose.z;
    sourcePosition = vec3(skinMatrix * vec4(sourcePosition, 1.0));
    sourceNormal = mat3(skinMatrix) * sourceNormal;
    sourceTangent = mat3(skinMatrix) * sourceTangent;
  } else` : ""}${defines.gpuSkinning ? `
  if (u_gpuSkinningEnabled) {
    mat4 skinMatrix =
      readBoneMatrix(a_boneIndices.x, 0.0) * a_boneWeights.x +
      readBoneMatrix(a_boneIndices.y, 0.0) * a_boneWeights.y +
      readBoneMatrix(a_boneIndices.z, 0.0) * a_boneWeights.z +
      readBoneMatrix(a_boneIndices.w, 0.0) * a_boneWeights.w;
    sourcePosition = vec3(skinMatrix * vec4(sourcePosition, 1.0));
    sourceNormal = mat3(skinMatrix) * sourceNormal;
    sourceTangent = mat3(skinMatrix) * sourceTangent;
  }` : ""}
  vec4 worldPosition = u_model * vec4(sourcePosition, 1.0);
  vec3 positionMv = vec3(u_modelView * vec4(sourcePosition, 1.0));
  mat3 mv = mat3(u_modelView);

  // binormal = cross(normal, tangent) * handedness (normal.w convention, 1.9)
  vec3 tangent = normalize(mv * sourceTangent);
  vec3 normal = normalize(mv * sourceNormal);
  vec3 binormal = normalize(mv * (cross(sourceNormal, sourceTangent) * a_tangent.w));

  vec3 lightDir = normalize(u_lightPosition - positionMv);
  v_lightDir = normalize(toTangentSpace(lightDir, tangent, binormal, normal));

  vec3 eyeVec = normalize(u_eyePosition - positionMv);
  vec3 halfVec = normalize(eyeVec - u_lightPosition);
  v_halfVec = toTangentSpace(halfVec, tangent, binormal, normal);
  v_viewDir = toTangentSpace(eyeVec, tangent, binormal, normal);

  v_normal = normal;
  v_viewPosition = positionMv;
  v_viewNormal = normal;
  v_modelPosition = sourcePosition;
  v_modelNormal = normalize(sourceNormal);
  v_worldPosition = worldPosition.xyz;
  v_worldNormal = normalize(mat3(u_model) * sourceNormal);
  v_clipPosition = u_viewProjection * worldPosition;${defines.hardwareInstancing ? `
  if (u_hardwareInstancing) {
    mat4 instanceClipMatrix = mat4(
      a_instanceMatrix0,
      a_instanceMatrix1,
      a_instanceMatrix2,
      a_instanceMatrix3
    );
    v_clipPosition = instanceClipMatrix * vec4(sourcePosition, 1.0);
  }` : ""}`);
  for (let i = 0; i < defines.uvSetCount; i += 1)
    parts.push(`  v_uv${i} = a_uv${i};`);
  if (defines.usesVertexColor || defines.usesVertexAlpha)
    parts.push("  v_vertexColor = a_color;");
  if (defines.bakedPoseInstancing)
    parts.push("  v_instanceTeamColor = u_bakedPoseInstancing ? a_instanceTeamColor.rgb : u_teamColor;");
  parts.push(`  gl_Position = v_clipPosition;
}`);
  return parts.join("\n");
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/materials/normal-maps.js
var NORMAL_SLOTS = ["normal", "normalBlend1", "normalBlend2"];
var FORMATS = ["dxt5nm", "bc5", "rgb8", "luminance-alpha"];
function snapshotNormalFormats(formats) {
  const result = /* @__PURE__ */ new Map();
  for (const [id, format] of formats ?? []) {
    if (typeof id !== "string" || !id || !FORMATS.includes(format))
      throw new TypeError("invalid bound normal format");
    result.set(id, format);
  }
  return result;
}
function materialNormalFormats(material, bindings) {
  const formats = {
    normal: material.normalMapFormat ?? "dxt5nm",
    normalBlend1: material.normalMapFormat ?? "dxt5nm",
    normalBlend2: material.normalMapFormat ?? "dxt5nm"
  };
  let changed = false;
  for (const slot of NORMAL_SLOTS) {
    const path = material.layers[slot]?.texturePath;
    const format = path === null || path === void 0 ? void 0 : bindings.get(path);
    if (format !== void 0 && material.normalMapFormat === void 0) {
      formats[slot] = format;
      changed ||= format !== "dxt5nm";
    }
  }
  return changed ? Object.freeze(formats) : void 0;
}
function normalTexelRgb(texel, format) {
  const n = decodeNormalCpu(texel, format);
  return [n[0] * 0.5 + 0.5, n[1] * 0.5 + 0.5, n[2] * 0.5 + 0.5, texel[3]];
}
function normalLayerShader(source, formats) {
  const helpers = [];
  for (const slot of NORMAL_SLOTS) {
    const format = formats[slot], name = `sceneDecode_${slot}`;
    const sample = `decodeNormal(sampleLayerTexel_${slot}())`, constant = `decodeNormal(u_${slot}Color)`;
    if (!source.includes(sample) && !source.includes(constant))
      continue;
    source = source.replaceAll(sample, `${name}(sampleLayerTexel_${slot}())`).replaceAll(constant, `${name}(u_${slot}Color)`);
    const xy = format === "bc5" ? "texel.xy" : format === "luminance-alpha" ? "texel.xw" : "texel.wy";
    helpers.push(`vec3 ${name}(vec4 texel){${format === "rgb8" ? "return texel.xyz*2.0-1.0;" : `vec2 xy=2.0*${xy}-1.0;return vec3(xy,sqrt(max(0.0,1.0-dot(xy,xy))));`}}`);
  }
  return source.replace("void main() {", `${helpers.join("\n")}
void main() {`);
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/materials/cube-maps.js
var UnsupportedCubeCoordinatesError = class extends TypeError {
};
function cubeLayerShader(source, defines, bindings, worldEnvironment = false, worldNormalReady = false) {
  if (worldEnvironment) {
    const marker = "  vec3 color = vec3(0.0);";
    if (!source.includes(marker))
      throw new TypeError("built-in material normal stage is absent");
    const blend = "  return normalize(mix(baseNormal, detailNormal, clamp(amount, 0.0, 1.0)));";
    if (!source.includes(blend))
      throw new TypeError("built-in material normal blend is absent");
    source = source.replace(blend, `  vec3 mixed=mix(baseNormal,detailNormal,clamp(amount,0.0,1.0));
  float magnitude=length(mixed);
  return magnitude>1e-8?mixed/magnitude:vec3(0.0,0.0,1.0);`);
    source = source.replace("precision highp float;", `precision highp float;
uniform vec4 u_sceneEnvironment0, u_sceneEnvironment1, u_sceneEnvironment2;
uniform vec3 u_sceneEyePosition;
vec3 g_sceneEnvironmentNormal;
vec3 sceneEnvironmentUnit(vec3 value) {
  float magnitude=length(value);
  return magnitude>1e-9?value/magnitude:vec3(0.0,0.0,1.0);
}
vec3 sceneEnvironmentVector(vec3 value) {
  vec4 v=vec4(value,1.0);
  return vec3(dot(u_sceneEnvironment0,v),dot(u_sceneEnvironment1,v),dot(u_sceneEnvironment2,v));
}
vec3 sceneEnvironmentCubeDirection(vec3 value) {
  return all(equal(value,vec3(0.0)))?vec3(0.0,0.0,1.0):value;
}
vec3 sceneEnvironmentDirection(bool reflected) {
  vec3 n=sceneEnvironmentVector(g_sceneEnvironmentNormal);
  if(!reflected) return sceneEnvironmentCubeDirection(n);
  vec3 v=sceneEnvironmentVector(sceneEnvironmentUnit(v_sceneWorldPosition-u_sceneEyePosition));
  return sceneEnvironmentCubeDirection(v-2.0*dot(v,n)*n);
}`);
    source = source.replace(marker, `  g_sceneEnvironmentNormal=${worldNormalReady ? "normal" : "sceneEnvironmentUnit(mat3(v_sceneWorldTangent,v_sceneWorldBitangent,v_sceneWorldNormal)*normal)"};
${marker}`);
  }
  for (const binding of bindings) {
    if (binding.dimension !== "cube")
      continue;
    const layer = defines.layers.find((layer2) => layer2.slot === binding.slot);
    if (layer === void 0 || layer.uvSource !== 2 && layer.uvSource !== 7)
      throw new UnsupportedCubeCoordinatesError(`${binding.slot}: a cube image requires reflection or normal-direction coordinates`);
    const pattern = new RegExp(`vec4 sampleLayerTexel_${binding.slot}\\(\\) \\{[^}]*\\}`);
    if (!pattern.test(source))
      throw new TypeError("built-in cube sampler function is absent");
    source = source.replace(`uniform sampler2D ${binding.uniform};`, `uniform highp samplerCube ${binding.uniform};`);
    const direction = worldEnvironment && isEnvironmentBinding(binding) ? `sceneEnvironmentDirection(${layer.uvSource === 2 ? "true" : "false"})` : layer.uvSource === 2 ? "reflectionDirection()" : "normalize(v_viewNormal)";
    source = source.replace(pattern, `vec4 sampleLayerTexel_${binding.slot}() { return texture(${binding.uniform}, ${direction}); }`);
  }
  return source;
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/render/material-geometry.js
var IDENTITY2 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
var HIGH_HALF = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1 ? 1 : 0;
var PLACEMENT_DECLARATIONS = `uniform mat4 u_view, u_worldToMaterial;
in vec4 a_instanceMatrix0, a_instanceMatrix1, a_instanceMatrix2, a_instanceMatrix3;
mat3 sceneCofactor(mat3 m){return mat3(cross(m[1],m[2]),cross(m[2],m[0]),cross(m[0],m[1]));}
float sceneOrientationOf(mat3 m){return dot(m[0],cross(m[1],m[2]))<0.0?-1.0:1.0;}
`;
function placementLocals(worldGeometry) {
  return `
  mat4 model=mat4(a_instanceMatrix0,a_instanceMatrix1,a_instanceMatrix2,a_instanceMatrix3);
  mat4 modelView=u_view*model,materialWorld=u_worldToMaterial*model;
  float orientation=sceneOrientationOf(mat3(modelView));
  mat3 viewNormalMatrix=sceneCofactor(mat3(modelView))*orientation;
  mat3 worldNormalMatrix=sceneCofactor(mat3(materialWorld))*sceneOrientationOf(mat3(materialWorld));${worldGeometry ? "\n  float objectOrientation=sceneOrientationOf(mat3(model));\n  mat3 objectNormalMatrix=sceneCofactor(mat3(model))*objectOrientation;" : ""}`;
}
var SKIN_DECLARATIONS = `in vec4 a_skinJoints, a_skinWeights;
uniform highp sampler2D u_skinPalette;
uniform int u_skinBase;
mat4 skinMatrix(float joint){int texel=u_skinBase+int(joint)*4,width=textureSize(u_skinPalette,0).x;ivec2 at=ivec2(texel%width,texel/width);
  return mat4(texelFetch(u_skinPalette,at,0),texelFetch(u_skinPalette,at+ivec2(1,0),0),texelFetch(u_skinPalette,at+ivec2(2,0),0),texelFetch(u_skinPalette,at+ivec2(3,0),0));}
`;
var SKIN_LOCALS = `
  mat4 skin=skinMatrix(a_skinJoints.x)*a_skinWeights.x+skinMatrix(a_skinJoints.y)*a_skinWeights.y+skinMatrix(a_skinJoints.z)*a_skinWeights.z+skinMatrix(a_skinJoints.w)*a_skinWeights.w;
  vec3 skinPosition=(skin*vec4(a_position,1.0)).xyz,skinNormal=mat3(skin)*a_normal;
  vec4 skinTangent=vec4(mat3(skin)*a_tangent.xyz,a_tangent.w);`;
function sceneMaterialVertexSource(defines, environmentEnabled = false, worldShading = false, placementAttributes = false, skinned = false, tinted = false) {
  const worldGeometry = environmentEnabled || worldShading;
  const position2 = skinned ? "skinPosition" : "a_position";
  const normal = skinned ? "skinNormal" : "a_normal";
  const tangent = skinned ? "skinTangent" : "a_tangent";
  const name = placementAttributes ? {
    model: "model",
    modelView: "modelView",
    materialWorld: "materialWorld",
    worldNormal: "worldNormalMatrix",
    viewNormal: "viewNormalMatrix",
    orientation: "orientation",
    objectNormal: "objectNormalMatrix",
    objectOrientation: "objectOrientation"
  } : {
    model: "u_model",
    modelView: "u_modelView",
    materialWorld: "u_materialWorld",
    worldNormal: "u_worldNormalMatrix",
    viewNormal: "u_viewNormalMatrix",
    orientation: "u_orientation",
    objectNormal: "u_sceneWorldNormalMatrix",
    objectOrientation: "u_sceneWorldOrientation"
  };
  return `#version 300 es
precision highp float;
${placementAttributes ? "uniform mat4 u_viewProjection;" : "uniform mat4 u_model, u_modelView, u_viewProjection, u_materialWorld;\nuniform mat3 u_worldNormalMatrix, u_viewNormalMatrix;"}
uniform vec3 u_lightDirection;
${defines.sceneLighting ? "uniform vec3 u_sceneFillViewDirection0, u_sceneFillViewDirection1;\nout vec3 v_sceneFillDir0, v_sceneFillDir1;" : ""}
${worldGeometry && !placementAttributes ? "uniform mat3 u_sceneWorldNormalMatrix;\nuniform float u_sceneWorldOrientation;\n" : ""}uniform float ${placementAttributes ? "" : "u_orientation, "}u_orthographic;
in vec3 a_position, a_normal; in vec4 a_tangent;
${skinned ? SKIN_DECLARATIONS : ""}${tinted ? "in vec4 a_vertexTint; flat out vec4 v_vertexTint;\n" : ""}${Array.from({ length: defines.uvSetCount }, (_, i) => `in vec2 a_uv${i}; out vec2 v_uv${i};`).join("\n")}
${defines.usesVertexAlpha || defines.usesVertexColor ? "in vec4 a_color; out vec4 v_vertexColor;" : ""}
out vec3 v_normal, v_lightDir, v_halfVec, v_viewDir, v_viewPosition, v_viewNormal;
out vec3 v_modelPosition, v_modelNormal, v_worldPosition, v_worldNormal;
${worldGeometry ? "out vec3 v_sceneWorldPosition, v_sceneWorldNormal, v_sceneWorldTangent, v_sceneWorldBitangent;\n" : ""}out vec4 v_clipPosition;
vec3 unit(vec3 v,vec3 fallback){float len=length(v);return len>1e-9?v/len:fallback;}
${placementAttributes ? PLACEMENT_DECLARATIONS : ""}void main(){${placementAttributes ? placementLocals(worldGeometry) : ""}${skinned ? SKIN_LOCALS : ""}
  vec4 world=${name.model}*vec4(${position2},1.0);
  vec3 view=(${name.modelView}*vec4(${position2},1.0)).xyz;
  vec3 n=unit(${name.viewNormal}*${normal},vec3(0.0,0.0,1.0));
  vec3 rawT=mat3(${name.modelView})*${tangent}.xyz;
  vec3 fallback=unit(cross(abs(n.z)<0.9?vec3(0.0,0.0,1.0):vec3(0.0,1.0,0.0),n),vec3(1.0,0.0,0.0));
  vec3 t=unit(rawT-n*dot(n,rawT),fallback);
  vec3 b=cross(n,t)*(${tangent}.w<0.0?-1.0:1.0)*${name.orientation};
  mat3 tbn=transpose(mat3(t,b,n));
  vec3 eye=u_orthographic>0.5?vec3(0.0,0.0,1.0):unit(-view,vec3(0.0,0.0,1.0));
  v_normal=vec3(0.0,0.0,1.0); v_lightDir=tbn*u_lightDirection;
${defines.sceneLighting ? "  v_sceneFillDir0=tbn*u_sceneFillViewDirection0; v_sceneFillDir1=tbn*u_sceneFillViewDirection1;" : ""}
  v_halfVec=tbn*(-unit(eye+u_lightDirection,vec3(0.0,0.0,1.0))); v_viewDir=tbn*eye;
  v_viewPosition=u_orthographic>0.5?vec3(0.0,0.0,-1.0):view; v_viewNormal=n;
${worldGeometry ? `  vec3 sceneN=unit(${name.objectNormal}*${normal},vec3(0.0,0.0,1.0));
  vec3 sceneRawT=mat3(${name.model})*${tangent}.xyz;
  vec3 sceneFallback=unit(cross(abs(sceneN.z)<0.9?vec3(0.0,0.0,1.0):vec3(0.0,1.0,0.0),sceneN),vec3(1.0,0.0,0.0));
  vec3 sceneT=unit(sceneRawT-sceneN*dot(sceneN,sceneRawT),sceneFallback);
  v_sceneWorldPosition=world.xyz;v_sceneWorldNormal=sceneN;v_sceneWorldTangent=sceneT;
  v_sceneWorldBitangent=cross(sceneN,sceneT)*(${tangent}.w<0.0?-1.0:1.0)*${name.objectOrientation};
` : ""}  v_modelPosition=${position2};v_modelNormal=unit(${normal},vec3(0.0,0.0,1.0));
  v_worldPosition=(${name.materialWorld}*vec4(${position2},1.0)).xyz;v_worldNormal=unit(${name.worldNormal}*${normal},vec3(0.0,0.0,1.0));
  v_clipPosition=u_viewProjection*world;gl_Position=v_clipPosition;
  ${Array.from({ length: defines.uvSetCount }, (_, i) => `v_uv${i}=a_uv${i};`).join("\n")}
  ${defines.usesVertexAlpha || defines.usesVertexColor ? "v_vertexColor=a_color;" : ""}${tinted ? "\n  v_vertexTint=a_vertexTint;" : ""}
}`;
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/materials/normal-blending.js
var WORLD_NORMAL_VARYINGS = "in vec3 v_sceneWorldPosition, v_sceneWorldNormal, v_sceneWorldTangent, v_sceneWorldBitangent;";
function objectSpaceNormalLayerShader(source) {
  const main = source.indexOf("void main() {");
  const start = source.indexOf("  vec3 normal = ", main);
  const lineEnd = source.indexOf("\n", start);
  if (main < 0 || start < main || lineEnd < start)
    throw new TypeError("built-in material primary normal stage is absent");
  source = source.slice(0, lineEnd + 1) + "  normal = sceneObjectUnit(u_sceneWorldNormalMatrix * (u_normalMapTransform * normal));\n" + source.slice(lineEnd + 1);
  return source.replaceAll("dot(normal, v_lightDir)", "dot(normal, u_sceneLightDirection)").replaceAll("-dot(v_halfVec, normal)", "-dot(sceneObjectHalfVector(), normal)").replace("precision highp float;", `precision highp float;
uniform mat3 u_normalMapTransform, u_sceneWorldNormalMatrix;
uniform vec3 u_sceneLightDirection, u_sceneLightingEye, u_sceneLightingViewDirection;
uniform float u_sceneLightingOrthographic;
vec3 sceneObjectUnit(vec3 value){float size=length(value);return size>1e-9?value/size:vec3(0.0,0.0,1.0);}
vec3 sceneObjectHalfVector(){
  vec3 eye=u_sceneLightingOrthographic>0.5?u_sceneLightingViewDirection:sceneObjectUnit(u_sceneLightingEye-v_sceneWorldPosition);
  return -sceneObjectUnit(eye+u_sceneLightDirection);
}`);
}
var unit3 = (v, threshold = 1e-8) => {
  const length = Math.hypot(...v);
  return length > threshold ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 1];
};
function normalInBasis(value, basis) {
  return unit3(basis === void 0 ? value : [
    basis.tangent[0] * value[0] + basis.bitangent[0] * value[1] + basis.normal[0] * value[2],
    basis.tangent[1] * value[0] + basis.bitangent[1] * value[1] + basis.normal[1] * value[2],
    basis.tangent[2] * value[0] + basis.bitangent[2] * value[1] + basis.normal[2] * value[2]
  ]);
}
function blendSignedNormals(base, first, second, maskSum, basis) {
  const factor = Math.max(-1, Math.min(1, maskSum));
  const source = normalInBasis(base, basis);
  const detail = normalInBasis(factor < 0 ? first : second, basis);
  const weight = factor * factor;
  return unit3([
    source[0] + (detail[0] - source[0]) * weight,
    source[1] + (detail[1] - source[1]) * weight,
    source[2] + (detail[2] - source[2]) * weight
  ], 1e-6);
}
function signedNormalFactor(first, firstFactors, second, secondFactors) {
  const maskScale = Math.max(1, ...first.map(Math.abs), ...second.map(Math.abs));
  const factorScale = Math.max(1, ...firstFactors.map(Math.abs), ...secondFactors.map(Math.abs));
  const dot4 = (mask, factors) => mask.reduce((sum, value2, index2) => sum + value2 / maskScale * ((factors[index2] ?? 0) / factorScale), 0);
  const value = dot4(first, firstFactors) + dot4(second, secondFactors);
  if (value === 0)
    return 0;
  return Math.abs(value) >= 1 / factorScale / maskScale ? Math.sign(value) : value * factorScale * maskScale;
}
function signedNormalLayerShader(source, defines, policy, perLayerFormats) {
  const main = source.indexOf("void main() {");
  const start = source.indexOf("  vec3 normal = ", main);
  const end = source.indexOf("  vec3 color = vec3(0.0);", start);
  if (main < 0 || start < main || end < start)
    throw new TypeError("built-in material normal stage is absent");
  const decode = (slot) => {
    const layer = defines.layers.find((layer2) => layer2.slot === slot);
    if (layer === void 0) {
      if (slot !== "normal")
        throw new TypeError("signed normal policy requires both detail layers");
      return "vec3(0.0,0.0,1.0)";
    }
    const texel = layer.hasTexture ? `sampleLayerTexel_${slot}()` : `u_${slot}Color`;
    return `${perLayerFormats ? `sceneDecode_${slot}` : "decodeNormal"}(${texel})`;
  };
  const mask = (slot) => defines.layers.some((layer) => layer.slot === slot) ? `computeLayer_${slot}()` : "vec4(1.0,0.0,0.0,0.0)";
  const stage = `  mat3 sceneBasis=mat3(v_sceneWorldTangent,v_sceneWorldBitangent,v_sceneWorldNormal);
  vec3 sceneBase=sceneSignedNormalUnit(sceneBasis*${decode("normal")});
  vec3 sceneFirst=sceneSignedNormalUnit(sceneBasis*${decode("normalBlend1")});
  vec3 sceneSecond=sceneSignedNormalUnit(sceneBasis*${decode("normalBlend2")});
  float sceneFactor=sceneSignedFactor(${mask("normalBlend1Mask")},u_normalBlend1Factors,${policy.secondMask ? `${mask("normalBlend2Mask")},u_normalBlend2Factors` : "vec4(0.0),vec4(0.0)"});
  vec3 normal=sceneSignedUnit(mix(sceneBase,sceneFactor<0.0?sceneFirst:sceneSecond,sceneFactor*sceneFactor),1e-6);
`;
  source = source.slice(0, start) + stage + source.slice(end);
  source = source.replaceAll("dot(normal, v_lightDir)", "dot(normal, u_sceneLightDirection)").replaceAll("-dot(v_halfVec, normal)", "-dot(sceneSignedHalfVector(), normal)");
  return source.replace("precision highp float;", `precision highp float;
uniform vec3 u_sceneLightDirection, u_sceneLightingEye, u_sceneLightingViewDirection;
uniform float u_sceneLightingOrthographic;
vec3 sceneSignedUnit(vec3 value, float threshold) {
  float scale=max(max(abs(value.x),abs(value.y)),abs(value.z));
  if (scale==0.0) return vec3(0.0,0.0,1.0);
  vec3 scaled=value/scale;
  float magnitude=length(scaled);
  return scale>threshold/magnitude?scaled/magnitude:vec3(0.0,0.0,1.0);
}
float sceneSignedAbsMax(vec4 value) {
  return max(max(abs(value.x),abs(value.y)),max(abs(value.z),abs(value.w)));
}
float sceneSignedFactor(vec4 first,vec4 firstFactors,vec4 second,vec4 secondFactors) {
  float maskScale=max(1.0,max(sceneSignedAbsMax(first),sceneSignedAbsMax(second)));
  float factorScale=max(1.0,max(sceneSignedAbsMax(firstFactors),sceneSignedAbsMax(secondFactors)));
  float value=dot(first/maskScale,firstFactors/factorScale)+dot(second/maskScale,secondFactors/factorScale);
  if (value==0.0) return 0.0;
  return abs(value)>=(1.0/factorScale)/maskScale?sign(value):(value*factorScale)*maskScale;
}
vec3 sceneSignedNormalUnit(vec3 value) {
  return sceneSignedUnit(value,1e-8);
}
vec3 sceneSignedHalfVector() {
  vec3 eye=u_sceneLightingOrthographic>0.5?u_sceneLightingViewDirection:sceneSignedUnit(u_sceneLightingEye-v_sceneWorldPosition,1e-9);
  return -sceneSignedUnit(eye+u_sceneLightDirection,1e-9);
}`);
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/materials/standard-program.js
function withoutDiffuseTeamColor(material) {
  if (!Object.values(material.layers).some((layer) => layer.teamColorMode === 1))
    return material;
  const layers = {};
  for (const [slot, layer] of Object.entries(material.layers))
    layers[slot] = layer.teamColorMode !== 1 ? layer : (
      // ponytail: RGBA → RGB restores the forced alpha of 1; AAAA/RRRR/GGGG/BBBB team-colored
      // layers would keep their selected alpha. Add an explicit intensity uniform if one appears.
      { ...layer, teamColorMode: 0, channels: layer.channels === 1 ? 0 : layer.channels }
    );
  return Object.freeze({ ...material, layers: Object.freeze(layers) });
}
function specularOfTeamColor(material) {
  return material.specMode === 1 && material.layers.diffuse?.teamColorMode !== 1 ? Object.freeze({ ...material, specMode: 0 }) : material;
}
function emissiveBlendThroughRgb(material) {
  const blendsRgb = (slot) => material.layers[slot]?.op === 3 && material.layers[slot]?.channels === 0;
  if (!blendsRgb("emissive1") && !blendsRgb("emissive2"))
    return material;
  const layers = { ...material.layers };
  for (const slot of ["emissive1", "emissive2"]) {
    const layer = material.layers[slot];
    if (layer !== void 0 && blendsRgb(slot))
      layers[slot] = Object.freeze({ ...layer, op: 2 });
  }
  return Object.freeze({ ...material, layers: Object.freeze(layers) });
}
function finiteVector(value, size, name) {
  if (!Array.isArray(value) || value.length !== size || value.some((component) => typeof component !== "number" || !Number.isFinite(component) || !Number.isFinite(Math.fround(component))))
    throw new TypeError(`${name} requires ${size} finite float32 components`);
  return value;
}
function materialPropertyOverrides(material, values, pathCache) {
  if (values === void 0) return material;
  const animatedLayerFields = new Set(["constantColor", "colorMultiply", "colorAdd", "alphaFactor", "uvOffset", "uvTiling", "uvAngle", "uvTriplanarOffset", "uvTriplanarScale", "frame"]);
  let result = material;
  for (const [key, incoming] of Object.entries(values)) {
    if (incoming === void 0) continue;
    let path = pathCache.get(key);
    if (path === void 0) {
      path = Object.freeze(key.split("."));
      if (path.length > 6 || path.some(part => !part || ["__proto__", "prototype", "constructor"].includes(part)))
        throw new TypeError("invalid material property path");
      pathCache.set(key, path);
    }
    const components = Array.isArray(incoming) ? finiteVector(incoming, incoming.length, "material property " + key) : [finite2(incoming, "material property " + key)];
    if (components.length > 16) throw new TypeError("material property vector too large");
    const value = Array.isArray(incoming) ? Object.freeze([...components]) : incoming;
    const replace = (object, index) => {
      const part = path[index];
      if (object === void 0 || object === null) {
        // Optional UV controls can be omitted by the converter when their base
        // value is neutral. Other absent branches have no native binding target.
        throw new TypeError("missing material property branch " + key);
      }
      const copy = Array.isArray(object) ? [...object] : {...object};
      const previous = object[part];
      if (index + 1 < path.length) copy[part] = replace(previous, index + 1);
      else {
        const layerField = path[0] === "layers" && animatedLayerFields.has(part);
        const animated = layerField || part === "parallaxHeight" || path[0] === "normalBlendFactors";
        const disabledColorOperation = previous === void 0 && layerField && ["colorMultiply", "colorAdd"].includes(part);
        if (!disabledColorOperation) {
          const expected = layerField ? ({constantColor: 4, uvOffset: 2, uvTiling: 2, uvAngle: 3, uvTriplanarOffset: 3, uvTriplanarScale: 3}[part] ?? 1) : animated ? 1 : Array.isArray(previous) ? previous.length : 1;
          if (components.length !== expected) throw new TypeError("material property component count " + key);
          copy[part] = animated ? Object.freeze({value}) : value;
        }
      }
      return Object.freeze(copy);
    };
    result = replace(result, 0);
  }
  return result;
}
function createStandardMaterialPrograms(parameters, options) {
  const sampler = createRenderMaterialSampler(parameters, options.budget, options.signal);
  const sources = /* @__PURE__ */ new Map();
  const propertyPathCache = new Map();
  return Object.freeze({
    resources: sampler.resources,
    usesSceneEnvironment: sampler.usesSceneEnvironment,
    sample(time, lighting = {}, signalOrOverrides) {
      const overrideOptions = signalOrOverrides && ("propertyValues" in signalOrOverrides || "passPropertyValues" in signalOrOverrides) ? signalOrOverrides : void 0;
      const signal = overrideOptions?.signal ?? (overrideOptions === void 0 ? signalOrOverrides : void 0);
      const teamColor = Object.freeze([
        ...finiteVector(lighting.teamColor ?? [1, 0, 0], 3, "team color")
      ]);
      const teamColorDiffuse = Object.freeze([...finiteVector(lighting.teamColorDiffuse ?? teamColor, 3, "diffuse team color")]);
      const teamColorEmissive = Object.freeze([...finiteVector(lighting.teamColorEmissive ?? teamColor, 3, "emissive team color")]);
      const teamColorExponents = Object.freeze([...finiteVector(lighting.teamColorExponents ?? [1, 1], 2, "team color exponents")]);
      const ambient = Object.freeze([
        ...finiteVector(lighting.ambient ?? [0.02, 0.02, 0.02, 0], 4, "material ambient")
      ]);
      const terrainTiling = Object.freeze([
        ...finiteVector(lighting.terrainTiling ?? [1, 1, 0, 0], 4, "terrain tiling")
      ]);
      const normalFormats = snapshotNormalFormats(lighting.normalMapFormats);
      const textureDimensions = new Map(lighting.textureDimensions);
      const environment = snapshotEnvironment(lighting.environment);
      for (const value of textureDimensions.values())
        if (value !== "2d" && value !== "cube")
          throw new TypeError("invalid material texture dimension");
      const intensity = lighting.teamColorIntensity ?? 1;
      if (intensity !== 0 && intensity !== 1)
        throw new TypeError("team color intensity must be 0 or 1");
      return Object.freeze(sampler.sample(time, signal).map((original, passIndex) => {
        const commonValues = overrideOptions?.propertyValues ?? lighting.propertyValues;
        const passValues = overrideOptions?.passPropertyValues?.[passIndex];
        const material = materialPropertyOverrides(original.material, passValues === void 0 ? commonValues : {...commonValues, ...passValues}, propertyPathCache);
        const pass = {...original, material};
        return compilePass({
        ...pass,
        material: specularOfTeamColor(intensity === 0 ? withoutDiffuseTeamColor(pass.material) : pass.material)
      }, { teamColor, teamColorDiffuse, teamColorEmissive, teamColorExponents, ambient, terrainTiling }, sources, normalFormats, sampler.worldToMaterial, textureDimensions, environment, lighting.sceneLighting === true);
      }));
    }
  });
}
function compilePass(pass, lighting, sources, bindings, worldToMaterial, textureDimensions = /* @__PURE__ */ new Map(), environment, sceneLighting = false) {
  const { material, alpha } = pass;
  const normalFormats = materialNormalFormats(material, bindings);
  const objectSpaceNormal = material.normalMapSpace === "object";
  const defines = buildMaterialDefines(material, {
    ...normalFormats === void 0 ? {} : { normalMapFormat: "rgb8" },
    ...sceneLighting ? { sceneLighting: true } : {}
  });
  const uniforms = {
    u_teamColor: lighting.teamColor,
    u_teamColorDiffuse: lighting.teamColorDiffuse ?? lighting.teamColor,
    u_teamColorEmissive: lighting.teamColorEmissive ?? lighting.teamColor,
    u_teamColorExponents: lighting.teamColorExponents ?? [1, 1],
    u_ambient: lighting.ambient,
    u_specularity: material.specularity,
    u_specMult: material.specMult,
    u_emisMult: material.emisMult,
    u_emissiveTint: material.emissiveTint ?? [1, 1, 1],
    u_environmentMultipliers: material.environmentMultipliers ?? [1, 0, 0],
    u_terrainTiling: lighting.terrainTiling,
    u_materialAlpha: alpha,
    u_alphaTestThreshold: material.alphaTestThreshold,
    u_parallaxHeight: material.parallaxHeight?.value ?? 0,
    u_normalBlend1Factors: material.normalBlendFactors?.slice(0, 4).map((factor) => factor.value) ?? [
      1,
      0,
      0,
      0
    ],
    u_normalBlend2Factors: material.normalBlendFactors?.slice(4, 8).map((factor) => factor.value) ?? [
      1,
      0,
      0,
      0
    ],
    u_normalMapTransform: material.normalMapTransform ?? [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ...defines.pbr === true ? {
      u_metallicFactor: material.metallicFactor ?? 1,
      u_roughnessFactor: material.roughnessFactor ?? 1
    } : {},
    ...defines.tonemap === true && material.tonemap !== void 0 ? { u_tonemapCurve: material.tonemap.slice(0, 4), u_tonemapE: material.tonemap[4] } : {}
  };
  const textures = [], diagnostics = [];
  for (const definition of defines.layers) {
    const { slot } = definition, layer = material.layers[slot];
    if (layer === void 0)
      throw new TypeError(`missing material layer ${slot}`);
    const prefix = `u_${slot}`;
    if (layer.texturePath !== null)
      textures.push(Object.freeze({
        slot,
        resourceId: layer.texturePath,
        uniform: `${prefix}Map`,
        wrapU: layer.wrapX ? "repeat" : "clamp",
        wrapV: layer.wrapY ? "repeat" : "clamp",
        ...textureDimensions.get(layer.texturePath) === "cube" ? { dimension: "cube" } : {}
      }));
    else
      uniforms[`${prefix}Color`] = layer.constantColor?.value ?? [1, 1, 1, 1];
    uniforms[`${prefix}Multiply`] = layer.colorMultiply?.value ?? 1;
    uniforms[`${prefix}Add`] = layer.colorAdd?.value ?? 0;
    uniforms[`${prefix}AlphaFactor`] = layer.alphaFactor?.value ?? 1;
    uniforms[`${prefix}UvAngle`] = layer.uvAngle?.value ?? [0, 0, 0];
    uniforms[`${prefix}UvTriplanarOffset`] = layer.uvTriplanarOffset?.value ?? [0, 0, 0];
    uniforms[`${prefix}UvTriplanarScale`] = layer.uvTriplanarScale?.value ?? [1, 1, 1];
    const tiling = layer.uvTiling?.value ?? [1, 1], offset = layer.uvOffset?.value ?? [0, 0];
    if (layer.flipbook === void 0) {
      uniforms[`${prefix}UvTiling`] = tiling;
      uniforms[`${prefix}UvOffset`] = offset;
    } else {
      const { rows, cols } = layer.flipbook;
      const frame = (Math.floor(layer.flipbook.frame.value) % (rows * cols) + rows * cols) % (rows * cols);
      const frameSize = layer.flipbook.frameSize;
      const beforeTiling = (cell, scale) => scale === 0 ? 0 : cell / scale;
      if (frameSize === void 0) {
        uniforms[`${prefix}UvTiling`] = [tiling[0] / cols, tiling[1] / rows];
        uniforms[`${prefix}UvOffset`] = [
          offset[0] - beforeTiling(frame % cols + 0.5 - cols / 2, tiling[0]),
          offset[1] - beforeTiling(Math.floor(frame / cols) + 0.5 - rows / 2, tiling[1])
        ];
      } else {
        uniforms[`${prefix}UvTiling`] = tiling;
        uniforms[`${prefix}UvOffset`] = [
          offset[0] - beforeTiling(frame % cols * frameSize[0], tiling[0]),
          offset[1] - beforeTiling(Math.floor(frame / cols) * frameSize[1], tiling[1])
        ];
      }
    }
    if (layer.fresnel !== void 0 && layer.fresnel.transformMode !== 0)
      diagnostics.push(`${slot}: Fresnel matrix transform is preserved but not evaluated by the shared kernel`);
    if (layer.uvSource === 6)
      diagnostics.push(`${slot}: particle UV requires a particle geometry adapter`);
  }
  for (const binding of textures)
    if (binding.dimension === "cube" && !(environment !== void 0 && isEnvironmentBinding(binding))) {
      const slot = `u_${binding.slot}`;
      const same = (key2, expected) => {
        const value = uniforms[key2];
        return Array.isArray(value) && value.length === expected.length && value.every((item, index2) => item === expected[index2]);
      };
      if (!same(`${slot}UvAngle`, [0, 0, 0]) || !same(`${slot}UvOffset`, [0, 0]) || !same(`${slot}UvTiling`, [1, 1]) || uniforms["u_parallaxHeight"] !== 0)
        throw new UnsupportedCubeCoordinatesError(`${binding.slot}: transformed UV/flipbook/parallax sampling of a cube image requires a direction-space mapping`);
    }
  const worldEnvironment = environment !== void 0 && textures.some(isEnvironmentBinding);
  const policy = material.normalBlendPolicy;
  if (worldEnvironment)
    for (const row of [0, 1, 2])
      uniforms[`u_sceneEnvironment${row}`] = [0, 4, 8, 12].map((column) => environment.worldToEnvironment[row + column] ?? 0);
  const key = canonicalDefineKey(defines) + (normalFormats === void 0 ? "" : `;normals=${NORMAL_SLOTS.map((slot) => normalFormats[slot]).join(",")}`) + textures.filter((binding) => binding.dimension === "cube").map((binding) => `;cube=${binding.slot}`).join("") + (worldEnvironment ? ";environment=world" : "") + (policy === void 0 ? "" : `;normals=signed-two-detail;mask2=${policy.secondMask}`);
  let compiled = sources.get(key);
  if (compiled === void 0) {
    let fragmentSource = "#version 300 es\n" + buildStandardFragmentSource(defines, { precision: "precision highp float;" }).replaceAll("varying ", "in ").replaceAll("texture2D(", "texture(").replace("void main() {", "out vec4 materialColor;\nvoid main() {").replaceAll("gl_FragColor", "materialColor");
    if (normalFormats !== void 0)
      fragmentSource = normalLayerShader(fragmentSource, normalFormats);
    if (policy !== void 0)
      fragmentSource = signedNormalLayerShader(fragmentSource, defines, policy, normalFormats !== void 0);
    if (objectSpaceNormal)
      fragmentSource = objectSpaceNormalLayerShader(fragmentSource);
    fragmentSource = cubeLayerShader(fragmentSource, defines, textures, worldEnvironment, policy !== void 0);
    if (worldEnvironment || policy !== void 0 || objectSpaceNormal)
      fragmentSource = fragmentSource.replace("precision highp float;", `precision highp float;
${WORLD_NORMAL_VARYINGS}`);
    const vertexSource = worldEnvironment || policy !== void 0 || objectSpaceNormal ? sceneMaterialVertexSource(defines, worldEnvironment, policy !== void 0 || objectSpaceNormal) : "#version 300 es\nprecision highp float;\n" + buildStandardVertexSource(defines).replaceAll("attribute ", "in ").replaceAll("varying ", "out ").replaceAll("texture2D(", "texture(");
    for (const layer of defines.layers)
      Object.freeze(layer);
    Object.freeze(defines.layers);
    compiled = Object.freeze({ vertexSource, fragmentSource, defines: Object.freeze(defines) });
    sources.set(key, compiled);
  }
  for (const value of Object.values(uniforms))
    if (Array.isArray(value))
      Object.freeze(value);
  return Object.freeze({
    key,
    ...compiled,
    uniforms: Object.freeze(uniforms),
    textures: Object.freeze(textures),
    blend: standardBlendModeName(material.blendMode, material.alphaTestThreshold),
    twoSided: material.twoSided,
    depthPrepass: material.depthPrepass ?? false,
    priority: pass.priority,
    diagnostics: Object.freeze(diagnostics),
    normalMapSpace: material.normalMapSpace ?? "tangent",
    ...worldToMaterial === void 0 ? {} : { worldToMaterial },
    ...worldEnvironment ? { environment } : {},
    ...policy === void 0 ? {} : { normalBlendPolicy: policy },
    ...material.tangentGeneration === void 0 ? {} : { tangentGeneration: material.tangentGeneration },
    sampleNormal: (pixel = {}, basis) => sampleNormal(material, lighting, pixel, normalFormats, basis),
    shade: (pixel = {}) => shade(material, alpha, lighting, pixel, normalFormats, sceneLighting)
  });
}
function shade(material, alpha, lighting, pixel, normalFormats, sceneLighting = false) {
  const teamColor = pixel.teamColor ?? lighting.teamColor, ambient = pixel.ambient ?? lighting.ambient;
  finiteVector(teamColor, 3, "team color");
  finiteVector(ambient, 4, "material ambient");
  for (const vector6 of [
    pixel.normal,
    pixel.shadingNormal,
    pixel.lightDirection,
    pixel.halfVector,
    pixel.viewDirection,
    pixel.viewNormal,
    pixel.eyeToVertex
  ])
    if (vector6 !== void 0)
      finiteVector(vector6, 3, "material lighting vector");
  if (pixel.vertexColor !== void 0)
    finiteVector(pixel.vertexColor, 4, "material vertex color");
  const shadingNormal = pixel.shadingNormal ?? (material.normalBlendPolicy === void 0 ? void 0 : sampleNormal(material, lighting, pixel, normalFormats));
  const layers = pixelLayers(material, pixel, teamColor, normalFormats, Object.keys(material.layers).filter((slot) => shadingNormal === void 0 || ![
    "normal",
    "normalBlend1",
    "normalBlend2",
    "normalBlend1Mask",
    "normalBlend2Mask"
  ].includes(slot)));
  const vertexNormal = shadingNormal ?? pixel.normal;
  return composeStandardPixelCpu({
    layers,
    teamColor,
    teamColorDiffuse: pixel.teamColorDiffuse ?? lighting.teamColorDiffuse ?? teamColor,
    teamColorEmissive: pixel.teamColorEmissive ?? lighting.teamColorEmissive ?? teamColor,
    teamColorExponents: pixel.teamColorExponents ?? lighting.teamColorExponents ?? [1, 1],
    ambient,
    ...sceneLighting ? {
      sceneLighting: pixel.sceneLighting ?? {
        ambientColor: [ambient[0], ambient[1], ambient[2]],
        lightColor: [1, 1, 1]
      }
    } : {},
    materialAlpha: alpha,
    specularity: material.specularity,
    specMult: material.specMult,
    emisMult: material.emisMult,
    specMode: material.specMode,
    ...material.specularEnergyConservation === true ? { specularEnergyConservation: true } : {},
    unshaded: material.unshaded,
    doubleLambert: material.doubleLambert,
    clampOutput: material.clampOutput,
    alphaTestThreshold: material.alphaTestThreshold,
    usesVertexColor: material.usesVertexColor,
    usesVertexAlpha: material.usesVertexAlpha,
    ...material.blendMode === 2 ? { modAlpha: true } : {},
    ...normalFormats === void 0 && material.normalMapFormat === void 0 ? {} : { normalMapFormat: normalFormats === void 0 ? material.normalMapFormat : "rgb8" },
    ...material.environmentMultipliers === void 0 ? {} : { environmentMultipliers: material.environmentMultipliers },
    ...material.emissiveTint === void 0 ? {} : { emissiveTint: material.emissiveTint },
    ...material.normalBlendFactors === void 0 ? {} : {
      normalBlendFactors: material.normalBlendFactors.map((factor) => factor.value)
    },
    ...vertexNormal === void 0 ? {} : { vertexNormal },
    ...pixel.lightDirection === void 0 ? {} : { lightDir: pixel.lightDirection },
    ...pixel.halfVector === void 0 ? {} : { halfVec: pixel.halfVector },
    ...pixel.viewDirection === void 0 ? {} : { viewDir: pixel.viewDirection },
    ...pixel.vertexColor === void 0 ? {} : { vertexColor: pixel.vertexColor },
    ...material.lightingModel === "pbr-metallic-roughness" ? {
      pbr: {
        metallicFactor: material.metallicFactor ?? 1,
        roughnessFactor: material.roughnessFactor ?? 1
      }
    } : {},
    // as buildMaterialDefines: an unshaded material is drawn as stored
    ...material.lightingModel === "pbr-metallic-roughness" && material.colorPipeline === "linear-srgb" && !material.unshaded ? { linearColor: material.tonemap === void 0 ? {} : { tonemap: material.tonemap } } : {}
  });
}
function pixelLayers(material, pixel, teamColor, normalFormats, slots = Object.keys(material.layers)) {
  const layers = {};
  for (const slot of slots) {
    const layer = material.layers[slot];
    if (layer === void 0)
      continue;
    const texel = layer.texturePath === null ? layer.constantColor?.value : pixel.texels?.[layer.slot];
    if (texel === void 0)
      throw new TypeError(`material ${slot} requires sampled texture ${layer.texturePath}`);
    finiteVector(texel, 4, `${slot} texel`);
    const sample = {
      texel: normalFormats !== void 0 && NORMAL_SLOTS.some((normal) => normal === slot) ? normalTexelRgb(texel, normalFormats[slot]) : texel,
      channels: layer.channels,
      op: layer.op,
      teamColorMode: layer.teamColorMode,
      invert: layer.invert,
      clampResult: layer.clampResult,
      ...layer.colorMultiply === void 0 ? {} : { colorMultiply: layer.colorMultiply.value },
      ...layer.colorAdd === void 0 ? {} : { colorAdd: layer.colorAdd.value },
      ...layer.alphaFactor === void 0 ? {} : { alphaFactor: layer.alphaFactor.value },
      ...layer.fresnel === void 0 ? {} : {
        fresnel: {
          ...layer.fresnel,
          // The frozen composition kernel has no view-vector argument. Resolve its Fresnel
          // scalar with the shared function, then supply that constant at the same pipeline
          // stage. Keep channel metadata: environment masks distinguish RGBA from AAAA.
          min: calculateLayerFresnelCpu(layer.fresnel, pixel.viewNormal ?? [0, 0, 1], pixel.eyeToVertex ?? [0, 0, -1]),
          maxOffset: 0
        }
      }
    };
    layers[layer.slot] = sample;
  }
  return layers;
}
function sampleNormal(material, lighting, pixel, formats, basis) {
  const team = pixel.teamColor ?? lighting.teamColor;
  finiteVector(team, 3, "team color");
  for (const value of [pixel.normal, pixel.viewNormal, pixel.eyeToVertex])
    if (value !== void 0)
      finiteVector(value, 3, "material normal vector");
  if (basis !== void 0)
    for (const value of [basis.tangent, basis.bitangent, basis.normal])
      finiteVector(value, 3, "material normal basis");
  const layers = pixelLayers(material, pixel, team, formats, [
    "normal",
    "normalBlend1",
    "normalBlend2",
    "normalBlend1Mask",
    "normalBlend2Mask"
  ]);
  const format = formats === void 0 ? material.normalMapFormat ?? "dxt5nm" : "rgb8";
  let normal = layers.normal === void 0 ? pixel.normal ?? [0, 0, 1] : decodeNormalCpu(layers.normal.texel, format);
  if (material.normalMapSpace === "object" && layers.normal !== void 0) {
    const transform = material.normalMapTransform ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
    normal = [
      transform[0] * normal[0] + transform[3] * normal[1] + transform[6] * normal[2],
      transform[1] * normal[0] + transform[4] * normal[1] + transform[7] * normal[2],
      transform[2] * normal[0] + transform[5] * normal[1] + transform[8] * normal[2]
    ];
  }
  const maskValue = (index2) => {
    const mask = layers[index2 === 0 ? "normalBlend1Mask" : "normalBlend2Mask"];
    return mask === void 0 ? [1, 0, 0, 0] : computeLayerColorCpu(mask, team);
  };
  const maskFactors = (index2) => {
    const read = (channel2) => material.normalBlendFactors?.[index2 * 4 + channel2]?.value ?? (channel2 === 0 ? 1 : 0);
    return [read(0), read(1), read(2), read(3)];
  };
  const maskWeight = (index2) => {
    const weights = maskValue(index2);
    return weights.reduce((sum, value, channel2) => sum + value * (material.normalBlendFactors?.[index2 * 4 + channel2]?.value ?? (channel2 === 0 ? 1 : 0)), 0);
  };
  if (material.normalBlendPolicy !== void 0) {
    const first = layers.normalBlend1, second = layers.normalBlend2;
    if (first === void 0 || second === void 0)
      throw new TypeError("signed normal policy requires both detail layers");
    return blendSignedNormals(normal, decodeNormalCpu(first.texel, format), decodeNormalCpu(second.texel, format), signedNormalFactor(maskValue(0), maskFactors(0), material.normalBlendPolicy.secondMask ? maskValue(1) : [0, 0, 0, 0], material.normalBlendPolicy.secondMask ? maskFactors(1) : [0, 0, 0, 0]), basis);
  }
  for (const index2 of [0, 1]) {
    const detail = layers[index2 === 0 ? "normalBlend1" : "normalBlend2"];
    if (detail === void 0)
      continue;
    const factor = Math.min(1, Math.max(0, maskWeight(index2)));
    const decoded = decodeNormalCpu(detail.texel, format);
    const mixed = [
      normal[0] + (decoded[0] - normal[0]) * factor,
      normal[1] + (decoded[1] - normal[1]) * factor,
      normal[2] + (decoded[2] - normal[2]) * factor
    ];
    const length = Math.hypot(...mixed);
    normal = length > 1e-8 ? [mixed[0] / length, mixed[1] / length, mixed[2] / length] : [0, 0, 1];
  }
  return basis === void 0 ? normal : normalInBasis(normal, basis);
}

// ../node_modules/.pnpm/@modkit+scene@file+vendor+modkit-scene-1.0.0.tgz/node_modules/@modkit/scene/dist/uvm/collision-mesh.js
function readCollisionMesh(document, binary, shape, budget, signal) {
  const positions = readUvmAccessor(document, binary, shape["positions"], budget, "collision positions", signal);
  if (positions.width !== 3 || positions.componentType !== 5126 || positions.normalized || positions.count === 0 || !positions.values.every(Number.isFinite))
    throw new TypeError("UV_game_collision positions must be finite nonempty float VEC3");
  if (!(positions.values instanceof Float32Array))
    throw new TypeError("collision positions are not float32");
  let scalarBytes = positions.values.byteLength;
  if (shape["kind"] !== "mesh")
    return { positions: positions.values, scalarBytes };
  const indices = readUvmAccessor(document, binary, shape["indices"], { maxScalarBytes: budget.maxScalarBytes - scalarBytes }, "indices", signal);
  if (indices.width !== 1 || ![5121, 5123, 5125].includes(indices.componentType) || indices.normalized || indices.count === 0 || indices.count % 3 !== 0)
    throw new TypeError("UV_game_collision mesh indices must form integer triangles");
  for (let i = 0; i < indices.values.length; i++) {
    if (i % 4096 === 0)
      signal?.throwIfAborted();
    const index2 = indices.values[i];
    if (index2 === void 0 || index2 >= positions.count)
      throw new RangeError("UV_game_collision mesh index exceeds its positions");
  }
  scalarBytes += indices.values.byteLength;
  return { positions: positions.values, indices: indices.values, scalarBytes };
}

export {
  ModkitError,
  DEFAULT_UVM_CONTAINER_BUDGET,
  checkUvmContainerBudget,
  readUvmContainer,
  writeUvmContainer,
  packUvmGlb,
  uvmImageUri,
  readUvmAccessor,
  materializeUvmAnimationMaterialTargets,
  uvmAnimationPlayback,
  uvmAnimationEvents,
  readUvmPrimitiveVisibility,
  uvmVisibilityPointer,
  readUvmAnimationClips,
  uvmKeyTimesMetadata,
  readUvmTextureColorKeys,
  readUvmTextureAlpha,
  validateUvmDocument,
  object2 as object,
  field2 as field,
  nonBlank2 as nonBlank,
  string,
  array2 as array,
  safeIndex2 as safeIndex,
  required,
  finiteArray2 as finiteArray,
  vector3,
  vector4,
  withMaterialFrame,
  uvmSceneFrameInverse,
  removeUvmFrameWrappers,
  invertMaterialFrame,
  multiplyMaterialFrames,
  IDENTITY_MATERIAL_FRAME,
  snapshotEnvironment,
  snapshotEyePosition,
  RENDER_MATERIAL_SHADER,
  MATERIAL_LAYERS_SHADER,
  createRenderMaterialSampler,
  invertQuat,
  multiplyQuat,
  snapshotModelBillboards,
  applyModelFaceCameraBillboard,
  billboardCameraRotation,
  applyModelBillboards,
  readUvmBillboards,
  BufferBuilder,
  encodeSkeleton,
  addJointAttribute,
  encodeAnimationChannel,
  addAccessor,
  appendUvmAccessors,
  standardBlendModeName,
  createStandardMaterialPrograms,
  nativeMaterialMath,
  readUvmModel,
  readCollisionMesh,
  uvmImageResourceId,
  opaqueTexels,
  uvmImageFilters,
  prepareUvmTextureImages,
  uvmImageTexels
};
