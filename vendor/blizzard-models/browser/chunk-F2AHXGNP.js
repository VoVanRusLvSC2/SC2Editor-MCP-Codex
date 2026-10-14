import {
  snapshotJson
} from "./chunk-TUJSTS7T.js";

// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/raster/ops.js
var at = (pixels, index) => pixels[index];
function checked(image) {
  if (image.pixels.length !== image.width * image.height * 4) {
    throw new TypeError(`image: expected ${image.width * image.height * 4} bytes, got ${image.pixels.length}`);
  }
  return image;
}
function applyColorKeyTransparency(image, options) {
  checked(image);
  const tolerance = options.tolerance ?? 0;
  const replacement = options.replacement ?? { r: 0, g: 0, b: 0, a: 0 };
  const out = image.pixels.slice();
  for (let index = 0; index < out.length; index += 4) {
    const close = Math.abs(at(out, index) - options.target.r) <= tolerance && Math.abs(at(out, index + 1) - options.target.g) <= tolerance && Math.abs(at(out, index + 2) - options.target.b) <= tolerance;
    if (close) {
      out[index] = replacement.r;
      out[index + 1] = replacement.g;
      out[index + 2] = replacement.b;
      out[index + 3] = replacement.a;
    }
  }
  return { width: image.width, height: image.height, pixels: out };
}
function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(value) {
  return value <= 31308e-7 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/model/geometry.js
function modelPrimitiveByteLength(primitive) {
  return primitive.positions.byteLength + (primitive.indices?.byteLength ?? 0) + (primitive.normals?.byteLength ?? 0) + (primitive.tangents?.byteLength ?? 0) + (primitive.colors?.byteLength ?? 0) + (primitive.boneIndices?.byteLength ?? 0) + (primitive.boneWeights?.byteLength ?? 0) + (primitive.textureCoordinates?.byteLength ?? 0) + (primitive.textureCoordinateSets?.reduce((total, channel) => total + channel.coordinates.byteLength, 0) ?? 0);
}

// ../node_modules/.pnpm/@modkit+codec-kit@file+vend_d1ae1a01d3c708a3f587cc85e630082b/node_modules/@modkit/codec-kit/dist/model/materials.js
var DEFAULT_MODEL_MATERIAL_BUDGET = Object.freeze({
  maxDepth: 64,
  maxNodes: 1e6,
  maxBytes: 134217728
});
var record = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
};
var text = (value, label, nonEmpty = false) => {
  if (typeof value !== "string" || nonEmpty && value.trim() === "")
    throw new TypeError(`${label} must be a string`);
};
var strings = (value, label) => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${label} must be a string array`);
  }
};
var optionalFields = (value, label) => {
  for (const key of ["name", "libraryId", "type", "blendMode"]) {
    if (value[key] !== void 0)
      text(value[key], `${label}.${key}`);
  }
  if (value["alphaMode"] !== void 0 && value["alphaMode"] !== "opaque" && value["alphaMode"] !== "mask" && value["alphaMode"] !== "blend") {
    throw new TypeError(`${label}.alphaMode must be opaque, mask or blend`);
  }
  if (value["alphaCutoff"] !== void 0 && (typeof value["alphaCutoff"] !== "number" || !Number.isFinite(value["alphaCutoff"]) || value["alphaCutoff"] < 0)) {
    throw new TypeError(`${label}.alphaCutoff must be finite and nonnegative`);
  }
  for (const key of ["castShadows", "receiveShadows"]) {
    if (value[key] !== void 0 && typeof value[key] !== "boolean") {
      throw new TypeError(`${label}.${key} must be a boolean`);
    }
  }
  for (const key of ["priority", "uvSource", "colorChannels", "nativeFlags"]) {
    if (value[key] !== void 0 && typeof value[key] !== "number")
      throw new TypeError(`${label}.${key} must be a number`);
  }
  for (const key of ["contracts", "flagNames"]) {
    if (value[key] !== void 0)
      strings(value[key], `${label}.${key}`);
  }
};
function snapshotModelMaterials(value, budget = DEFAULT_MODEL_MATERIAL_BUDGET, signal) {
  const snapshot = snapshotJson(value, { ...budget, sortKeys: true }, signal);
  if (!Array.isArray(snapshot))
    throw new TypeError("model materials must be an array");
  const ids = /* @__PURE__ */ new Set();
  for (const entry of snapshot) {
    const material = record(entry, "material");
    text(material["id"], "material.id", true);
    const id = material["id"];
    if (ids.has(id))
      throw new TypeError(`duplicate material id ${id}`);
    ids.add(id);
    optionalFields(material, `material ${id}`);
    if (material["layers"] !== void 0) {
      if (!Array.isArray(material["layers"]))
        throw new TypeError("material.layers must be an array");
      for (const entry2 of material["layers"]) {
        const layer = record(entry2, "material layer");
        text(layer["slot"], "material layer.slot", true);
        if (layer["resourceId"] !== void 0)
          text(layer["resourceId"], "material layer.resourceId", true);
        optionalFields(layer, "material layer");
      }
    }
    if (material["shader"] !== void 0) {
      const shader = record(material["shader"], "material.shader");
      text(shader["id"], "material.shader.id", true);
      record(shader["parameters"], "material.shader.parameters");
    }
  }
  return snapshot;
}

export {
  applyColorKeyTransparency,
  srgbToLinear,
  linearToSrgb,
  modelPrimitiveByteLength,
  DEFAULT_MODEL_MATERIAL_BUDGET,
  snapshotModelMaterials
};
