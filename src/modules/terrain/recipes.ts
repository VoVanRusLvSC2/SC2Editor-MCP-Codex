import type {
  Point2,
  TerrainArea,
  TerrainOperation,
  TerrainStyle,
} from "./types.js";
export const TERRAIN_STYLES: Record<
  TerrainStyle,
  { terms: string[]; relief: number; wavelength: number; description: string }
> = {
  forest: {
    terms: ["grass", "dirt", "rock"],
    relief: 0.7,
    wavelength: 12,
    description: "Gentle hills, soil, grass and rocky slopes",
  },
  desert: {
    terms: ["sand", "desert", "dirt"],
    relief: 1,
    wavelength: 18,
    description: "Broad dunes and dry ground",
  },
  city: {
    terms: ["concrete", "city", "tile"],
    relief: 0,
    wavelength: 8,
    description: "Level ground and paved surfaces",
  },
  snow: {
    terms: ["snow", "ice", "rock"],
    relief: 0.7,
    wavelength: 14,
    description: "Snow fields and rocky hills",
  },
  jungle: {
    terms: ["grass", "dirt", "mud"],
    relief: 0.9,
    wavelength: 10,
    description: "Uneven ground for dense vegetation",
  },
  swamp: {
    terms: ["mud", "dirt", "grass"],
    relief: 0.25,
    wavelength: 8,
    description:
      "Shallow depressions; native water-body writer is unavailable",
  },
  volcanic: {
    terms: ["lava", "ash", "rock"],
    relief: 1.2,
    wavelength: 10,
    description:
      "Rough volcanic ground; lava appearance requires matching native assets",
  },
  badlands: {
    terms: ["dirt", "rock", "sand"],
    relief: 1.1,
    wavelength: 16,
    description: "Dry uneven terrain",
  },
  coastal: {
    terms: ["sand", "dirt", "rock"],
    relief: 0.4,
    wavelength: 18,
    description:
      "Gentle coastal ground; native water-body writer is unavailable",
  },
  space_platform: {
    terms: ["platform", "metal", "tile"],
    relief: 0,
    wavelength: 8,
    description:
      "Level platform surfaces; native holes and boundaries are preserved",
  },
};
export interface GenerateArgs {
  directory?: string;
  area: TerrainArea;
  style: TerrainStyle;
  seed?: number;
  relief?: number;
  wavelength?: number;
  edgeBlend?: number;
  materials?: { base?: string; rock?: string };
  protectedAreas?: TerrainArea[];
}
export function generateRecipe(
  args: GenerateArgs,
  baseTexture?: string,
): TerrainOperation[] {
  const style = TERRAIN_STYLES[args.style],
    common = {
      area: args.area,
      edgeBlend: args.edgeBlend ?? 3,
      protectedAreas: args.protectedAreas,
    };
  const operations: TerrainOperation[] = [];
  operations.push({ op: "height.flatten", height: "currentMedian", ...common });
  if ((args.relief ?? style.relief) > 0)
    operations.push(
      {
        op: "height.noise",
        amplitude: args.relief ?? style.relief,
        wavelength: args.wavelength ?? style.wavelength,
        seed: args.seed ?? 1,
        ...common,
      },
      {
        op: "height.smooth",
        radius: 2,
        method: "edge_preserving",
        strength: 0.35,
        ...common,
      },
    );
  if (baseTexture)
    operations.push({ op: "texture.paint", texture: baseTexture, ...common });
  if (args.materials?.rock)
    operations.push({
      op: "texture.paint_rules",
      rules: [{ texture: args.materials.rock, minSlope: 0.25 }],
      ...common,
    });
  return operations;
}
export type FeatureArgs = {
  directory?: string;
  area?: TerrainArea;
  center?: Point2;
  radius?: number;
  points?: Point2[];
  width?: number;
  height?: number;
  depth?: number;
  texture?: string;
  edgeBlend?: number;
  sourceWaterIndex?: number;
  seed?: number;
};
export function featureRecipe(
  feature: string,
  args: FeatureArgs,
): TerrainOperation[] {
  const edgeBlend = args.edgeBlend ?? 2;
  let area = args.area;
  if (!area && args.points)
    area = { type: "corridor", points: args.points, width: args.width ?? 4 };
  if (!area && args.center)
    area = { type: "circle", center: args.center, radius: args.radius ?? 8 };
  if (!area) throw new Error("FEATURE_AREA_REQUIRED");
  const operations: TerrainOperation[] = [];
  if (feature === "road" || feature === "plateau")
    operations.push({
      op: "height.flatten",
      area,
      height: args.height ?? "currentMedian",
      edgeBlend,
    });
  else if (feature === "mountain")
    operations.push({
      op: "height.raise",
      area,
      amount: args.height ?? 1,
      edgeBlend: args.edgeBlend ?? args.radius ?? 8,
    });
  else if (
    feature === "river" ||
    feature === "lake" ||
    feature === "valley" ||
    feature === "crater"
  )
    operations.push({
      op: "height.lower",
      area,
      amount: args.depth ?? 0.7,
      edgeBlend,
    });
  else if (feature === "coast")
    operations.push({
      op: "height.flatten",
      area,
      height: args.height ?? "currentMedian",
      edgeBlend,
    });
  else if (feature === "transition") {
    if (!args.texture) throw new Error("TRANSITION_TEXTURE_REQUIRED");
  } else throw new Error(`UNKNOWN_TERRAIN_FEATURE: ${feature}`);
  if (feature === "crater" && area.type === "circle")
    operations.push({
      op: "height.raise",
      area: { ...area, radius: area.radius * 1.2 },
      amount: (args.depth ?? 0.7) * 0.3,
      edgeBlend: Math.max(0.5, area.radius * 0.2),
      protectedAreas: [{ ...area, radius: area.radius * 0.75 }],
    });
  if (args.texture)
    operations.push({
      op: "texture.paint",
      area,
      texture: args.texture,
      edgeBlend,
    });
  if (args.sourceWaterIndex !== undefined) {
    if(area.type !== "rectangle") throw new Error("WATER_FEATURE_REQUIRES_RECTANGLE");
    operations.push({op:"water.create",sourceIndex:args.sourceWaterIndex,area});
  }
  return operations;
}
