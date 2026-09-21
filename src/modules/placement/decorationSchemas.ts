import * as z from "zod/v4";
const finite = z.number().finite();
const point = z.object({ x: finite, y: finite, z: finite }).strict();
const rectangle = { minX: finite, minY: finite, maxX: finite, maxY: finite };
const positiveRectangle = (v: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}) => v.maxX > v.minX && v.maxY > v.minY;
const area = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("rectangle"),
      ...rectangle,
      z: finite.default(0),
    })
    .strict()
    .refine(positiveRectangle, "Positive rectangle required"),
  z
    .object({
      type: z.literal("circle"),
      center: point,
      radius: finite.positive(),
    })
    .strict(),
]);
const exclusion = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("rectangle"), ...rectangle })
    .strict()
    .refine(positiveRectangle),
  z
    .object({
      type: z.literal("circle"),
      center: z.object({ x: finite, y: finite }).strict(),
      radius: finite.positive(),
    })
    .strict(),
]);
const files = {
  objectFile: z.string().default("Objects"),
  componentListFile: z.string().default("ComponentList.SC2Components"),
  terrainDirectory: z.string().default(""),
};
const range = z
  .object({ min: finite, max: finite })
  .strict()
  .refine((v) => v.max >= v.min, "Range max must be at least min");
export const scatterDoodadsSchema = z
  .object({
    ...files,
    area,
    objects: z
      .array(
        z
          .object({
            id: z.string().min(1).optional(),
            key: z.string().min(1).optional(),
            query: z.string().min(1).optional(),
            weight: finite.positive().max(1e6).default(1),
          })
          .strict()
          .refine(
            (o) => [o.id, o.key, o.query].filter(Boolean).length === 1,
            "Provide one id/key/query",
          ),
      )
      .min(1)
      .max(32),
    count: z.number().int().min(1).max(5000),
    seed: z.number().int().default(1),
    minimumDistance: finite.nonnegative().default(1),
    avoidExisting: z.boolean().default(true),
    avoidWater: z.boolean().default(true),
    avoidProtected: z.boolean().default(true),
    minHeight: finite.optional(),
    maxHeight: finite.optional(),
    minSlope: finite.nonnegative().optional(),
    maxSlope: finite.nonnegative().default(0.5),
    textures: z
      .array(
        z
          .object({
            id: z.string().min(1),
            minWeight: z.number().int().min(1).max(15).default(1),
          })
          .strict(),
      )
      .min(1)
      .max(64)
      .optional(),
    heightOffset: finite.min(-128).max(128).default(0),
    scaleRange: range
      .refine((v) => v.min > 0, "Scale must be positive")
      .default({ min: 0.9, max: 1.1 }),
    rotationRange: range.default({ min: 0, max: Math.PI * 2 }),
    exclusionZones: z.array(exclusion).max(100).default([]),
    maxAttempts: z.number().int().min(1).max(1250000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.minHeight === undefined ||
      v.maxHeight === undefined ||
      v.minHeight <= v.maxHeight,
    "Height range invalid",
  )
  .refine(
    (v) => v.minSlope === undefined || v.minSlope <= v.maxSlope,
    "Slope range invalid",
  );
export type ScatterDoodadsArgs = z.input<typeof scatterDoodadsSchema>;
export const snapObjectsSchema = z
  .object({
    ...files,
    objectIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(5000)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Duplicate object IDs",
      ),
    maxSlope: finite.nonnegative().default(0.5),
    avoidWater: z.boolean().default(true),
    heightOffset: finite.min(-128).max(128).default(0),
  })
  .strict();
export type SnapObjectsArgs = z.input<typeof snapObjectsSchema>;
