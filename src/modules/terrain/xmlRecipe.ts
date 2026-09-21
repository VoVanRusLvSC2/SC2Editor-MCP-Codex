import { scanXml } from "../../core/xmlScanner.js";
import type { XmlNode } from "../../core/types.js";
import type { TerrainArea, TerrainOperation } from "./types.js";
import { generateRecipe, featureRecipe } from "./recipes.js";
import {
  terrainPlanSchema,
  terrainStyleSchema,
  terrainAreaSchema,
} from "./schemas.js";
function attributes(node: XmlNode, allowed: string[]) {
  for (const name of Object.keys(node.attrs))
    if (!allowed.includes(name))
      throw new Error(`UNKNOWN_RECIPE_ATTRIBUTE: ${node.tag}.${name}`);
}
function vector(value: string | undefined): number[] {
  if (!value) throw new Error("RECIPE_VECTOR_REQUIRED");
  const n = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (n.some((v) => !Number.isFinite(v)))
    throw new Error("RECIPE_VECTOR_INVALID");
  return n;
}
function point(value: string | undefined) {
  const v = vector(value);
  if (v.length !== 2) throw new Error("RECIPE_POINT_INVALID");
  return { x: v[0], y: v[1] };
}
function numeric(
  value: string | undefined,
  fallback?: number,
): number | undefined {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n))
    throw new Error("RECIPE_NUMBER_INVALID");
  return n;
}
function makeArea(n: XmlNode): TerrainArea {
  const a = n.attrs;
  if (a.shape === "rectangle") {
    const min = point(a.min),
      max = point(a.max);
    return terrainAreaSchema.parse({
      type: "rectangle",
      minX: min.x,
      minY: min.y,
      maxX: max.x,
      maxY: max.y,
    });
  }
  if (a.shape === "circle")
    return terrainAreaSchema.parse({
      type: "circle",
      center: point(a.center),
      radius: numeric(a.radius),
    });
  if (a.shape === "polygon" || a.shape === "corridor")
    return terrainAreaSchema.parse({
      type: a.shape,
      points: a.points?.split(";").map(point),
      ...(a.shape === "corridor" ? { width: numeric(a.width) } : {}),
    });
  throw new Error(`RECIPE_AREA_SHAPE_UNSUPPORTED: ${a.shape}`);
}
/** Strict user-facing DSL: every unknown operation/attribute is rejected, not silently discarded. */
export function parseTerrainRecipe(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("RECIPE_DTD_UNSUPPORTED");
  const parsed = scanXml(xml);
  if (
    parsed.diagnostics.some((d) => d.severity === "error") ||
    parsed.rootIds.length !== 1
  )
    throw new Error("MALFORMED_TERRAIN_RECIPE");
  const root = parsed.nodes[parsed.rootIds[0]];
  if (root.tag !== "TerrainRecipe" || root.attrs.version !== "1")
    throw new Error("RECIPE_VERSION_UNSUPPORTED");
  attributes(root, ["version", "seed", "directory"]);
  const areas = new Map<string, TerrainArea>();
  const operations: TerrainOperation[] = [];
  const children = parsed.nodes.filter((n) => n.parentId === root.id);
  if (parsed.nodes.some((n) => n.id !== root.id && n.parentId !== root.id))
    throw new Error("NESTED_RECIPE_NODES_UNSUPPORTED");
  for (const n of children)
    if (n.tag === "Area") {
      attributes(n, [
        "id",
        "shape",
        "min",
        "max",
        "center",
        "radius",
        "points",
        "width",
      ]);
      if (!n.attrs.id || areas.has(n.attrs.id))
        throw new Error("RECIPE_AREA_ID_INVALID");
      areas.set(n.attrs.id, makeArea(n));
    }
  for (const n of children) {
    if (n.tag === "Area") continue;
    const a = n.attrs;
    if (n.tag === "Road") {
      attributes(n, [
        "area",
        "points",
        "width",
        "height",
        "texture",
        "edgeBlend",
      ]);
      if (a.area && !areas.has(a.area))
        throw new Error("RECIPE_AREA_REQUIRED: Road");
      operations.push(
        ...featureRecipe("road", {
          area: a.area ? areas.get(a.area) : undefined,
          points: a.points?.split(";").map(point),
          width: numeric(a.width),
          height: numeric(a.height),
          texture: a.texture,
          edgeBlend: numeric(a.edgeBlend),
        }),
      );
      continue;
    }
    if(n.tag === "Lighting") {attributes(n,["id"]);operations.push({op:"lighting.assign",id:a.id});continue;}
    if(n.tag === "LightingPreset") {attributes(n,["id","parent","stateIndex","ambientColor","exposure","whitePoint","timePerDay","timePerLoop","timeStart"]);operations.push({op:"lighting.preset",id:a.id,parent:a.parent,timePerDay:a.timePerDay,timePerLoop:a.timePerLoop,timeStart:a.timeStart,stateIndex:numeric(a.stateIndex),ambientColor:a.ambientColor ? vector(a.ambientColor) as [number,number,number] : undefined,exposure:numeric(a.exposure),whitePoint:numeric(a.whitePoint)});continue;}
    if(n.tag === "WaterMaterial") {
      attributes(n,["id","parent","stateIndex","height","color","uvRate","refractionDistortion","reflectionDistortion","framesPerSec","isLava"]);
      if(a.isLava !== undefined && !["true","false"].includes(a.isLava)) throw new Error("RECIPE_BOOLEAN_INVALID");
      operations.push({op:"water.material",id:a.id,parent:a.parent,stateIndex:numeric(a.stateIndex),height:numeric(a.height),
        color:a.color ? vector(a.color) as [number,number,number,number] : undefined,uvRate:a.uvRate ? vector(a.uvRate) as [number,number,number,number] : undefined,
        refractionDistortion:numeric(a.refractionDistortion),reflectionDistortion:numeric(a.reflectionDistortion),framesPerSec:numeric(a.framesPerSec),isLava:a.isLava === undefined ? undefined : a.isLava === "true"});
      continue;
    }
    if(n.tag === "RemoveWater") { attributes(n,["index"]);operations.push({op:"water.remove",index:numeric(a.index)!});continue; }
    const area = a.area ? areas.get(a.area) : a.shape ? makeArea(n) : undefined;
    if (!area) throw new Error(`RECIPE_AREA_REQUIRED: ${n.tag}`);
    const common = {
      area,
      edgeBlend: numeric(a.edgeBlend),
      strength: numeric(a.strength),
    };
    if(n.tag === "Water" || n.tag === "UpdateWater") {
      attributes(n,["area","sourceIndex","index","template"]);
      if(area.type !== "rectangle") throw new Error("WATER_FEATURE_REQUIRES_RECTANGLE");
      operations.push(n.tag === "Water" ? {op:"water.create",area,sourceIndex:numeric(a.sourceIndex),template:a.template} : {op:"water.update",area,index:numeric(a.index)!,template:a.template});
    } else     if (n.tag === "Generate") {
      attributes(n, [
        "area",
        "style",
        "relief",
        "wavelength",
        "seed",
        "edgeBlend",
        "baseTexture",
        "rockTexture",
      ]);
      if (!a.baseTexture) throw new Error("XML_GENERATE_BASE_TEXTURE_REQUIRED");
      operations.push(
        ...generateRecipe(
          {
            area,
            style: terrainStyleSchema.parse(a.style),
            relief: numeric(a.relief),
            wavelength: numeric(a.wavelength),
            seed: numeric(a.seed, numeric(root.attrs.seed, 1)),
            edgeBlend: numeric(a.edgeBlend),
            materials: { base: a.baseTexture, rock: a.rockTexture },
          },
          a.baseTexture,
        ),
      );
    } else if (
      [
        "Raise",
        "Lower",
        "Flatten",
        "SetHeight",
        "Noise",
        "Smooth",
        "Paint",
        "Blend",
      ].includes(n.tag)
    ) {
      attributes(n, [
        "area",
        "shape",
        "min",
        "max",
        "center",
        "radius",
        "points",
        "width",
        "edgeBlend",
        "strength",
        ...(n.tag === "Raise" || n.tag === "Lower"
          ? ["amount"]
          : n.tag === "Flatten" || n.tag === "SetHeight"
            ? ["height"]
            : n.tag === "Noise"
              ? ["amplitude", "wavelength", "seed"]
              : n.tag === "Smooth"
                ? [
                    "method",
                    "iterations",
                    "smoothRadius",
                    "edgeThreshold",
                    "preserveCliffs",
                    "preserveRamps",
                  ]
                : ["texture"]),
      ]);
      if (n.tag === "Raise" || n.tag === "Lower")
        operations.push({
          op: n.tag === "Raise" ? "height.raise" : "height.lower",
          amount: numeric(a.amount)!,
          ...common,
        });
      else if (n.tag === "Flatten" || n.tag === "SetHeight")
        operations.push({
          op: n.tag === "Flatten" ? "height.flatten" : "height.set",
          height:
            a.height === "currentMedian" ? "currentMedian" : numeric(a.height)!,
          ...common,
        });
      else if (n.tag === "Noise")
        operations.push({
          op: "height.noise",
          amplitude: numeric(a.amplitude)!,
          wavelength: numeric(a.wavelength),
          seed: numeric(a.seed, numeric(root.attrs.seed, 1)),
          ...common,
        });
      else if (n.tag === "Smooth") {
        if (
          (a.preserveCliffs && a.preserveCliffs !== "true") ||
          (a.preserveRamps && a.preserveRamps !== "true")
        )
          throw new Error("NATIVE_GEOMETRY_PROTECTION_CANNOT_BE_DISABLED");
        operations.push({
          op: "height.smooth",
          radius: numeric(a.smoothRadius),
          edgeThreshold: numeric(a.edgeThreshold),
          iterations: numeric(a.iterations),
          method: a.method as "gaussian" | "edge_preserving" | undefined,
          ...common,
        });
      } else
        operations.push({
          op: n.tag === "Paint" ? "texture.paint" : "texture.blend",
          texture: a.texture,
          ...common,
        });
    } else throw new Error(`UNKNOWN_TERRAIN_RECIPE_OPERATION: ${n.tag}`);
  }
  return terrainPlanSchema.parse({
    directory: root.attrs.directory ?? "",
    operations,
  });
}
