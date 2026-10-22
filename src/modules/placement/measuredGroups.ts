import * as z from 'zod/v4';
import {measuredMemberGeometry} from './compositionGeometry.js';

const point=z.object({x:z.number().finite(),y:z.number().finite()}).strict();
export const horizontalBoundsSchema=z.object({minX:z.number().finite(),maxX:z.number().finite(),minY:z.number().finite(),maxY:z.number().finite()}).strict().refine(b=>b.minX<=b.maxX&&b.minY<=b.maxY);
export const measuredMemberSchema=z.object({id:z.string().min(1),key:z.string().min(1).optional(),heightOffset:z.number().finite().default(0),variation:z.number().int().nonnegative().optional(),boundsFrame:z.enum(['group','member']).default('group'),horizontalBounds:horizontalBoundsSchema.optional(),offset:point,rotation:z.number().finite().default(0),scale:z.number().positive().max(10).default(1)}).strict();
export const measuredGroupSchema=z.object({id:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),anchor:point,angle:z.number().finite().default(0),maxSlope:z.number().nonnegative().default(.5),members:z.array(measuredMemberSchema.extend({boundsFrame:z.literal('member'),horizontalBounds:horizontalBoundsSchema})).min(1).max(500)}).strict();
export interface MeasuredSurface {waterCoverageKnown:boolean;bounds?:{minX:number;minY:number;maxX:number;maxY:number};sampleGround:(p:{x:number;y:number})=>{height:number;slope:number;mask:number;hidden?:boolean;protected?:boolean;water?:unknown[]}}
type Group={anchor:{x:number;y:number};angle:number;maxSlope:number;members:z.infer<typeof measuredMemberSchema>[]};
export function measuredObjects(group:Group,surface:MeasuredSurface,review?:(geometry:ReturnType<typeof measuredMemberGeometry>,member:Group['members'][number],index:number)=>void){
 if(!surface.waterCoverageKnown)throw Error('TERRAIN_WATER_COVERAGE_UNAVAILABLE');
 return group.members.map((m,index)=>{
  const geometry=measuredMemberGeometry(group.anchor,group.angle,m),{x,y}=geometry.position;review?.(geometry,m,index);
  for(const position of [geometry.position,...geometry.corners])if(surface.bounds&&(position.x<surface.bounds.minX||position.y<surface.bounds.minY||position.x>surface.bounds.maxX||position.y>surface.bounds.maxY))throw Error('COMPOSITION_MEMBER_OUTSIDE_TERRAIN: '+m.id);
  const ground=surface.sampleGround({x,y}),unsuitable=(g:ReturnType<MeasuredSurface['sampleGround']>)=>g.hidden||g.mask===0||g.protected||g.water?.length||g.slope>group.maxSlope;
  if(unsuitable(ground))throw Error('COMPOSITION_MEMBER_UNSUITABLE_GROUND: '+m.id);
  for(const position of geometry.corners)if(unsuitable(surface.sampleGround(position)))throw Error('COMPOSITION_MEMBER_BOUNDS_UNSUITABLE_GROUND: '+m.id);
  return {kind:'Doodad' as const,...m.key?{key:m.key}:{id:m.id,catalogType:'Actor'},variation:m.variation,position:{x,y,z:ground.height+m.heightOffset},rotation:geometry.rotation,scale:m.scale,flags:{HeightAbsolute:'1'}};
 });
}
