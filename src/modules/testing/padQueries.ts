import * as z from 'zod/v4';

const name=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const fixed=z.number().finite().refine(n=>Number.isInteger(n*4096),'Value must be exactly representable by the native 1/4096 fixed grid');
export const padSchema=z.object({id:name,at:name,type:z.string().min(1).max(256).refine(s=>!/[\p{Cc}]/u.test(s),'Catalog IDs cannot contain control characters'),owner:z.number().int().min(0).max(15).default(1),
 range:fixed.min(0).max(64).default(0),expected:z.enum(['exact','candidate','blocked']).default('exact'),maxOffset:fixed.min(0).max(128).optional(),
 tests:z.number().int().min(0).max(2147483647).optional(),overrideReason:z.string().trim().min(3).max(512).optional(),required:z.boolean().default(true)
}).strict().superRefine((p,c)=>{
 if(p.tests!==undefined&&!p.overrideReason)c.addIssue({code:'custom',message:'An explicit native test mask requires overrideReason; tests=0 bypasses normal restrictions'});
 if(p.tests===undefined&&p.overrideReason)c.addIssue({code:'custom',message:'overrideReason requires an explicit test mask'});
 if(p.expected==='blocked'&&p.maxOffset!==undefined)c.addIssue({code:'custom',message:'A blocked expectation has no candidate offset'});
});
export const padProbeSchema=z.object({origin:name,afterGameSeconds:fixed.min(.25).max(120).default(1),timeout:z.number().int().min(1).max(120).default(30)}).strict();
const pathingBase={id:name,expected:z.boolean(),required:z.boolean().default(true)};
export const pathingSchema=z.discriminatedUnion('kind',[
 z.object({...pathingBase,kind:z.literal('passable'),at:name}).strict(),
 z.object({...pathingBase,kind:z.literal('connected'),from:name,to:name}).strict()
]);
export type PathingSpec=z.infer<typeof pathingSchema>;
export const pathingPointNames=(checks:readonly PathingSpec[])=>checks.flatMap(q=>q.kind==='passable'?[q.at]:[q.from,q.to]);
export type PadSpec=z.infer<typeof padSchema>;
export type PadProbeSpec=z.infer<typeof padProbeSchema>;
export interface PadPoint{x:number;y:number}
export interface PadChannel {version:2|3;prefix:string;unitType:string;slots:number;queryScript:string;init:string;pads:PadSpec[];pathing?:PathingSpec[];points:Record<string,PadPoint>;probe:PadProbeSpec}
const literal=(n:number)=>Number.isInteger(n)?n+'.0':String(n);

/** Private, intentionally invisible result units are emitted only after all queries. */
export function padQuerySource(channel:PadChannel){
 const {prefix:p,unitType,points,pads,probe}=channel,pathing=channel.pathing??[],version=pathing.length?3:2;
 if(!(version===3?/^MCPQuery[A-Fa-f0-9]{16}$/:/^MCPPad[A-Fa-f0-9]{16}$/).test(p)||channel.version!==version||unitType!==p+'Carrier'||channel.init!==p+'_Init'||channel.queryScript!==`Scripts/${p}.galaxy`||channel.slots!==1+pads.length*2+pathing.length||pads.length+pathing.length<1||pads.length>32||pathing.length>32)throw Error('PAD_CHANNEL_IDENTITY_INVALID');
 pads.forEach(pad=>padSchema.parse(pad));padProbeSchema.parse(probe);
 pathing.forEach(query=>pathingSchema.parse(query));
 const origin=points[probe.origin];if(!origin)throw Error('PAD_PROBE_ORIGIN_MISSING');
 for(const id of new Set([probe.origin,...pads.map(p=>p.at),...pathingPointNames(pathing)])){const point=points[id];if(!Object.hasOwn(points,id)||!point||!Number.isInteger(point.x*4096)||!Number.isInteger(point.y*4096)||point.x<0||point.y<0||point.x>=1000||point.y>=1000)throw Error('PAD_POINT_ENCODING_RANGE');}
 const queries=pads.map((pad,i)=>{
  const point=points[pad.at];if(!point)throw Error('PAD_POINT_MISSING: '+pad.id);
  const slot=1+2*i,request=`Point(${literal(point.x)}, ${literal(point.y)})`;
  const native=pad.tests===undefined?`UnitTypePlacementFromPoint(${JSON.stringify(pad.type)}, ${pad.owner}, ${request}, ${literal(pad.range)})`:`UnitTypePlacementTestsFromPoint(${JSON.stringify(pad.type)}, ${pad.owner}, ${request}, ${literal(pad.range)}, ${pad.tests})`;
  return `    ${p}_flags[${slot}] = CatalogEntryIsValid(c_gameCatalogUnit, ${JSON.stringify(pad.type)});\n    if (${p}_flags[${slot}]) { ${p}_points[${slot+1}] = ${native}; }\n    ${p}_flags[${slot+1}] = ${p}_points[${slot+1}] != null;`;
 }).join('\n');
 const pathQueries=pathing.map((query,i)=>{
  const point=(id:string)=>`Point(${literal(points[id].x)}, ${literal(points[id].y)})`;
  const native=query.kind==='passable'?`PointPathingPassable(${point(query.at)})`:`PointPathingIsConnected(${point(query.from)}, ${point(query.to)})`;
  return `    ${p}_flags[${1+pads.length*2+i}] = ${native};`;
 }).join('\n');
 return `include "TriggerLibs/NativeLib"
// Private native-query observer. No game Toolkit implementation is embedded here.
bool[${channel.slots}] ${p}_flags;
point[${channel.slots}] ${p}_points;

void ${p}_Emit (int slot) {
    unit probeUnit;
    UnitCreate(1, "${unitType}", c_unitCreateIgnorePlacement, 0, Point(${literal(origin.x)}, ${literal(origin.y)}), 270.0);
    probeUnit = UnitLastCreated();
    UnitSetState(probeUnit, c_unitStateInvulnerable, true);
    UnitSetPropertyFixed(probeUnit, c_unitPropLifeMax, 512.0);
    UnitSetPropertyFixed(probeUnit, c_unitPropLifeRegen, 0.0);
    UnitSetPropertyFixed(probeUnit, c_unitPropEnergyMax, 1000.0);
    UnitSetPropertyFixed(probeUnit, c_unitPropEnergyRegen, 0.0);
    UnitSetPropertyFixed(probeUnit, c_unitPropShieldsMax, 1000.0);
    UnitSetPropertyFixed(probeUnit, c_unitPropShieldsRegen, 0.0);
    if (${p}_flags[slot]) { UnitSetPropertyFixed(probeUnit, c_unitPropLife, IntToFixed(slot * 2 + 2)); }
    else { UnitSetPropertyFixed(probeUnit, c_unitPropLife, IntToFixed(slot * 2 + 1)); }
    if (${p}_points[slot] != null) {
        UnitSetPropertyFixed(probeUnit, c_unitPropEnergy, PointGetX(${p}_points[slot]));
        UnitSetPropertyFixed(probeUnit, c_unitPropShields, PointGetY(${p}_points[slot]));
    }
}

bool ${p}_Collect (bool testConds, bool runActions) {
    int slot;
    if (!runActions) { return true; }
    ${p}_flags[0] = true;
${queries}
${pathQueries}
    // Creating carriers earlier could change later placement predicates.
    slot = 0;
    while (slot < ${channel.slots}) { ${p}_Emit(slot); slot += 1; }
    return true;
}

void ${channel.init} () {
    trigger probeTrigger;
    probeTrigger = TriggerCreate("${p}_Collect");
    TriggerAddEventTimeElapsed(probeTrigger, ${literal(probe.afterGameSeconds)}, c_timeGame);
}
`;
}

