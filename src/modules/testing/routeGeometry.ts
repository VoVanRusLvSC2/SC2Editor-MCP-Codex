/** Distance from a sampled unit center to the closed endpoint segment.
 * A corridor constrains observed samples, not the unsampled engine path or footprint.
 */
export function routeDeviation(p:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number}):number{
 const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
 const t=length===0?0:Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length));
 return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
