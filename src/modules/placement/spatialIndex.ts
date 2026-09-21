export interface PointXY {
  x: number;
  y: number;
}

/** Fixed-distance grid: exact distance is still checked in neighboring buckets. */
export class DistanceIndex<T extends PointXY> {
  private buckets = new Map<string, T[]>();
  constructor(readonly distance: number) {
    if (!Number.isFinite(distance) || distance <= 0)
      throw new Error("Distance index requires a finite positive distance");
  }
  private cell(p: PointXY) {
    return [
      Math.floor(p.x / this.distance),
      Math.floor(p.y / this.distance),
    ] as const;
  }
  add(p: T): void {
    const [x, y] = this.cell(p),
      key = `${x},${y}`;
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(p);
    else this.buckets.set(key, [p]);
  }
  *near(p: PointXY): Generator<T> {
    const [x, y] = this.cell(p);
    const keys = new Set<string>();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) keys.add(`${x + dx},${y + dy}`);
    for (const key of keys)
      for (const other of this.buckets.get(key) ?? [])
        if (Math.hypot(p.x - other.x, p.y - other.y) < this.distance)
          yield other;
  }
  hasNear(p: PointXY): boolean {
    return !this.near(p).next().done;
  }
}