/** One complete native page, exact slot/value codes; coordinates never identify units. */
export function decodeProbeSlots(channel:PadChannel,body:Record<string,any>){
 if(body.truncated!==false||!Array.isArray(body.units)||body.units.length!==channel.slots)throw Error('PAD_CHANNEL_PAGE_INCOMPLETE');
 const slots=new Map<number,Record<string,any>>(),ids=new Set<string>();
 for(const unit of body.units){
  if(typeof unit.id!=='string'||!unit.id||ids.has(unit.id)||unit.type!==channel.unitType||unit.owner!==0||unit.valid!==true||unit.alive!==true||unit.invulnerable!==true||!Number.isInteger(unit.life)||unit.life<1||unit.life>channel.slots*2)throw Error('PAD_CHANNEL_CARRIER_INVALID');
  const slot=Math.floor((unit.life-1)/2);if(slots.has(slot))throw Error('PAD_CHANNEL_SLOT_DUPLICATE');slots.set(slot,unit);ids.add(unit.id);
 }
 if(slots.get(0)?.life!==2)throw Error('PAD_CHANNEL_HEADER_INVALID');
 return slots;
}
export function decodePadChannel(channel:PadChannel,body:Record<string,any>){
 const slots=decodeProbeSlots(channel,body);
 return channel.pads.map((pad,i)=>{
  const valid=slots.get(1+2*i)!.life===2*(1+2*i)+2,carrier=slots.get(2+2*i)!,present=carrier.life===2*(2+2*i)+2,requested=channel.points[pad.at];
  if(!valid&&present)throw Error('PAD_CHANNEL_INVALID_CATALOG_CANDIDATE');
  let candidate:PadPoint|null=null;
  if(present){if(![carrier.energy,carrier.shields].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<1000&&Number.isInteger(v*4096)))throw Error('PAD_CHANNEL_COORDINATE_INVALID');candidate={x:carrier.energy,y:carrier.shields};}
  const exact=candidate?candidate.x===requested.x&&candidate.y===requested.y:false,offset=candidate?Math.hypot(candidate.x-requested.x,candidate.y-requested.y):null;
  return {id:pad.id,catalogValid:valid,requested,candidate,exact,offset,range:pad.range,...(pad.tests!==undefined?{tests:pad.tests,overrideReason:pad.overrideReason}:{}),expected:pad.expected,
   matched:valid&&(pad.expected==='blocked'?!present:pad.expected==='exact'?exact:present)&&(pad.maxOffset===undefined||offset!==null&&offset<=pad.maxOffset),
   carrier:{id:carrier.id,life:carrier.life},scope:'Native placement predicate at one declared elapsed-game-time callback. Not a build order, cost/tech check, path arrival or resource binary/visual proof.'};
 });
}

/** Raw ground-point predicates, without inferring unit-footprint arrival or a cause. */
export function decodePathingChannel(channel:PadChannel,body:Record<string,any>){
 const slots=decodeProbeSlots(channel,body);
 return (channel.pathing??[]).map((query,i)=>{
  const slot=1+channel.pads.length*2+i,carrier=slots.get(slot)!,observed=carrier.life===slot*2+2;
  return {id:query.id,kind:query.kind,expected:query.expected,observed,matched:observed===query.expected,
   points:query.kind==='passable'?{at:channel.points[query.at]}:{from:channel.points[query.from],to:channel.points[query.to]},
   nativeFunction:query.kind==='passable'?'PointPathingPassable':'PointPathingIsConnected',carrier:{id:carrier.id,life:carrier.life},
   scope:'Native ground-point predicate at one declared elapsed-game-time callback. Not a unit-footprint/facing test, movement arrival, full navigation rebuild, obstacle cause or a predicate on a later separate Game pass.'};
 });
}
