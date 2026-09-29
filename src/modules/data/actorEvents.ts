import type {XmlNode} from '../../core/types.js';
export interface ActorEdge {value:string;domain:string;start:number;end:number;raw:string;unknown:boolean}
export interface ActorIssue {targetDomain?:string;code:string;offset:number}
/** Explicit event selectors/texture messages only; not an actor-message interpreter. */
export function actorEvents(source:string,entry:XmlNode,nodes:XmlNode[],resolve:(raw:string)=>string) {
 const references:ActorEdge[]=[],issues:ActorIssue[]=[];
 if(!/^CActor/.test(entry.tag))return {references,issues};
 for(const on of nodes.filter(n=>n.tag==='On'&&n.start>entry.start&&n.end<entry.end)){
  for(const carrier of ['Terms','Send','Target']){
   const values:Array<{raw:string;start:number}>=[];
   const attr=on.attrSpans.find(a=>a.name===carrier);if(attr)values.push({raw:source.slice(attr.valueStart,attr.valueEnd),start:attr.valueStart});
   for(const child of on.childIds.map(id=>nodes[id]).filter(n=>n.tag===carrier)){
    const a=child.attrSpans.find(a=>['value','Value'].includes(a.name));
    if(a)values.push({raw:source.slice(a.valueStart,a.valueEnd),start:a.valueStart});
    else if(!child.selfClosing)values.push({raw:source.slice(child.startTagEnd,child.endTagStart),start:child.startTagEnd});
   }
   for(const value of values){
    const pattern=carrier==='Terms'?/\b(UnitBirth|UnitDeath|UnitRevive|UnitMorph|Effect)\.([^\s.;]+)/g:carrier==='Send'?/\b(TextureSelectById)\s+([^\s;]+)/g:undefined;
    if(!pattern){if(value.raw&&!value.raw.startsWith('_'))issues.push({targetDomain:'Actor',code:'ACTOR_TARGET_SCOPE_UNKNOWN',offset:value.start});continue;}
    for(const m of value.raw.matchAll(pattern)){
     const domain=m[1]==='TextureSelectById'?'Texture':m[1]==='Effect'?'Effect':'Unit';
     const start=value.start+m.index!+m[0].lastIndexOf(m[2]),resolved=resolve(m[2]),unknown=resolved.includes('##')||/[&*?]/.test(resolved);
     if(unknown)issues.push({targetDomain:domain,code:'ACTOR_DYNAMIC_REFERENCE',offset:start});
     references.push({value:resolved,domain,start,end:start+m[2].length,raw:m[2],unknown});
    }
    if(carrier==='Send'&&value.raw.trim()&&!/^(Create|Destroy|TextureSelectById)\b/.test(value.raw.trim()))issues.push({code:'ACTOR_MESSAGE_SIGNATURE_UNKNOWN',offset:value.start});
    if(carrier==='Terms'&&/\b(UnitBirth|UnitDeath|UnitRevive|UnitMorph|Effect)\b(?!\.)/.test(value.raw))issues.push({targetDomain:/\bEffect\b/.test(value.raw)?'Effect':'Unit',code:'ACTOR_SELECTOR_SCOPE_UNKNOWN',offset:value.start});
   }
  }
 }
 return {references,issues};
}
