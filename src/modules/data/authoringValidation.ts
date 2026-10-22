import { DataDocument, referenceSchema } from './document.js';
import type { DataDiagnostic, DataField, DataObject, DataReference } from './types.js';
import type { DataXsdField, DataXsdType } from './xsdRegistry.js';
import {parentClassCompatibility} from './parentClasses.js';
import {concreteActorCreateConflict} from './actorConstruction.js';
import {dataDomainFromType} from './domains.js';

interface RecordView { file:string; layer:'workspace'|'dependency'; engineActive?:boolean; document:DataDocument }
export interface DataAuthoringVerdict {
  status:'VERIFIED_STATIC'|'REJECTED'|'INCOMPLETE';
  accepted:boolean;
  parse:'PASS';completeness:'COMPLETE'|'INCOMPLETE';executionPolicy:'STRICT'|'COMPATIBILITY';
  staticValidation:'PASS'|'FAIL'|'INCOMPLETE';
  editor:'NOT_RUN'; runtime:'NOT_RUN';
  diagnostics:DataDiagnostic[];
  scope:string;
}

const key=(o:DataObject)=>`${o.ctype}\0${o.id ?? ''}`;
const pathOf=(o:DataObject,field?:DataField)=>`${o.ctype}:${o.id ?? '<default>'}${field?'.'+field.path:''}`;
const diagnostic=(code:string,message:string,file:string,path:string,level:DataDiagnostic['level']='L4'):DataDiagnostic=>({code,message,file,path,level,severity:'error'});
const fieldIdentity=(field:DataField,index:number)=>`${field.name}\0${field.index ?? ''}\0${field.ordinal ?? index}`;
const changed=(field:DataField,old?:DataField)=>!old||field.value!==old.value||field.link!==old.link||JSON.stringify(field.attrs)!==JSON.stringify(old.attrs);

function scalarType(type:string|DataXsdType|undefined):DataXsdType|undefined {
  if(!type)return undefined;
  return typeof type==='string'?referenceSchema.describe(type.replace(/^.*:/,'')):type;
}
function validateScalar(value:string,type:string|DataXsdType|undefined,file:string,path:string,out:DataDiagnostic[],seen=new Set<string>()):void {
  if(!type||value.includes('##'))return;
  const name=typeof type==='string'?type:type.name;
  if(seen.has(name))return;seen.add(name);
  const declared=scalarType(type);
  if(declared){
    if(declared.enumValues.length&&!declared.enumValues.includes(value))out.push(diagnostic('DATA_AUTHOR_ENUM_INVALID',`'${value}' is not a declared ${declared.name} value`,file,path));
    for(const facet of declared.facets){
      if(facet.kind==='pattern'){
        try{if(!new RegExp(`^(?:${facet.value})$`).test(value))out.push(diagnostic('DATA_AUTHOR_VALUE_PATTERN',`'${value}' does not match ${declared.name}`,file,path));}catch{out.push(diagnostic('DATA_AUTHOR_SCHEMA_PATTERN_UNSUPPORTED',`Cannot evaluate ${declared.name} pattern`,file,path));}
      }
      if(['minInclusive','maxInclusive','minExclusive','maxExclusive'].includes(facet.kind)){
        const actual=Number(value),bound=Number(facet.value);
        if(!Number.isFinite(actual)||(facet.kind==='minInclusive'&&actual<bound)||(facet.kind==='maxInclusive'&&actual>bound)||(facet.kind==='minExclusive'&&actual<=bound)||(facet.kind==='maxExclusive'&&actual>=bound))out.push(diagnostic('DATA_AUTHOR_VALUE_FACET',`'${value}' violates ${facet.kind}=${facet.value}`,file,path));
      }
    }
    if(declared.base)validateScalar(value,declared.base,file,path,out,seen);
    return;
  }
  if(name==='xs:boolean'&&!['true','false','0','1'].includes(value))out.push(diagnostic('DATA_AUTHOR_BOOLEAN_INVALID',`'${value}' is not xs:boolean`,file,path));
  if(/^xs:(?:int|integer|long|short|byte|unsignedInt|unsignedLong|unsignedShort|unsignedByte)$/.test(name)&&!/^[-+]?\d+$/.test(value))out.push(diagnostic('DATA_AUTHOR_INTEGER_INVALID',`'${value}' is not an integer`,file,path));
  if(/^xs:(?:decimal|float|double)$/.test(name)&&!Number.isFinite(Number(value)))out.push(diagnostic('DATA_AUTHOR_NUMBER_INVALID',`'${value}' is not numeric`,file,path));
}
function memberType(member:DataXsdField):string|DataXsdType|undefined {return member.inlineType ?? member.type;}
function validateAttributes(attrs:Record<string,string>,owner:string|DataXsdType,file:string,path:string,out:DataDiagnostic[],oldAttrs:Record<string,string>={},tokens:ReadonlyMap<string,string>=new Map()):void {
  const members=referenceSchema.members(owner);
  for(const [name,value] of Object.entries(attrs)){
    if(oldAttrs[name]===value)continue;
    const member=members.find(m=>m.kind==='attribute'&&m.name===name);
    if(!member){if(tokens.has(name)){validateScalar(value,tokens.get(name)||undefined,file,`${path}@${name}`,out);continue;}out.push(diagnostic('DATA_AUTHOR_ATTRIBUTE_UNKNOWN',`Attribute '${name}' is absent from declared ${typeof owner==='string'?owner:owner.name}`,file,`${path}@${name}`));continue;}
    validateScalar(value,memberType(member),file,`${path}@${name}`,out);
  }
}

