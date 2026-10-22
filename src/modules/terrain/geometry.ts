import type { Point2, TerrainArea } from "./types.js";
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export function segmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    n = dx * dx + dy * dy;
  const t = n ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / n) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Whole stroke containment, including round end caps; prevents cross-zone edits. */
export function corridorWithinArea(area:TerrainArea,points:Point2[],width:number):boolean{
 const radius=width/2;
 if(!points.length||!Number.isFinite(width)||width<=0||points.some(p=>areaDistance(area,p)<radius-1e-9))return false;
 if(area.type==='rectangle'||area.type==='circle')return true; // Convex inset.
 if(area.type!=='polygon')return false;
 const cross=(a:Point2,b:Point2,c:Point2)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 for(let i=1;i<points.length;i++)for(let j=0;j<area.points.length;j++){
  const a=points[i-1],b=points[i],c=area.points[j],d=area.points[(j+1)%area.points.length];
  const overlap=Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))+1e-9&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))+1e-9;
  if(overlap&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return false;
  if(Math.min(segmentDistance(a,c,d),segmentDistance(b,c,d),segmentDistance(c,a,b),segmentDistance(d,a,b))<radius-1e-9)return false;
 }
 return true;
}
export function areaDistance(area: TerrainArea, p: Point2): number {
  if (area.type === "circle")
    return area.radius - Math.hypot(p.x - area.center.x, p.y - area.center.y);
  if (area.type === "rectangle")
    return Math.min(
      p.x - area.minX,
      area.maxX - p.x,
      p.y - area.minY,
      area.maxY - p.y,
    );
  if (area.type === "corridor") {
    let distance = Infinity;
    for (let i = 1; i < area.points.length; i++)
      distance = Math.min(
        distance,
        segmentDistance(p, area.points[i - 1], area.points[i]),
      );
    return area.width / 2 - distance;
  }
  let inside = false;
  let distance = Infinity;
  for (let i = 0, j = area.points.length - 1; i < area.points.length; j = i++) {
    const a = area.points[i],
      b = area.points[j];
    distance = Math.min(distance, segmentDistance(p, a, b));
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return distance < 1e-9 ? 0 : inside ? distance : -distance;
}
export function areaWeight(
  area: TerrainArea,
  p: Point2,
  edgeBlend = 0,
): number {
  const d = areaDistance(area, p);
  if (d < 0) return 0;
  if (!edgeBlend) return 1;
  const t = clamp(d / edgeBlend);
  return t * t * (3 - 2 * t);
}
export function areaBounds(area: TerrainArea) {
  if (area.type === "rectangle") return area;
  if (area.type === "circle")
    return {
      minX: area.center.x - area.radius,
      minY: area.center.y - area.radius,
      maxX: area.center.x + area.radius,
      maxY: area.center.y + area.radius,
    };
  const r = area.type === "corridor" ? area.width / 2 : 0;
  return {
    minX: Math.min(...area.points.map((p) => p.x)) - r,
    minY: Math.min(...area.points.map((p) => p.y)) - r,
    maxX: Math.max(...area.points.map((p) => p.x)) + r,
    maxY: Math.max(...area.points.map((p) => p.y)) + r,
  };
}
function hash(x: number, y: number, seed: number): number {
  let v = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed) | 0;
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return (((v ^ (v >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  return (
    (hash(ix, iy, seed) * (1 - sx) + hash(ix + 1, iy, seed) * sx) * (1 - sy) +
    (hash(ix, iy + 1, seed) * (1 - sx) + hash(ix + 1, iy + 1, seed) * sx) * sy
  );
}
