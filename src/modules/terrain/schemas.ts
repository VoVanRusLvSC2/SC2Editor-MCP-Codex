import * as z from "zod/v4";
const number = z.number().finite();
export const terrainPointSchema = z.object({ x: number, y: number }).strict();
export const terrainRectangleSchema = z
  .object({
    type: z.literal("rectangle"),
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  })
  .strict()
  .refine(
    (a) => a.maxX > a.minX && a.maxY > a.minY,
    "Rectangle must have positive dimensions",
  );
export const terrainAreaSchema = z.discriminatedUnion("type", [
  terrainRectangleSchema,
  z
    .object({
      type: z.literal("circle"),
      center: terrainPointSchema,
      radius: number.positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("polygon"),
      points: z.array(terrainPointSchema).min(3).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("corridor"),
      points: z.array(terrainPointSchema).min(2).max(100),
      width: number.positive(),
    })
    .strict(),
]);
const patternSeed=z.number().int().min(-2147483648).max(2147483647);
export const terrainTexturePatternSchema=z.object({
  seed:patternSeed.default(1),
  wavelength:number.min(.25).max(512).default(8),
  threshold:number.min(-.99).max(.99).default(0),
  transition:number.positive().max(2).default(.35),
}).strict();
export const terrainMaterialPatchSchema=z.object({
  texture:z.string().min(1),
  ...terrainTexturePatternSchema.shape,
  seed:patternSeed.optional(),
  strength:number.min(0).max(1).default(.65),
  minHeight:number.optional(),maxHeight:number.optional(),
  minSlope:number.nonnegative().optional(),maxSlope:number.nonnegative().optional(),
}).strict().refine(p=>p.minHeight===undefined||p.maxHeight===undefined||p.minHeight<=p.maxHeight,'Material patch height range is reversed')
  .refine(p=>p.minSlope===undefined||p.maxSlope===undefined||p.minSlope<=p.maxSlope,'Material patch slope range is reversed');
export const terrainTextureBrushSchema = z.object({
  directory: z.string().default(""), area: terrainAreaSchema, texture: z.string().min(1),
  strength: number.min(0).max(1).optional(), edgeBlend: number.nonnegative().optional(),
  pattern:terrainTexturePatternSchema.optional(),
  protectedAreas: z.array(terrainAreaSchema).max(50).optional(),
}).strict();
export const terrainVisibilityTarget = {
  area: terrainAreaSchema.optional(),
  cells: z.array(z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).strict())
    .min(1).max(4096).refine(cells => new Set(cells.map(cell => `${cell.x}:${cell.y}`)).size === cells.length, "Duplicate cells").optional(),
};
export const visibilityTargetValid = (value: { area?: unknown; cells?: unknown }) => (value.area !== undefined) !== (value.cells !== undefined);
export const terrainVisibilitySchema = z.object({ directory: z.string().default(""), ...terrainVisibilityTarget }).strict()
  .refine(visibilityTargetValid, "Specify exactly one area or cells");
