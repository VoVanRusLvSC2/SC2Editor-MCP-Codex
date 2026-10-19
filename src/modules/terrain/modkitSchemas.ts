import * as z from 'zod/v4';
import {terrainAreaSchema} from './schemas.js';
const coordinate=z.object({x:z.number().int().nonnegative(),y:z.number().int().nonnegative()}).strict();
const byte=z.number().int().min(0).max(255);
const doodad={x:z.number().finite(),y:z.number().finite(),type:z.number().int().min(0).max(7)};
const painting={layer:z.enum(['noPathing','noBuilding','clearPathing']),value:byte};
export const modkitTerrainOperation=z.discriminatedUnion('op',[
  z.object({op:z.literal('pathing.paint'),...painting,area:terrainAreaSchema}).strict(),
  z.object({op:z.literal('pathing.fill'),...painting,seed:coordinate,area:terrainAreaSchema.optional()}).strict(),
  z.object({op:z.literal('painted.set'),layer:z.enum(['PaintedPathingLayer','PaintedCreepLayer']),channel:z.enum(['primary','secondary']).default('primary'),cells:z.array(coordinate.extend({value:byte})).min(1).max(16384)}).strict(),
  z.object({op:z.literal('vertexColor.set'),values:z.array(z.object({entry:z.number().int().nonnegative(),index:z.number().int().nonnegative(),value:byte}).strict()).min(1).max(65536)}).strict(),
  z.object({op:z.literal('fluff.add'),doodads:z.array(z.object(doodad).strict()).min(1).max(20000)}).strict(),
  z.object({op:z.literal('fluff.set'),doodads:z.array(z.object({index:z.number().int().nonnegative(),...doodad}).strict()).min(1).max(20000)}).strict(),
  z.object({op:z.literal('fluff.remove'),indices:z.array(z.number().int().nonnegative()).min(1).max(20000)}).strict(),
  z.object({op:z.literal('hardTile.repair')}).strict(),
  z.object({op:z.literal('hardTile.replace'),groups:z.array(z.record(z.string(),z.unknown())).max(16384)}).strict(),
  z.object({op:z.literal('pathing.hints'),cells:z.array(coordinate.extend({value:z.number().int().min(0).max(65535)})).min(1).max(65536)}).strict(),
  z.object({op:z.literal('palette.author'),terrainId:z.string().min(1).max(128),textures:z.array(z.object({id:z.string().min(1).max(128),diffuse:z.string().max(512).optional(),normal:z.string().max(512).optional()}).strict()).min(1).max(64),uvTiling:z.tuple([z.number().positive(),z.number().positive(),z.number().finite(),z.number().finite()]),
    blockPalettes:z.object({sets:z.array(z.object({id:z.string().min(1).max(128),textureIds:z.array(z.string().min(1).max(128)).min(1).max(8)}).strict()).min(1).max(8),assignments:z.array(z.number().int().min(0).max(7)).max(65536)}).strict().optional()}).strict(),
  z.object({op:z.literal('ramp.template'),donorDirectory:z.string().min(1).max(512),rampIndex:z.number().int().nonnegative(),bounds:z.object({minX:z.number().int().nonnegative(),minY:z.number().int().nonnegative(),maxX:z.number().int().positive(),maxY:z.number().int().positive()}).strict(),offsetX:z.number().int(),offsetY:z.number().int(),levelOffset:z.number().int().default(0),cliffSetIndex:z.number().int().min(0).max(63).default(0),extraHalfWidth:z.number().int().min(0).max(64).default(0)}).strict(),
]);
export const modkitTerrainPlanSchema=z.object({directory:z.string().default(''),operations:z.array(modkitTerrainOperation).min(1).max(100),
  templates:z.record(z.string(),z.string()).default({})}).strict();
export type ModkitTerrainPlan=z.input<typeof modkitTerrainPlanSchema>;
