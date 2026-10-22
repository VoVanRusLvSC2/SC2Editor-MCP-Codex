import {createHash} from 'node:crypto';
import {readArchiveEntry} from '../../archive/archiveAdapter.js';
import {MapInfoDocument} from '../map/mapInfo.js';
import type {TestManifest,TestCheck} from './schemas.js';

/** Existing native backend preserves locale/name checks without unpacking assets. */
export async function readArchiveMapInfo(file:string):Promise<Buffer>{
 return readArchiveEntry(file,'MapInfo');
}

/** Necessary center containment only; engine collision, footprints and spawn clearance remain separate. */
export function routeBoundsCheck(manifest:TestManifest,bytes:Buffer):TestCheck{
 const info=new MapInfoDocument(bytes),bounds=info.playableBounds;
 const names=[...new Set(manifest.game?.routes.flatMap(route=>[route.from,route.to])??[])];
 const outside=names.filter(name=>{const p=manifest.game!.points[name];return p.x<bounds.left||p.x>=bounds.right||p.y<bounds.bottom||p.y>=bounds.top;});
 return {id:'map.playable_bounds',status:outside.length?'failed':'passed',required:true,
  reason:outside.length?'TEST_ROUTE_POINT_OUTSIDE_PLAYABLE_BOUNDS: '+outside.join(', '):undefined,
  evidence:{bounds,mapInfoSha256:createHash('sha256').update(bytes).digest('hex'),checkedPoints:names,outside,
   scope:'Named route point centers; right/top are exclusive. Does not prove unit footprint clearance, path connectivity, collision or buildability.'}};
}
