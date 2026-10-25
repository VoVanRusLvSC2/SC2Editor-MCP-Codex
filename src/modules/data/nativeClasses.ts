import type {DataDiagnostic,DataObject} from './types.js';

// Exact original-Editor load controls, not an interpretation of XSD abstract flags.
// Named default=1 and CWeaponLegacy controls passed in the same owned worker.
export const nativeWeaponClassObservation=Object.freeze({
 ctype:'CWeapon',editorBuild:'5.0.17.98310',toolkitVersion:'1.0.0',date:'2026-10-25',
 ordinaryNamedEntry:'refused',namedDefault:'supported',concreteAlternative:'CWeaponLegacy',
 editorSha256:'e561d76903221bdcd4585b9496bba1d2b9c5ae13b8fbe8c8469d213f22823d91',
 ordinaryReportSha256:'3515401112ffe539fb5858983031307c3d99a07a8704e73f543191a27e032b35',
 defaultReportSha256:'e5e91f325a8b53131fb54cc1cc22c9b65fe55c20e07170e14197f7f81e87dbd2',
 concreteReportSha256:'cf568110c47e1f21f537a700e9317c265ad0903e1c382669b27a467bc428f382',
 scope:'Native load/Data diagnostics; not execution or a general abstract-class registry',
});

export function nativeClassObservations(ctype?:string){
 return !ctype||ctype.toLowerCase()==='cweapon'?[nativeWeaponClassObservation]:[];
}

export function nativeClassInstanceFinding(object:DataObject,file:string):DataDiagnostic|undefined{
 // Only proven ordinary entries are rejected. Explicit/dynamic template markers
 // keep their existing schema/native validation; imported bytes are never rewritten.
 if(object.ctype!=='CWeapon'||!object.id||![undefined,'0','false'].includes(object.attrs.default))return;
 return {
  level:'L2',severity:'error',code:'DATA_NATIVE_CLASS_INSTANCE_REFUSED',file,path:`${object.ctype}:${object.id}`,
  message:'DATA_NATIVE_CLASS_INSTANCE_REFUSED: the observed SC2 5.0.17.98310 Editor refuses ordinary named CWeapon entries. Use a concrete class such as CWeaponLegacy; keep default=1 only for an intentional default template.',
  reference:{kind:'native-class-load-observation',value:nativeWeaponClassObservation.ordinaryReportSha256},
 };
}
