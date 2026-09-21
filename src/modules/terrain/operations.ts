import type { TerrainArea, TerrainIssue, TerrainOperation } from "./types.js";
import { componentListWithGameData, gameDataIndexWithCatalog } from "../data/workspace.js";
import { LightingCatalog } from "./lighting.js";
import { WaterCatalog } from "./waterCatalog.js";
import { areaBounds, areaWeight, valueNoise } from "./geometry.js";
import {
  HeightMap,
  SyncHeightMap,
  SyncTextureInfo,
  TerrainDescriptor,
  TextureMasks,
  WaterEntries,
} from "./document.js";

export const TERRAIN_COMPONENTS = [
  "t3Terrain.xml",
  "t3HeightMap",
  "t3TextureMasks",
  "t3SyncHeightMap",
  "t3SyncCliffLevel",
  "t3SyncTextureInfo",
  "t3CellFlags",
  "t3HardTile",
  "t3Water",
  "Base.SC2Data/GameData/WaterData.xml",
  "Base.SC2Data/GameData/LightData.xml",
  "Base.SC2Data/GameData/TerrainData.xml",
  "Base.SC2Data/GameData.xml",
  "ComponentList.SC2Components",
  "t3VertCol",
  "t3FluffDoodad",
  "PaintedPathingLayer",
  "t3SyncPathingInfo",
  "Terrain",
] as const;
export interface TerrainState {
  sources: Map<string, Buffer>;
  descriptor: TerrainDescriptor;
  heights: HeightMap;
  masks?: TextureMasks;
  sync?: SyncHeightMap;
  syncTextures?: SyncTextureInfo;
  water?: WaterEntries;
  waterCatalog?: WaterCatalog;
}
export function parseState(sources: Map<string, Buffer>): TerrainState {
  const xml = sources.get("t3Terrain.xml"),
    hmap = sources.get("t3HeightMap");
  if (!xml?.length || !hmap?.length)
    throw new Error(
      "MISSING_TERRAIN_COMPONENTS: extract a map component directory first",
    );
  const descriptor = new TerrainDescriptor(xml.toString("utf8"));
  if (
    descriptor.vert.attrs.name !== "t3HeightMap" ||
    (sources.get("t3Terrain.xml")?.toString().includes('<masks name="') &&
      descriptor.parsed.nodes.find((n) => n.tag === "masks")?.attrs.name !==
        "t3TextureMasks")
  )
    throw new Error("CUSTOM_TERRAIN_COMPONENT_NAMES_UNSUPPORTED");
  const heights = new HeightMap(hmap, descriptor);
  const masks = sources.get("t3TextureMasks")?.length
    ? new TextureMasks(sources.get("t3TextureMasks")!)
    : undefined;
  if (
    masks &&
    (masks.width !== 8 * (heights.width - 1) ||
      masks.height !== 8 * (heights.height - 1))
  )
    throw new Error("UNSUPPORTED_TEXTURE_GRID_RATIO");
  const sync = sources.get("t3SyncHeightMap")?.length
    ? new SyncHeightMap(sources.get("t3SyncHeightMap")!, heights)
    : undefined;
  const syncTextures = sources.get("t3SyncTextureInfo")?.length
    ? new SyncTextureInfo(sources.get("t3SyncTextureInfo")!)
    : undefined;
  if (
    syncTextures &&
    (syncTextures.width !== heights.width - 1 ||
      syncTextures.height !== heights.height - 1)
  )
    throw new Error("SYNC_TEXTURE_DIMENSIONS_MISMATCH");
  const water = sources.get("t3Water")?.length
    ? new WaterEntries(sources.get("t3Water")!)
    : undefined;
  const catalog = sources.get("Base.SC2Data/GameData/WaterData.xml");
  const waterCatalog = catalog?.length ? new WaterCatalog(new TextDecoder("utf-8",{fatal:true}).decode(catalog)) : undefined;
  return { sources, descriptor, heights, masks, sync, syncTextures, water, waterCatalog };
}
function bounded(area: TerrainArea, state: TerrainState): void {
  const b = areaBounds(area),
    d = state.descriptor;
  const maxX = d.offset[0] + (d.width - 1) * d.scale[0],
    maxY = d.offset[1] + (d.height - 1) * d.scale[1];
  if (
    b.minX < d.offset[0] ||
    b.minY < d.offset[1] ||
    b.maxX > maxX ||
    b.maxY > maxY ||
    b.maxX <= b.minX ||
    b.maxY <= b.minY
  )
    throw new Error("TERRAIN_AREA_OUT_OF_BOUNDS");
}
interface GridBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
function brushBounds(
  area: TerrainArea,
  state: TerrainState,
  pixels = false,
): GridBounds {
  const b = areaBounds(area),
    d = state.descriptor,
    density = pixels ? 8 : 1,
    center = pixels ? 0.5 : 0;
  return {
    minX: Math.max(
      0,
      Math.ceil(((b.minX - d.offset[0]) / d.scale[0]) * density - center),
    ),
    minY: Math.max(
      0,
      Math.ceil(((b.minY - d.offset[1]) / d.scale[1]) * density - center),
    ),
    maxX: Math.min(
      pixels ? state.masks!.width - 1 : d.width - 1,
      Math.floor(((b.maxX - d.offset[0]) / d.scale[0]) * density - center),
    ),
    maxY: Math.min(
      pixels ? state.masks!.height - 1 : d.height - 1,
      Math.floor(((b.maxY - d.offset[1]) / d.scale[1]) * density - center),
    ),
  };
}
function unionBounds(
  previous: GridBounds | undefined,
  next: GridBounds,
): GridBounds {
  return previous
    ? {
        minX: Math.min(previous.minX, next.minX),
        minY: Math.min(previous.minY, next.minY),
        maxX: Math.max(previous.maxX, next.maxX),
        maxY: Math.max(previous.maxY, next.maxY),
      }
    : next;
}
function operationWeight(
  op: {
    area: TerrainArea;
    strength?: number;
    edgeBlend?: number;
    protectedAreas?: TerrainArea[];
  },
  p: { x: number; y: number },
): number {
  if (op.protectedAreas?.some((a) => areaWeight(a, p) > 0)) return 0;
  return areaWeight(op.area, p, op.edgeBlend ?? 0) * (op.strength ?? 1);
}
function median(values: number[]): number {
  if (!values.length) throw new Error("EMPTY_TERRAIN_AREA");
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}
export function applyOperations(
  state: TerrainState,
  operations: TerrainOperation[],
  maxSlope?: number,
) {
  const initial = Buffer.from(state.heights.bytes);
  const originalHeights = new HeightMap(initial, state.descriptor);
  const originalMasks = state.masks
    ? Buffer.from(state.masks.bytes)
    : undefined;
  const issues: TerrainIssue[] = [];
  let heightTouched = false,
    textureTouched = false;
  let protectedCount = 0;
  let heightBounds: GridBounds | undefined,
    textureBounds: GridBounds | undefined;
  const protection = new Uint8Array(state.heights.width * state.heights.height);
  const isProtected = (x: number, y: number): boolean => {
    const i = y * state.heights.width + x;
    if (!protection[i]) protection[i] = state.heights.protected(x, y) ? 2 : 1;
    return protection[i] === 2;
  };
  for (const op of operations) {
    if ("area" in op && op.area) bounded(op.area, state);
    if (op.op === "stamp.apply")
      throw new Error("STAMP_REQUIRES_WORKSPACE_RESOLUTION");
    if (
      op.op === "cliff.paint" ||
      op.op === "ramp.create" ||
      op.op === "ramp.remove" ||
      op.op === "pathing.paint"
    )
      throw new Error(
        `NATIVE_TERRAIN_OPERATION_UNAVAILABLE: ${op.op}; structural regeneration has not been proven. A whole-map donor stamp preserves existing native cliffs/ramps/pathing.`,
      );
    if (op.op === "palette.update") {
      if (!state.syncTextures)
        throw new Error("SYNC_TEXTURE_COMPONENT_REQUIRED");
      const source = state.descriptor.replaceTextures(op.replacements);
      state.sources.set("t3Terrain.xml", Buffer.from(source));
      state.sources.set(
        "t3SyncTextureInfo",
        state.syncTextures.rename(op.replacements),
      );
      state.descriptor = new TerrainDescriptor(source);
      state.heights = new HeightMap(state.heights.bytes, state.descriptor);
      state.syncTextures = new SyncTextureInfo(
        state.sources.get("t3SyncTextureInfo")!,
      );
      continue;
    }
    if (op.op === "lighting.assign" || op.op === "lighting.preset") {
      const name=op.op === "lighting.assign" ? "TerrainData.xml":"LightData.xml";
      const file=`Base.SC2Data/GameData/${name}`;
      const catalog=new LightingCatalog(new TextDecoder("utf-8",{fatal:true}).decode(state.sources.get(file)?.length ? state.sources.get(file)! : Buffer.from('<Catalog></Catalog>')),op.op === "lighting.assign" ? "CTerrain":"CLight");
      const tileSet=state.descriptor.heightMap.attrs.tileSet;
      if(op.op === "lighting.assign" && !tileSet) throw new Error("MAP_TILESET_REQUIRED");
      if(op.op === "lighting.assign" && state.sources.get("Base.SC2Data/GameData/LightData.xml")?.length)
        state.sources.set("Base.SC2Data/GameData.xml",Buffer.from(gameDataIndexWithCatalog(state.sources.get("Base.SC2Data/GameData.xml")?.toString("utf8") ?? "","GameData/LightData.xml")));
      const next=op.op === "lighting.assign" ? catalog.bind(tileSet,op.id):catalog.patch(op);
      state.sources.set(file,Buffer.from(next));
      state.sources.set("Base.SC2Data/GameData.xml",Buffer.from(gameDataIndexWithCatalog(state.sources.get("Base.SC2Data/GameData.xml")?.toString("utf8") ?? "",`GameData/${name}`)));
      state.sources.set("ComponentList.SC2Components",Buffer.from(componentListWithGameData(state.sources.get("ComponentList.SC2Components")?.toString("utf8") ?? "")));
      issues.push({severity:"warning",code:"LIGHTING_EDITOR_NOT_RUN",message:"Native catalog lighting binding edited; Editor/game visual acceptance has not been run. Preset edits affect every reference to that id."});
      continue;
    }
    if (op.op === "water.material") {
      const source = state.waterCatalog?.source ?? '<?xml version="1.0" encoding="utf-8"?>\n<Catalog></Catalog>\n';
      const next = new WaterCatalog(source).patch(op,true);
      state.waterCatalog = new WaterCatalog(next);
      state.sources.set("Base.SC2Data/GameData/WaterData.xml",Buffer.from(next));
      state.sources.set("Base.SC2Data/GameData.xml",Buffer.from(gameDataIndexWithCatalog(state.sources.get("Base.SC2Data/GameData.xml")?.toString("utf8") ?? "","GameData/WaterData.xml")));
      state.sources.set("ComponentList.SC2Components",Buffer.from(componentListWithGameData(state.sources.get("ComponentList.SC2Components")?.toString("utf8") ?? "")));
      issues.push({severity:"warning",code:"WATER_MATERIAL_SHARED",message:`CWater ${op.id} settings affect all rectangles using this template; use a new id with parent for isolated settings.`});
      continue;
    }
    if (
      op.op === "water.create" ||
      op.op === "water.update" ||
      op.op === "water.remove"
    ) {
      if (!state.water) {
        if(op.op !== "water.create" || !op.template) throw new Error("WATER_COMPONENT_REQUIRED");
        const empty = Buffer.alloc(32);empty.write("WATR");empty.writeUInt32LE(110,4);state.water = new WaterEntries(empty);
      }
      const bytes =
        op.op === "water.remove"
          ? state.water.edit("remove", op.index)
          : op.op === "water.create"
            ? state.water.edit("create", op.sourceIndex ?? 0, op.area, op.template)
            : state.water.edit("update", op.index, op.area, op.template);
      state.sources.set("t3Water", bytes);
      state.water = new WaterEntries(bytes);
      if(op.op !== "water.remove" && state.sources.get("Base.SC2Data/GameData/WaterData.xml")?.length) {
        state.sources.set("Base.SC2Data/GameData.xml",Buffer.from(gameDataIndexWithCatalog(state.sources.get("Base.SC2Data/GameData.xml")?.toString("utf8") ?? "","GameData/WaterData.xml")));
        state.sources.set("ComponentList.SC2Components",Buffer.from(componentListWithGameData(state.sources.get("ComponentList.SC2Components")?.toString("utf8") ?? "")));
      }
      issues.push({
        severity: "warning",
        code: "WATER_TEMPLATE_LEVEL",
        message:
          "Water inherits all settings and level from its existing template; custom liquid height is not decoded.",
      });
      continue;
    }
    if (op.op.startsWith("height.")) {
      const operation = op as Extract<
          TerrainOperation,
          { op: `height.${string}` }
        >,
        hm = state.heights;
      if (!state.sync) throw new Error("SYNC_HEIGHT_COMPONENT_REQUIRED");
      heightTouched = true;
      const bounds = brushBounds(operation.area, state);
      heightBounds = unionBounds(heightBounds, bounds);
      const read = Float64Array.from({ length: hm.width * hm.height }, (_, i) =>
        hm.z(i % hm.width, Math.floor(i / hm.width)),
      );
      const values: number[] = [];
      if (
        (operation.op === "height.flatten" || operation.op === "height.set") &&
        operation.height === "currentMedian"
      )
        for (let y = bounds.minY; y <= bounds.maxY; y++)
          for (let x = bounds.minX; x <= bounds.maxX; x++)
            if (
              operationWeight(operation, hm.point(x, y)) > 0 &&
              !isProtected(x, y)
            )
              values.push(read[y * hm.width + x]);
      const target =
        operation.op === "height.flatten" || operation.op === "height.set"
          ? operation.height === "currentMedian"
            ? median(values)
            : operation.height
          : undefined;
      const iterations =
        operation.op === "height.smooth" ? (operation.iterations ?? 1) : 1;
      let input = read;
      for (let iteration = 0; iteration < iterations; iteration++) {
        const output = Float64Array.from(input);
        for (let y = bounds.minY; y <= bounds.maxY; y++)
          for (let x = bounds.minX; x <= bounds.maxX; x++) {
            const p = hm.point(x, y),
              w = operationWeight(operation, p);
            if (!w) continue;
            if (isProtected(x, y)) {
              protectedCount++;
              continue;
            }
            const i = y * hm.width + x,
              old = input[i];
            let next = old;
            if (
              operation.op === "height.raise" ||
              operation.op === "height.lower"
            )
              next =
                old +
                operation.amount * (operation.op === "height.lower" ? -1 : 1);
            else if (
              operation.op === "height.set" ||
              operation.op === "height.flatten"
            )
              next = target!;
            else if (operation.op === "height.noise")
              next =
                old +
                valueNoise(
                  p.x / (operation.wavelength ?? 8),
                  p.y / (operation.wavelength ?? 8),
                  operation.seed ?? 1,
                ) *
                  operation.amplitude;
            else if (operation.op === "height.slope") {
              const dx = operation.to.x - operation.from.x,
                dy = operation.to.y - operation.from.y,
                n = dx * dx + dy * dy;
              if (!n) throw new Error("SLOPE_ENDPOINTS_COINCIDE");
              const t = Math.max(
                0,
                Math.min(
                  1,
                  ((p.x - operation.from.x) * dx +
                    (p.y - operation.from.y) * dy) /
                    n,
                ),
              );
              next =
                operation.fromHeight +
                (operation.toHeight - operation.fromHeight) * t;
            } else if (operation.op === "height.smooth") {
              const radius = operation.radius ?? 2;
              let sum = 0,
                total = 0;
              for (let dy = -radius; dy <= radius; dy++)
                for (let dx = -radius; dx <= radius; dx++) {
                  const nx = x + dx,
                    ny = y + dy;
                  if (
                    nx < 0 ||
                    ny < 0 ||
                    nx >= hm.width ||
                    ny >= hm.height ||
                    hm.mask(nx, ny) !== hm.mask(x, y) ||
                    isProtected(nx, ny)
                  )
                    continue;
                  const value = input[ny * hm.width + nx];
                  let weight = Math.exp(
                    -(dx * dx + dy * dy) / (2 * Math.max(0.5, radius / 2) ** 2),
                  );
                  if (operation.method !== "gaussian")
                    weight *= Math.exp(
                      -(
                        ((value - old) / (operation.edgeThreshold ?? 0.5)) **
                        2
                      ) / 2,
                    );
                  sum += value * weight;
                  total += weight;
                }
              next = total ? sum / total : old;
            }
            output[i] = old + (next - old) * w;
          }
        input = output;
      }
      for (let y = bounds.minY; y <= bounds.maxY; y++)
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
          const i = y * hm.width + x;
          if (input[i] !== read[i]) hm.setZ(x, y, input[i]);
        }
      continue;
    }
    if (op.op.startsWith("texture.")) {
      const operation = op as Extract<
        TerrainOperation,
        { op: `texture.${string}` }
      >;
      const masks = state.masks;
      if (!masks || !state.syncTextures)
        throw new Error("TEXTURE_COMPONENTS_REQUIRED");
      textureTouched = true;
      const bounds = brushBounds(operation.area, state, true);
      textureBounds = unionBounds(textureBounds, bounds);
      const slots = new Map(
        state.descriptor.textures
          .filter((t) => t.id)
          .map((t) => [`${Math.floor(t.slot / 8)}:${t.id}`, t.slot]),
      );
      const previous =
        operation.op === "texture.smooth"
          ? new TextureMasks(Buffer.from(masks.bytes))
          : undefined;
      for (let y = bounds.minY; y <= bounds.maxY; y++)
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
          const gx = (x + 0.5) / 8,
            gy = (y + 0.5) / 8;
          const p = {
            x: gx * state.descriptor.scale[0] + state.descriptor.offset[0],
            y: gy * state.descriptor.scale[1] + state.descriptor.offset[1],
          };
          const weight = operationWeight(operation, p);
          if (!weight) continue;
          const sample = state.heights.sample(p);
          if (sample.mask === 0) continue;
          const set = state.descriptor.blockSet(gx, gy);
          if (
            !Number.isInteger(set) ||
            set < 0 ||
            set >= state.syncTextures.setCount
          )
            throw new Error("INVALID_BLOCK_TEXTURE_SET");
          if (operation.op === "texture.smooth") {
            const radius = operation.radius ?? 2;
            const smoothed: number[] = [];
            for (let layer = 0; layer < 8; layer++) {
              let sum = 0,
                n = 0;
              for (let dy = -radius; dy <= radius; dy++)
                for (let dx = -radius; dx <= radius; dx++) {
                  const nx = x + dx,
                    ny = y + dy;
                  if (
                    nx < 0 ||
                    ny < 0 ||
                    nx >= masks.width ||
                    ny >= masks.height ||
                    state.descriptor.blockSet(
                      (nx + 0.5) / 8,
                      (ny + 0.5) / 8,
                    ) !== set
                  )
                    continue;
                  sum += previous!.get(nx, ny, layer);
                  n++;
                }
              smoothed.push(
                previous!.get(x, y, layer) * (1 - weight) + (sum / n) * weight,
              );
            }
            masks.setWeights(x, y, smoothed);
            continue;
          }
          let texture: string | undefined;
          if (operation.op === "texture.paint_rules")
            texture = operation.rules.find(
              (r) =>
                (r.minHeight === undefined || sample.height >= r.minHeight) &&
                (r.maxHeight === undefined || sample.height <= r.maxHeight) &&
                (r.minSlope === undefined || sample.slope >= r.minSlope) &&
                (r.maxSlope === undefined || sample.slope <= r.maxSlope),
            )?.texture;
          else texture = operation.texture;
          if (!texture) continue;
          const slot = slots.get(`${set}:${texture}`);
          if (slot === undefined)
            throw new Error(
              `TEXTURE_NOT_IN_ACTIVE_PALETTE: ${texture} in texture set ${set}`,
            );
          if (operation.op === "texture.replace") {
            const oldSlot = slots.get(`${set}:${operation.fromTexture}`);
            if (oldSlot === undefined) continue;
            masks.replace(x, y, oldSlot % 8, slot % 8, weight);
            continue;
          }
          masks.paint(x, y, slot % 8, weight);
        }
    }
  }
  let changedVertices = 0,
    changedTexturePixels = 0;
  if (heightTouched) {
    for (let y = heightBounds!.minY; y <= heightBounds!.maxY; y++)
      for (let x = heightBounds!.minX; x <= heightBounds!.maxX; x++) {
        const delta = state.heights.z(x, y) - originalHeights.z(x, y);
        if (Math.abs(delta) > 1e-12) {
          changedVertices++;
          state.sync!.delta(x, y, delta);
          if (
            maxSlope !== undefined &&
            x < state.heights.width - 1 &&
            y < state.heights.height - 1 &&
            !isProtected(x, y) &&
            state.heights.sample(state.heights.point(x, y)).slope > maxSlope
          )
            issues.push({
              severity: "error",
              code: "MAXIMUM_SLOPE",
              message: `Slope exceeds ${maxSlope} at ${x},${y}`,
            });
        }
      }
  }
  if (textureTouched && state.masks && state.syncTextures) {
    const masks = state.masks,
      old = new TextureMasks(originalMasks!);
    for (
      let cy = Math.floor(textureBounds!.minY / 8);
      cy <= Math.floor(textureBounds!.maxY / 8);
      cy++
    )
      for (
        let cx = Math.floor(textureBounds!.minX / 8);
        cx <= Math.floor(textureBounds!.maxX / 8);
        cx++
      ) {
        const totals = Array(8).fill(0) as number[];
        let changed = false;
        for (let dy = 0; dy < 8; dy++)
          for (let dx = 0; dx < 8; dx++) {
            const x = cx * 8 + dx,
              y = cy * 8 + dy;
            let pixelChanged = false;
            for (let l = 0; l < 8; l++) {
              const w = masks.get(x, y, l);
              totals[l] += w;
              if (w !== old.get(x, y, l)) pixelChanged = true;
            }
            if (pixelChanged) {
              changedTexturePixels++;
              changed = true;
            }
          }
        if (changed) {
          const layer = totals.indexOf(Math.max(...totals));
          state.syncTextures.set(
            cx,
            cy,
            state.descriptor.blockSet(cx + 0.5, cy + 0.5) * 8 + layer,
          );
        }
      }
  }
  if (protectedCount)
    issues.push({
      severity: "warning",
      code: "PROTECTED_NATIVE_GEOMETRY",
      message: `Skipped ${protectedCount} brush visits near holes, cliff boundaries or ramps.`,
    });
  if (heightTouched)
    issues.push({
      severity: "warning",
      code: "SYNC_DELTA_REFERENCE_SUPPORTED",
      message:
        "Sync heights retain native residuals and receive the quantized height delta. Editor save/reopen and runtime movement have not been executed.",
    });
  if (textureTouched)
    issues.push({
      severity: "warning",
      code: "SYNC_TEXTURE_DOMINANT_RULE",
      message:
        "Changed sync cells use the dominant layer averaged over 8x8 mask pixels; native Editor equivalence remains unverified.",
    });
  // The caller owns this isolated buffer map. Reparse all supported serialized output.
  parseState(state.sources);
  return { issues, changedVertices, changedTexturePixels };
}
