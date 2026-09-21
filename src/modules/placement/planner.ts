import type {
  ExclusionZone,
  PlacementArea,
  PlacementLayout,
  Position3,
} from "./types.js";
import { DistanceIndex } from "./spatialIndex.js";

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function excluded(point: Position3, zones: ExclusionZone[]): boolean {
  return zones.some((zone) =>
    zone.type === "circle"
      ? Math.hypot(point.x - zone.center.x, point.y - zone.center.y) <
        zone.radius
      : point.x >= zone.minX &&
        point.x <= zone.maxX &&
        point.y >= zone.minY &&
        point.y <= zone.maxY,
  );
}

function randomPoint(area: PlacementArea, random: () => number): Position3 {
  if (area.type === "rectangle")
    return {
      x: area.minX + random() * (area.maxX - area.minX),
      y: area.minY + random() * (area.maxY - area.minY),
      z: area.z,
    };
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * area.radius;
  return {
    x: area.center.x + Math.cos(angle) * radius,
    y: area.center.y + Math.sin(angle) * radius,
    z: area.center.z,
  };
}

export function planPositions(
  origin: Position3,
  count: number,
  layout: PlacementLayout,
  options: {
    acceptPoint?: (point: Position3) => boolean;
    existingPoints?: Position3[];
    maxAttempts?: number;
  } = {},
): Position3[] {
  if (!Number.isInteger(count) || count < 1 || count > 5_000)
    throw new Error("Placement count must be between 1 and 5000");
  switch (layout.type) {
    case "single":
      if (count !== 1) throw new Error("single layout requires count=1");
      return [{ ...origin }];
    case "line": {
      const angle = layout.angle ?? 0;
      return Array.from({ length: count }, (_, index) => ({
        x: origin.x + Math.cos(angle) * layout.spacing * index,
        y: origin.y + Math.sin(angle) * layout.spacing * index,
        z: origin.z,
      }));
    }
    case "grid":
      return Array.from({ length: count }, (_, index) => ({
        x: origin.x + (index % layout.columns) * layout.spacingX,
        y: origin.y + Math.floor(index / layout.columns) * layout.spacingY,
        z: origin.z,
      }));
    case "circle":
      return Array.from({ length: count }, (_, index) => {
        const angle = (layout.startAngle ?? 0) + (index / count) * Math.PI * 2;
        return {
          x: origin.x + Math.cos(angle) * layout.radius,
          y: origin.y + Math.sin(angle) * layout.radius,
          z: origin.z,
        };
      });
    case "scatter": {
      const random = seededRandom(layout.seed ?? 1);
      const minimum = Math.max(0, layout.minimumDistance ?? 0);
      const zones = layout.exclusionZones ?? [];
      const points: Position3[] = [];
      const index =
        minimum > 0 ? new DistanceIndex<Position3>(minimum) : undefined;
      for (const point of options.existingPoints ?? []) index?.add(point);
      const attempts = options.maxAttempts ?? Math.max(500, count * 250);
      for (
        let attempt = 0;
        attempt < attempts && points.length < count;
        attempt++
      ) {
        const point = randomPoint(layout.area, random);
        if (excluded(point, zones)) continue;
        if (index?.hasNear(point)) continue;
        if (options.acceptPoint && !options.acceptPoint(point)) continue;
        points.push(point);
        index?.add(point);
      }
      if (points.length !== count)
        throw new Error(
          `Could place only ${points.length}/${count} objects with minimumDistance=${minimum}; enlarge the area or lower density`,
        );
      return points;
    }
  }
}
