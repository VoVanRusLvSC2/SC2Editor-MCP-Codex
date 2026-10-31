import {createHash} from 'node:crypto';
import {readArchiveEntry} from '../../archive/archiveAdapter.js';
import {MapInfoDocument} from '../map/mapInfo.js';
import type {TestManifest,TestCheck} from './schemas.js';
import {pathingPointNames} from './padQueries.js';

/** Existing native backend preserves locale/name checks without unpacking assets. */
export async function readArchiveMapInfo(file:string):Promise<Buffer>{
 return readArchiveEntry(file,'MapInfo');
}

/** Necessary center containment only; engine collision, footprints and spawn clearance remain separate. */
export function routeBoundsCheck(manifest:TestManifest,bytes:Buffer):TestCheck{
 const info=new MapInfoDocument(bytes),bounds=info.playableBounds;
 const formations=manifest.game?.formations??[];
 const padNames=[...(manifest.game?.pads??[]).map(p=>p.at),...pathingPointNames(manifest.game?.pathing??[]),...(manifest.game?.padProbe?[manifest.game.padProbe.origin]:[]),...(manifest.game?.nativeProbe?[manifest.game.nativeProbe.origin]:[])];
 const combatPoints=(manifest.game?.combats??[]).flatMap(combat=>[combat.attacker.at,combat.defender.at]);
 const names=[...new Set([...[...(manifest.game?.routes??[]),...formations].flatMap(route=>[route.from,route.to]),...padNames,...combatPoints])];
 const outside=names.filter(name=>{const p=manifest.game!.points[name];return p.x<bounds.left||p.x>=bounds.right||p.y<bounds.bottom||p.y>=bounds.top;});
 const checkedFormationPoints=formations.flatMap(f=>f.offsets.flatMap((offset,index)=>[f.from,f.to].map(anchor=>({formation:f.id,index,anchor,x:manifest.game!.points[anchor].x+offset.x,y:manifest.game!.points[anchor].y+offset.y}))));
 const outsideFormationPoints=checkedFormationPoints.filter(p=>p.x<bounds.left||p.x>=bounds.right||p.y<bounds.bottom||p.y>=bounds.top);
 return {id:'map.playable_bounds',status:outside.length||outsideFormationPoints.length?'failed':'passed',required:true,
  reason:outside.length?(padNames.length?'TEST_POINT_OUTSIDE_PLAYABLE_BOUNDS: ':'TEST_ROUTE_POINT_OUTSIDE_PLAYABLE_BOUNDS: ')+outside.join(', '):outsideFormationPoints.length?'TEST_FORMATION_MEMBER_OUTSIDE_PLAYABLE_BOUNDS: '+outsideFormationPoints.map(p=>p.formation+'/'+p.index+'/'+p.anchor).join(', '):undefined,
  evidence:{bounds,mapInfoSha256:createHash('sha256').update(bytes).digest('hex'),checkedPoints:names,outside,
   ...(formations.length?{checkedFormationPoints,outsideFormationPoints}:{}),scope:padNames.length?'Named movement, placement-query and probe centers, plus declared formation endpoint offsets; right/top are exclusive. No footprint, path, collision or placement-predicate proof.':formations.length?'Named movement anchors and formation member centers at both endpoints; right/top are exclusive. No footprint, path, collision or buildability proof.':'Named route point centers; right/top are exclusive. Does not prove unit footprint clearance, path connectivity, collision or buildability.'}};
}
