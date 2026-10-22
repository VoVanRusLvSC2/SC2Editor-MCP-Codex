import type {DataField,DataObject} from './types.js';
export interface CardBinding {page:number;slot:number;attrs:Record<string,string>;declaredBy:string}
export interface CardIssue {code:string;message:string;page?:number;slots?:number[]}
export interface CardState {unit:string;lineage:string[];bindings:CardBinding[];issues:CardIssue[];layoutResolved:boolean;declaredSpeed?:{value:number;declaredBy:string}}
const removed=(f:DataField)=>['1','true'].includes(f.attrs.removed??'');
const numeric=(value:string|undefined)=>value!==undefined&&/^(0|[1-9]\d*)$/.test(value)?Number(value):undefined;
const command=(b:CardBinding)=>b.attrs.AbilCmd??b.attrs.Type??'';
/** Resolve the measured fresh implicit / explicit indexed native-card profile.
 * Derived unindexed lists and competing active parents remain unverified. */
export function unitCardState(objects:readonly DataObject[],unitId:string):CardState{
 const issues:CardIssue[]=[],lineage:DataObject[]=[],seen=new Set<string>();
 let id:string|undefined=unitId;
 while(id){
  if(seen.has(id)){issues.push({code:'CARD_PARENT_CYCLE',message:'Unit parent cycle: '+id});break;}seen.add(id);
  const candidates=objects.filter(o=>o.domain==='Unit'&&o.id===id);
  if(candidates.length!==1){issues.push({code:'CARD_PARENT_UNRESOLVED_OR_LAYERED',message:'Expected one active Unit declaration: '+id});break;}
  lineage.push(candidates[0]);id=candidates[0].parent;
  if(lineage.length>64){issues.push({code:'CARD_PARENT_DEPTH',message:'Unit parent chain exceeds64'});break;}
 }
 if(objects.some(o=>o.domain==='Unit'&&!o.id&&o.isDefault&&o.fields.some(f=>f.name==='CardLayouts')))issues.push({code:'CARD_DEFAULT_LAYER_UNVERIFIED',message:'Global Unit default contains card layouts'});
 const pages=new Map<number,Map<number,CardBinding>>();
 const indexes=(fields:DataField[],hasInherited:boolean,kind:string):number[]|undefined=>{
  if(!fields.length)return [];
  const explicit=fields.filter(f=>f.index!==undefined).length;
  if(explicit&&explicit!==fields.length||!explicit&&hasInherited){issues.push({code:'CARD_ARRAY_MERGE_UNVERIFIED',message:'Mixed or derived unindexed '+kind+' require native merge evidence'});return;}
  const values=fields.map((f,i)=>f.index===undefined?i:numeric(f.index));
  if(values.some(v=>v===undefined)||new Set(values).size!==values.length){issues.push({code:'CARD_INDEX_UNVERIFIED',message:'Non-numeric or duplicate '+kind+' indexes'});return;}
  return values as number[];
 };
 for(const unit of [...lineage].reverse()){
  const layouts=unit.fields.filter(f=>f.name==='CardLayouts');if(!layouts.length)continue;
  const pageIds=indexes(layouts,pages.size>0,'CardLayouts');if(!pageIds)continue;
  for(const [i,layout]of layouts.entries()){
   const page=pageIds[i];if(removed(layout)){pages.delete(page);continue;}
   const bindings=new Map(pages.get(page)??[]),buttons=layout.children.filter(f=>f.name==='LayoutButtons');
   const slots=indexes(buttons,bindings.size>0,'LayoutButtons');if(!slots)continue;
   for(const [j,button]of buttons.entries()){
    const slot=slots[j];if(removed(button)){bindings.delete(slot);continue;}
    bindings.set(slot,{page,slot,attrs:{...bindings.get(slot)?.attrs,...button.attrs},declaredBy:unit.id!});
   }
   pages.set(page,bindings);
  }
 }
 const bindings=[...pages.values()].flatMap(p=>[...p.values()]).sort((a,b)=>a.page-b.page||a.slot-b.slot);
 const speedOwner=lineage.find(o=>o.fields.some(f=>f.name==='Speed')),speed=speedOwner?.fields.find(f=>f.name==='Speed')?.value;
 const declaredSpeed=speed!==undefined&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(speed)?{value:Number(speed),declaredBy:speedOwner!.id!}:undefined;
 return {unit:unitId,lineage:lineage.map(o=>o.id!),bindings,issues,layoutResolved:issues.length===0,...declaredSpeed?{declaredSpeed}:{}};
}
export interface CardProposal {ability:string;command?:string;button:string;page:number;slot:number;row:number;column:number;conflictReason?:string}
export function reviewCardBinding(objects:readonly DataObject[],unit:string,proposed?:CardProposal){
 const state=unitCardState(objects,unit),conflicts:CardIssue[]=[],warnings:CardIssue[]=[];
 const selected=proposed?state.bindings.find(b=>b.page===proposed.page&&b.slot===proposed.slot):undefined;
 if(proposed&&selected&&selected.attrs.AbilCmd!==proposed.ability+','+(proposed.command??'Execute'))conflicts.push({code:'CARD_SLOT_OCCUPIED',message:'Selected native slot belongs to another command',page:selected.page,slots:[selected.slot]});
 const active=state.bindings.filter(b=>!proposed||b.page!==proposed.page||b.slot!==proposed.slot);
 if(proposed)active.push({page:proposed.page,slot:proposed.slot,attrs:{Face:proposed.button,AbilCmd:proposed.ability+','+(proposed.command??'Execute'),Type:'AbilCmd',Row:String(proposed.row),Column:String(proposed.column)},declaredBy:unit});
 for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
  const a=active[i],b=active[j];if(a.page!==b.page||command(a)===command(b))continue;
  if(proposed&&a.page!==proposed.page)continue;
  if(proposed&&a.slot!==proposed.slot&&b.slot!==proposed.slot)continue;
  const pair={page:a.page,slots:[a.slot,b.slot]};
  if(a.attrs.Face&&a.attrs.Face===b.attrs.Face&&a.attrs.Type!=='Passive'&&b.attrs.Type!=='Passive')conflicts.push({...pair,code:'CARD_SHARED_BUTTON_FACE',message:'Different commands reuse one Button face; hotkey/visibility may conflict'});
  if(a.attrs.Row!==undefined&&a.attrs.Column!==undefined&&a.attrs.Row===b.attrs.Row&&a.attrs.Column===b.attrs.Column)conflicts.push({...pair,code:'CARD_COORDINATE_OCCUPIED',message:'Different commands share a visible cell; conditional availability needs an explicit reason'});
 }
 for(const b of active)if(!b.attrs.Face||b.attrs.Face.includes('##')||b.attrs.Row===undefined||b.attrs.Column===undefined)warnings.push({code:'CARD_IMPLICIT_PRESENTATION_UNRESOLVED',message:'Implicit/tokenized face or coordinate not expanded',page:b.page,slots:[b.slot]});
 if(state.declaredSpeed?.value===0&&active.some(b=>b.attrs.AbilCmd?.startsWith('move,')))warnings.push({code:'CARD_MOVE_AT_ZERO_SPEED',message:'Known inherited Speed is0: native movement commands may be hidden/unavailable. Intentional stationary units are allowed; inspect native availability.'});
 const exception=proposed?.conflictReason?.trim();
 if(proposed?.conflictReason!==undefined&&!exception)conflicts.push({code:'CARD_CONFLICT_REASON_EMPTY',message:'An intentional conditional/shared binding needs a nonempty reason'});
 const blocked=conflicts.filter(c=>c.code==='CARD_SLOT_OCCUPIED'||c.code==='CARD_CONFLICT_REASON_EMPTY'||!exception);
 return {unit,lineage:state.lineage,layoutResolved:state.layoutResolved,...state.declaredSpeed?{declaredSpeed:state.declaredSpeed}:{},accepted:state.layoutResolved&&blocked.length===0,bindings:state.bindings,conflicts,warnings,unresolved:state.issues,...exception?{exception:{reason:exception,scope:'Explicit intent only; conditional visibility/hotkey behavior still requires native verification'}}:{},nativePresentation:'not_checked' as const};
}
export class DataCardBindingError extends Error {
 readonly code='DATA_CARD_BINDING_REJECTED';
 constructor(readonly review:ReturnType<typeof reviewCardBinding>){super('DATA_CARD_BINDING_REJECTED: '+[...review.unresolved,...review.conflicts].map(c=>c.code).join(', '));}
}
export function cardReviewSummary(review:ReturnType<typeof reviewCardBinding>){
 const {bindings,lineage,conflicts,warnings,unresolved,...rest}=review;
 return {...rest,lineage:lineage.slice(0,16),bindingCount:bindings.length,conflictCount:conflicts.length,warningCount:warnings.length,unresolvedCount:unresolved.length,conflicts:conflicts.slice(0,16),warnings:warnings.slice(0,8),unresolved:unresolved.slice(0,8)};
}
