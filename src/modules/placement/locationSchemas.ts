import * as z from "zod/v4";
import {terrainLocationSchema} from "../terrain/schemas.js";

export const position = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});
export const bounds = z.object({
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
  minZ: z.number().optional(),
  maxZ: z.number().optional(),
});
export const area = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("polygon"),
    points: z.array(z.object({x:z.number().finite(),y:z.number().finite()}).strict()).min(3).max(100),
    z: z.number().finite(),
  }),
  z.object({
    type: z.literal("circle"),
    center: position,
    radius: z.number().positive(),
  }),
  z.object({
    type: z.literal("rectangle"),
    minX: z.number(),
    minY: z.number(),
    maxX: z.number(),
    maxY: z.number(),
    z: z.number(),
  }),
]);
export const exclusion = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("circle"),
    center: z.object({ x: z.number(), y: z.number() }),
    radius: z.number().positive(),
  }),
  z.object({
    type: z.literal("rectangle"),
    minX: z.number(),
    minY: z.number(),
    maxX: z.number(),
    maxY: z.number(),
  }),
]);
export const commonFiles = {
  outsidePlayableReason:z.string().trim().min(1).max(160).optional(),
  objectFile: z.string().default("Objects"),
  componentListFile: z.string().default("ComponentList.SC2Components"),
};
export const location = {
  candidateIds: z.array(z.string().min(1)).min(1).max(100).optional(),
  queries: z.array(z.string()).max(30).optional(),
  area,
  objectCount: z.number().int().min(1).max(5000).optional(),
  objectBudget: z.number().int().min(1).max(5000).optional(),
  density: z.number().positive().optional(),
  seed: z.number().int().default(1),
  minimumDistance: z.number().nonnegative().default(0),
  scaleRange: z
    .object({ min: z.number().positive(), max: z.number().positive() })
    .optional(),
  rotationRange: z.object({ min: z.number(), max: z.number() }).optional(),
  exclusionZones: z.array(exclusion).max(100).optional(),
  candidateOverrides: z.array(z.string()).max(100).optional(),
  excludedObjects: z.array(z.string()).max(500).optional(),
  dependency: z.string().optional(),
  ...commonFiles,
  bounds: bounds.optional(),
  landmarkCount: z.number().int().min(0).max(100).optional(),
  includeUnits: z.boolean().default(false),
  terrain: terrainLocationSchema.optional(),
  maxSlope: z.number().finite().nonnegative().optional(),
};

export const createLocationSchema = z.object({
  locationType: z.enum([
    "forest",
    "desert",
    "city",
    "village",
    "industrial",
    "militaryBase",
    "ruins",
    "swamp",
    "cave",
    "alien",
    "terran",
    "protoss",
    "zerg",
    "mixedNature",
    "custom",
  ]),
  ...location,
});

