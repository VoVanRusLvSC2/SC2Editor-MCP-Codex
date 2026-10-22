/** RFC 6901 traversal over owned JSON reports, with bounded on-demand previews. */
export function nativeReportPage(report:unknown,pointer:string,offset:number,limit:number){
 if(pointer&&(!pointer.startsWith('/')||/~(?![01])/u.test(pointer)))throw Error('NATIVE_DETAILS_POINTER_INVALID');
 let value:any=report;
 for(const encoded of pointer?pointer.slice(1).split('/'):[]){
  const key=encoded.replaceAll('~1','/').replaceAll('~0','~');
  if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))throw Error('NATIVE_DETAILS_PATH_MISSING');
  value=value[key];
 }
 const preview=(v:any)=>{
  const bytes=Buffer.byteLength(JSON.stringify(v));
  if(bytes<=2000)return {value:v,truncated:false};
  if(typeof v==='string')return {value:v.slice(0,400),totalCharacters:v.length,truncated:true};
  if(Array.isArray(v))return {kind:'array',total:v.length,truncated:true};
  return {kind:'object',keys:Object.keys(v).slice(0,12),total:Object.keys(v).length,truncated:true};
 };
 if(Array.isArray(value))return {path:pointer,kind:'array',total:value.length,offset,items:value.slice(offset,offset+limit).map(preview),nextOffset:offset+limit<value.length?offset+limit:null};
 if(value&&typeof value==='object'){
  const entries=Object.entries(value);
  return {path:pointer,kind:'object',total:entries.length,offset,entries:entries.slice(offset,offset+limit).map(([key,value])=>({key,...preview(value)})),nextOffset:offset+limit<entries.length?offset+limit:null};
 }
 return {path:pointer,kind:'scalar',...preview(value)};
}