/** Root token overrides are native attributes declared by this entry/parent chain,
 * not arbitrary extensions to the XSD. Keep their catalog-link types for validation. */
function inheritedTokenTypes(object:DataObject,indexed:DataObject[]):Map<string,string>{
 const result=new Map<string,string>(),queue=[object],seen=new Set<string>();
 for(let i=0;i<queue.length;i++){
  const o=queue[i];for(const name of new Set([...Object.keys(o.tokens??{}),...Object.keys(o.tokenTypes??{})]))if(!result.has(name))result.set(name,o.tokenTypes?.[name]??'');
  const parent=o.domain+'\0'+o.parent;if(!o.parent||seen.has(parent))continue;seen.add(parent);
  queue.push(...indexed.filter(p=>p.domain===o.domain&&p.id===o.parent));
 }
 return result;
}
function validateFields(fields:DataField[],oldFields:DataField[],owner:string|DataXsdType,file:string,object:DataObject,out:DataDiagnostic[]):void {
  const members=referenceSchema.members(owner);
  for(let index=0;index<fields.length;index++){
    const field=fields[index],old=oldFields.find((candidate,i)=>fieldIdentity(candidate,i)===fieldIdentity(field,index));
    if(old&&!changed(field,old)&&JSON.stringify(field.children)===JSON.stringify(old.children))continue;
    const member=members.find(m=>m.kind==='element'&&m.name===field.name);
    if(!member){out.push(diagnostic('DATA_AUTHOR_FIELD_UNKNOWN',`Field '${field.name}' is absent from declared ${typeof owner==='string'?owner:owner.name}`,file,pathOf(object,field)));continue;}
    const type=memberType(member);
    if(changed(field,old)){
      if(field.value!==undefined&&!referenceSchema.members(type ?? '').some(m=>m.kind==='attribute'&&m.name===(field.attrs.Value!==undefined?'Value':'value')))out.push(diagnostic('DATA_AUTHOR_VALUE_UNDECLARED',`Field '${field.name}' has no declared value attribute`,file,pathOf(object,field)));
      if(field.link!==undefined&&!referenceSchema.members(type ?? '').some(m=>m.kind==='attribute'&&m.name==='Link'))out.push(diagnostic('DATA_AUTHOR_LINK_UNDECLARED',`Field '${field.name}' has no declared Link attribute`,file,pathOf(object,field)));
      if(type)validateAttributes(field.attrs,type,file,pathOf(object,field),out,old?.attrs);
    }
    if(type)validateFields(field.children,old?.children??[],type,file,object,out);
    else if(field.children.length)out.push(diagnostic('DATA_AUTHOR_CHILD_TYPE_UNKNOWN',`Cannot validate children of '${field.name}'`,file,pathOf(object,field)));
  }
}

