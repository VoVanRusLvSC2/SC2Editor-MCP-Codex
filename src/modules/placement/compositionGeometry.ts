type Point={x:number;y:number};
type MeasuredMember={offset:Point;rotation:number;scale:number;boundsFrame?:'member'|'group';horizontalBounds?:{minX:number;maxX:number;minY:number;maxY:number}};
/** Legacy bounds were already oriented/scaled in group axes. New member bounds
 * include catalog scale, but still need the member's placement scale/rotation. */
export function measuredMemberGeometry(anchor:Point,angle:number,member:MeasuredMember){
 const c=Math.cos(angle),s=Math.sin(angle),position={x:anchor.x+c*member.offset.x-s*member.offset.y,y:anchor.y+s*member.offset.x+c*member.offset.y};
 const rotation=angle+member.rotation,boundsRotation=angle+(member.boundsFrame==='member'?member.rotation:0),scale=member.boundsFrame==='member'?member.scale:1,bc=Math.cos(boundsRotation),bs=Math.sin(boundsRotation),b=member.horizontalBounds;
 const corners=b?[[b.minX,b.minY],[b.maxX,b.minY],[b.minX,b.maxY],[b.maxX,b.maxY]].map(([x,y])=>({x:position.x+scale*(bc*x-bs*y),y:position.y+scale*(bs*x+bc*y)})):[];
 return {position,rotation,corners};
}
