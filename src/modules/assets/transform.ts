export type Vec3 = [number, number, number];

export interface Transform {
  scale?: number | Vec3;
  rotation?: number;
  position?: Vec3;
}

/** Pure rest-geometry transform, shared by triangle and attachment measurements. */
export function transformPoint(point: number[], transform: Transform): Vec3 {
  const scale =
    typeof transform.scale === "number"
      ? [transform.scale, transform.scale, transform.scale]
      : (transform.scale ?? [1, 1, 1]);
  const angle = transform.rotation ?? 0;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const origin = transform.position ?? [0, 0, 0];
  const x = point[0] * scale[0];
  const y = point[1] * scale[1];
  return [
    cosine * x - sine * y + origin[0],
    sine * x + cosine * y + origin[1],
    point[2] * scale[2] + origin[2],
  ];
}