export function validateDataAuthoring(file:string,before:DataDocument,after:DataDocument,records:RecordView[],coverageIssues:Array<{code:string;reason:string}>,external:ReadonlyMap<string,ReadonlySet<string>>=new Map()):DataAuthoringVerdict {
  const diagnostics:DataDiagnostic[]=[];
  const originals=before.objects(),current=after.objects();
  const indexed=records.filter(r=>r.engineActive!==false).flatMap(r=>r.document.objects());
  const incomplete=coverageIssues.length>0||records.some(r=>r.engineActive===undefined);
  for(const object of current){
    const old=originals.find(o=>key(o)===key(object));
    if(old&&JSON.stringify({attrs:old.attrs,fields:old.fields})===JSON.stringify({attrs:object.attrs,fields:object.fields}))continue;
    const parents=object.parent?indexed.filter(parent=>parent.id===object.parent&&parent.domain===object.domain):[];
    if(concreteActorCreateConflict(object,parents))diagnostics.push(diagnostic('DATA_ACTOR_CONCRETE_PARENT_CREATE','Concrete unit actor plus a second UnitBirth Create binding; use recipe.unitActor',file,pathOf(object)+'@parent','L3'));
    if(parents.length&&parents.every(parent=>parentClassCompatibility(object.ctype,parent.ctype)==='incompatible'))diagnostics.push(diagnostic('DATA_PARENT_CLASS_INCOMPATIBLE',`${object.ctype} cannot inherit '${object.parent}' (${parents[0].ctype}); use the native parent's class`,file,pathOf(object)+'@parent','L3'));
    const declared=referenceSchema.describe(object.ctype);
    if(!declared){diagnostics.push(diagnostic('DATA_AUTHOR_TYPE_UNKNOWN',`Type '${object.ctype}' is absent from the indexed XSD`,file,pathOf(object)));continue;}
    if(!old||JSON.stringify(old.attrs)!==JSON.stringify(object.attrs)){
      const tokens=inheritedTokenTypes(object,indexed);
      validateAttributes(object.attrs,object.ctype,file,pathOf(object),diagnostics,old?.attrs,tokens);
      for(const [name,type]of tokens){
        const value=object.attrs[name],domain=/^C[A-Za-z]+Link$/.test(type)?dataDomainFromType(type):undefined;
        if(!domain||!value||value===old?.attrs[name])continue;
        if(value.includes('##'))diagnostics.push(diagnostic('DATA_AUTHOR_REFERENCE_DYNAMIC',`Cannot resolve authored token '${name}'`,file,pathOf(object)+'@'+name,'L3'));
        else if(!external.get(domain)?.has(value)&&!indexed.some(o=>o.domain===domain&&o.id===value))diagnostics.push(diagnostic(incomplete?'DATA_AUTHOR_REFERENCE_SCOPE_INCOMPLETE':'DATA_AUTHOR_REFERENCE_MISSING',`Authored ${domain} token '${name}' reference '${value}' does not resolve in the active catalog`,file,pathOf(object)+'@'+name,'L3'));
      }
    }
    validateFields(object.fields,old?.fields??[],object.ctype,file,object,diagnostics);
  }
  const oldRefs=new Set(before.references().map(r=>`${r.object}\0${r.path}\0${r.carrier}\0${r.value}`));
  const missing:DataReference[]=[];
  for(const ref of after.references()){
    if(oldRefs.has(`${ref.object}\0${ref.path}\0${ref.carrier}\0${ref.value}`)||!ref.value)continue;
    if(!ref.targetDomain){diagnostics.push(diagnostic('DATA_AUTHOR_REFERENCE_DOMAIN_UNKNOWN',`Authored ${ref.carrier} reference '${ref.value}' has no proven target domain`,file,ref.path,'L3'));continue;}
    if(ref.resolution==='unknown'){diagnostics.push(diagnostic('DATA_AUTHOR_REFERENCE_DYNAMIC',`Cannot resolve authored reference '${ref.rawExpression??ref.value}'`,file,ref.path,'L3'));continue;}
    if(!external.get(ref.targetDomain)?.has(ref.value)&&!indexed.some(o=>o.id===ref.value&&o.domain===ref.targetDomain))missing.push({...ref,file});
  }
  for(const ref of missing)diagnostics.push(diagnostic(incomplete?'DATA_AUTHOR_REFERENCE_SCOPE_INCOMPLETE':'DATA_AUTHOR_REFERENCE_MISSING',`Authored ${ref.targetDomain} reference '${ref.value}' does not resolve in the active catalog${incomplete?' (catalog scope incomplete)':''}`,file,ref.path,'L3'));
  const accepted=diagnostics.length===0;
  return {parse:'PASS',completeness:incomplete?'INCOMPLETE':'COMPLETE',executionPolicy:'STRICT',status:accepted?(incomplete?'INCOMPLETE':'VERIFIED_STATIC'):incomplete&&diagnostics.every(d=>d.code==='DATA_AUTHOR_REFERENCE_SCOPE_INCOMPLETE')?'INCOMPLETE':'REJECTED',accepted,staticValidation:accepted?'PASS':incomplete?'INCOMPLETE':'FAIL',editor:'NOT_RUN',runtime:'NOT_RUN',diagnostics,scope:'XSD declarations and typed references in the active loaded catalog; Editor and runtime not executed'};
}

export class DataAuthoringError extends Error {
  readonly code='DATA_AUTHORING_REJECTED';
  constructor(readonly verdict:DataAuthoringVerdict){super(`DATA_AUTHORING_${verdict.status}: ${verdict.diagnostics.slice(0,5).map(d=>`${d.code} ${d.path}: ${d.message}`).join('; ')}`);}
}