const brush = {
  area: terrainAreaSchema,
  strength: number.min(0).max(1).optional(),
  edgeBlend: number.nonnegative().optional(),
  protectedAreas: z.array(terrainAreaSchema).max(50).optional(),
};
export const terrainOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.enum(["surface.hide", "surface.show"]), ...terrainVisibilityTarget }).strict()
    .refine(visibilityTargetValid, "Specify exactly one area or cells"),
  z
    .object({
      op: z.enum(["height.raise", "height.lower"]),
      ...brush,
      amount: number.nonnegative().max(128),
    })
    .strict(),
  z
    .object({
      op: z.enum(["height.set", "height.flatten"]),
      ...brush,
      height: z.union([number, z.literal("currentMedian")]),
    })
    .strict(),
  z
    .object({
      op: z.literal("height.smooth"),
      ...brush,
      radius: z.number().int().min(1).max(8).optional(),
      iterations: z.number().int().min(1).max(10).optional(),
      method: z.enum(["gaussian", "edge_preserving"]).optional(),
      edgeThreshold: number.positive().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("height.noise"),
      ...brush,
      amplitude: number.nonnegative().max(128),
      wavelength: number.positive().optional(),
      seed: z.number().int().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("height.slope"),
      ...brush,
      from: terrainPointSchema,
      to: terrainPointSchema,
      fromHeight: number,
      toHeight: number,
    })
    .strict(),
  z
    .object({
      op: z.enum(["texture.paint", "texture.blend"]),
      ...brush,
      texture: z.string().min(1),
      pattern:terrainTexturePatternSchema.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("texture.replace"),
      ...brush,
      fromTexture: z.string().min(1),
      texture: z.string().min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("texture.smooth"),
      ...brush,
      radius: z.number().int().min(1).max(4).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("texture.paint_rules"),
      ...brush,
      pattern:terrainTexturePatternSchema.optional(),
      rules: z
        .array(
          z
            .object({
              texture: z.string().min(1),
              minHeight: number.optional(),
              maxHeight: number.optional(),
              minSlope: number.nonnegative().optional(),
              maxSlope: number.nonnegative().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(30),
    })
    .strict(),
  z
    .object({
      op: z.literal("palette.update"),
      replacements: z
        .array(
          z
            .object({
              slot: z.number().int().min(0).max(63),
              texture: z
                .string()
                .min(1)
                .refine((t) => !t.includes("\0"), "Invalid texture id"),
            })
            .strict(),
        )
        .min(1)
        .max(64)
        .refine(
          (r) => new Set(r.map((v) => v.slot)).size === r.length,
          "Duplicate palette slots",
        ),
    })
    .strict(),
  z.object({op:z.literal("lighting.assign"),id:z.string().min(1).max(255)}).strict(),
  z.object({op:z.literal("lighting.preset"),timePerDay:z.string().regex(/^\d{1,3}:[0-5]\d:[0-5]\d$/).optional(),timePerLoop:z.string().regex(/^\d+(?::[0-5]\d:[0-5]\d)?$/).optional(),timeStart:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/).optional(),timeEvents:z.array(z.object({index:z.enum(["Dawn","Dusk"]),time:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/),name:z.string().min(1).optional()}).strict()).max(2).refine(v=>new Set(v.map(e=>e.index)).size===v.length,"Duplicate time event").optional(),id:z.string().min(1).max(255),parent:z.string().min(1).max(255).optional(),stateIndex:z.number().int().min(0).max(63).optional(),ambientColor:z.tuple([number.min(0).max(1),number.min(0).max(1),number.min(0).max(1)]).optional(),exposure:number.min(0).max(100).optional(),whitePoint:number.positive().max(100).optional(),directional:z.array(z.object({index:z.enum(["Key","Fill","Back"]),color:z.tuple([number.min(0).max(1),number.min(0).max(1),number.min(0).max(1)]).optional(),direction:z.tuple([number.min(-1).max(1),number.min(-1).max(1),number.min(-1).max(1)]).refine(v=>v.some(n=>n!==0),"Direction must be nonzero").optional(),intensity:number.min(0).max(100).optional()}).strict()).max(3).refine(v=>new Set(v.map(x=>x.index)).size===v.length,"Duplicate directional index").optional()}).strict(),
  z.object({
    op:z.literal("water.material"), id:z.string().min(1), parent:z.string().min(1).optional(), stateIndex:z.number().int().min(0).max(63).optional(),
    height:number.min(-256).max(256).optional(), color:z.tuple([number.min(0).max(1),number.min(0).max(1),number.min(0).max(1),number.min(0).max(1)]).optional(),
    uvRate:z.tuple([number,number,number,number]).optional(), refractionDistortion:number.min(0).max(10).optional(), reflectionDistortion:number.min(0).max(10).optional(),
    framesPerSec:number.min(0).max(1000).optional(), isLava:z.boolean().optional(),
  }).strict(),
  z
    .object({
      op: z.literal("water.create"),
      area: terrainRectangleSchema,
      sourceIndex: z.number().int().nonnegative().optional(),
      template: z.string().min(1).optional(),
    })
    .strict().refine(o => (o.template !== undefined) !== (o.sourceIndex !== undefined), "Specify exactly one template or sourceIndex"),
  z
    .object({
      op: z.literal("water.update"),
      template: z.string().min(1).optional(),
      area: terrainRectangleSchema,
      index: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      op: z.literal("water.remove"),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ op: z.literal("stamp.apply"), donorDirectory: z.string().min(1) })
    .strict(),
  z.object({op:z.literal('load.repair')}).strict(),
  z
    .object({
      op: z.enum([
        "cliff.paint",
        "cliff.repair",
        "ramp.create",
        "ramp.remove",
        "ramp.repair",
        "pathing.paint",
      ]),
      area: terrainAreaSchema.optional(),
      parameters: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);
export const terrainPlanSchema = z
  .object({
    directory: z.string().default(""),
    operations: z.array(terrainOperationSchema).max(100),
    maxSlope: number.nonnegative().optional(),
  })
  .strict();
export const terrainStyleSchema = z.enum([
  "forest",
  "desert",
  "city",
  "snow",
  "jungle",
  "swamp",
  "volcanic",
  "badlands",
  "coastal",
  "space_platform",
]);
export const terrainGenerateOptions = {
  directory: z.string().default(""),
  style: terrainStyleSchema,
  heightMode: z.enum(['generate','preserve']).default('generate'),
  baseHeight: number.optional(),
  textureMode: z.enum(['generate','preserve']).default('generate'),
  seed: z.number().int().default(1),
  relief: number.nonnegative().max(128).optional(),
  wavelength: number.positive().optional(),
  edgeBlend: number.nonnegative().optional(),
  materials: z
    .object({
      base: z.string().min(1).optional(),
      rock: z.string().min(1).optional(),
      patches:z.array(terrainMaterialPatchSchema).min(1).max(6).optional(),
    })
    .strict()
    .optional(),
  protectedAreas: z.array(terrainAreaSchema).max(50).optional(),
};
export const terrainGenerateSchema = z
  .object({ ...terrainGenerateOptions, area: terrainAreaSchema })
  .strict();
export const nativeTopologyIntentSchema=z.object({
 cliffs:z.array(z.object({area:terrainRectangleSchema,level:z.number().int().min(1).max(3),cliffSet:z.number().int().min(0).max(63).default(0),variation:z.number().int().min(0).max(3).default(0)}).strict()).max(16).default([]),
 ramps:z.array(z.object({id:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),center:terrainPointSchema,direction:z.enum(['west','south','east','north']),lowerLevel:z.number().int().min(1).max(2).default(1),cliffSet:z.number().int().min(0).max(63).default(0),width:z.literal(4).default(4)}).strict()).max(16).default([]),
}).strict().refine(v=>new Set(v.ramps.map(r=>r.id)).size===v.ramps.length,'Duplicate native ramp id');
export const terrainLocationSchema=z.object({...terrainGenerateOptions,topology:nativeTopologyIntentSchema.optional(),routes:z.array(z.object({points:z.array(terrainPointSchema).min(2).max(100),width:number.positive(),texture:z.string().min(1).optional(),flatten:z.boolean().default(false),height:number.optional(),edgeBlend:number.nonnegative().optional()}).strict()).max(16).default([])}).strict();
export const terrainLandscapeSchema = terrainGenerateSchema.extend({area:terrainAreaSchema.optional(),lighting:z.string().min(1).max(255).optional()}).strict();
export const terrainFeatureSchema = z
  .object({
    directory: z.string().default(""),
    area: terrainAreaSchema.optional(),
    center: terrainPointSchema.optional(),
    radius: number.positive().optional(),
    points: z.array(terrainPointSchema).min(2).max(100).optional(),
    width: number.positive().optional(),
    height: number.optional(),
    depth: number.nonnegative().optional(),
    texture: z.string().optional(),
    edgeBlend: number.nonnegative().optional(),
    sourceWaterIndex: z.number().int().nonnegative().optional(),
  })
  .strict();
export const terrainApplySchema = z
  .object({
    planId: z.string().min(1),
    dryRun: z.boolean().default(true),
    stage: z.boolean().default(true),
    backup: z.boolean().default(true),
  })
  .strict();
