import {areaDistance,corridorWithinArea,segmentDistance} from '../terrain/geometry.js';
import type {TerrainArea,Point2} from '../terrain/types.js';
import type {ExclusionZone,LocationRoute} from './types.js';

function segmentGap(a:Point2,b:Point2,c:Point2,d:Point2){
 const cross=(p:Point2,q:Point2,r:Point2)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
 const overlap=Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y));
 return overlap&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0?0:Math.min(segmentDistance(a,c,d),segmentDistance(b,c,d),segmentDistance(c,a,b),segmentDistance(d,a,b));
}
const edges=(points:Point2[])=>points.map((a,i)=>[a,points[(i+1)%points.length]] as const);
const inside=(p:Point2,polygon:Point2[])=>areaDistance({type:'polygon',points:polygon},p)>=0;
export function checkGroupClearance(geometry:{position:Point2;corners:Point2[]},area:TerrainArea,routes:LocationRoute[],exclusions:ExclusionZone[]){
 if(geometry.corners.length!==4)throw Error('LANDSCAPE_GROUP_MEASURED_BOUNDS_REQUIRED');
 const polygon=[geometry.corners[0],geometry.corners[1],geometry.corners[3],geometry.corners[2]],ring=edges(polygon);
 if([geometry.position,...polygon].some(p=>areaDistance(area,p)<0)||area.type==='polygon'&&ring.some(([a,b])=>!corridorWithinArea(area,[a,b],1e-6)))throw Error('LANDSCAPE_GROUP_OUTSIDE_ZONE');
 for(const route of routes){const radius=route.width/2;if(route.points.some(p=>inside(p,polygon))||route.points.slice(1).some((b,i)=>ring.some(([c,d])=>segmentGap(route.points[i],b,c,d)<=radius)))throw Error('LANDSCAPE_GROUP_IN_RESERVED_ROUTE');}
 for(const zone of exclusions){
  const intersects=zone.type==='circle'?inside(zone.center,polygon)||ring.some(([a,b])=>segmentDistance(zone.center,a,b)<=zone.radius):(()=>{const rectangle=[{x:zone.minX,y:zone.minY},{x:zone.maxX,y:zone.minY},{x:zone.maxX,y:zone.maxY},{x:zone.minX,y:zone.maxY}];return inside(rectangle[0],polygon)||inside(polygon[0],rectangle)||ring.some(([a,b])=>edges(rectangle).some(([c,d])=>segmentGap(a,b,c,d)===0));})();
  if(intersects)throw Error('LANDSCAPE_GROUP_IN_EXCLUSION');
 }
 return {type:'rectangle' as const,minX:Math.min(...polygon.map(p=>p.x)),maxX:Math.max(...polygon.map(p=>p.x)),minY:Math.min(...polygon.map(p=>p.y)),maxY:Math.max(...polygon.map(p=>p.y))};
}
