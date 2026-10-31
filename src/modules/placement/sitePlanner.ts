import * as z from "zod/v4";
import { prefabSchema, type DecorPrefabs } from "./decorPrefabs.js";
import { measuredMemberGeometry } from "./compositionGeometry.js";
import { landscapeZoneSchema } from "../terrain/landscapeOwnership.js";

/** One designed site, using the existing measured prefab and owned landscape systems. */
export const siteSchema = prefabSchema
  .omit({ includeImage: true, recipe: true })
  .extend({
    zone: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    recipe: z.enum(["checkpoint", "forest_clearing"]),
    baseTexture: z.string().min(1).max(128),
    pathTexture: z.string().min(1).max(128),
    accentTexture: z.string().min(1).max(128).optional(),
    margin: z.number().min(2).max(16).default(3),
    maxSlope: z.number().nonnegative().max(4).default(0.5),
    condition: z.enum(["operational", "abandoned"]).default("operational"),
    purpose: z.string().max(160).optional(),
  })
  .strict();

type Prefab = Pick<Awaited<ReturnType<DecorPrefabs["plan"]>>, "members" | "reservedLocal">;
export function siteZone(input: z.input<typeof siteSchema>, prefab: Prefab) {
  const args = siteSchema.parse(input),
    c = Math.cos(args.angle),
    s = Math.sin(args.angle),
    world = (x: number, y: number) => ({
      x: args.anchor.x + c * x - s * y,
      y: args.anchor.y + s * x + c * y,
    });
  const corners = prefab.members.flatMap(
    (member) => measuredMemberGeometry({ x: 0, y: 0 }, 0, member).corners,
  );
  if (!corners.length) throw Error("SITE_MEASURED_BOUNDS_REQUIRED");
  const reserved = prefab.reservedLocal[0];
  if (
    !reserved ||
    ![reserved.minX, reserved.maxX, reserved.minY, reserved.maxY].every(Number.isFinite)
  )
    throw Error("SITE_RESERVATION_UNRESOLVED");
  const padding = Math.max(args.margin, args.clearance / 2 + 1),
    minX = Math.min(...corners.map((p) => p.x), reserved.minX) - padding,
    maxX = Math.max(...corners.map((p) => p.x), reserved.maxX) + padding,
    minY = Math.min(...corners.map((p) => p.y), reserved.minY) - padding,
    maxY = Math.max(...corners.map((p) => p.y), reserved.maxY) + padding;
  const area = {
      type: "polygon" as const,
      z: 0,
      points: [world(minX, minY), world(maxX, minY), world(maxX, maxY), world(minX, maxY)],
    },
    natural = args.recipe === "forest_clearing",
    route = {
      points: [world(0, reserved.minY), world(0, reserved.maxY)],
      width: args.clearance,
      texture: args.pathTexture,
      edgeBlend: 0.8,
      flatten: false,
    };
  // No implicit height flattening. The same owned plan paints the floor/road and
  // verifies support for every measured member before staging any component.
  return landscapeZoneSchema.parse({
    id: args.zone,
    purpose:
      args.purpose ??
      (natural
        ? "Open forest clearing with staggered canopy groups and an approach lane"
        : "Readable checkpoint with a clear gate, utility bay and asymmetric perimeter"),
    condition: args.condition,
    config: {
      locationType: natural ? "forest" : "militaryBase",
      area,
      seed: args.seed,
      objectCount: 0,
      maxSlope: args.maxSlope,
      terrain: {
        style: natural ? "forest" : "city",
        heightMode: "preserve",
        textureMode: "generate",
        seed: args.seed,
        edgeBlend: 1.5,
        materials: {
          base: args.baseTexture,
          ...(args.accentTexture
            ? {
                patches: [
                  {
                    texture: args.accentTexture,
                    wavelength: natural ? 7 : 4,
                    threshold: natural ? -0.1 : 0.35,
                    transition: 0.5,
                    strength: natural ? 0.55 : 0.3,
                  },
                ],
              }
            : {}),
        },
        routes: [route],
      },
      groups: [
        {
          id: "layout",
          anchor: args.anchor,
          angle: args.angle,
          members: prefab.members,
          maxSlope: args.maxSlope,
        },
      ],
    },
  });
}
