const at=(value,keys)=>keys.reduce((a,k)=>a?.[k],value);
export function resolveSuiteReferences(value,results,localIds=new Set(),depth=0){
 if(depth>40)throw Error('Suite reference depth exceeded');
 if(Array.isArray(value))return value.map(v=>resolveSuiteReferences(v,results,localIds,depth+1));
 if(value&&typeof value==='object'){
  if(Object.keys(value).length===1&&typeof value.$from==='string'){
   const [id,...keys]=value.$from.split('.');if(localIds.has(id))return globalThis.structuredClone(value);
   const result=at(results.get(id),keys);if(result===undefined)throw Error('Unresolved suite reference: '+value.$from);return globalThis.structuredClone(result);
  }
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveSuiteReferences(v,results,localIds,depth+1)]));
 }
 return value;
}
export function resolveSuiteToolArguments(tool,args,results){
 const locals=tool==='modkit.batch'&&Array.isArray(args.steps)?new Set(args.steps.map(s=>s.id)):new Set();
 return resolveSuiteReferences(args,results,locals);
}
export function suiteNeedsLive(tool,args,depth=0){
 if(depth>25)throw Error('Nested tool depth exceeded');
 if(tool==='modkit.batch'&&Array.isArray(args.steps))return args.steps.some(s=>suiteNeedsLive(s.tool,s.args??{},depth+1));
 if(tool==='project.test.run')return true;
 const metadata=tool==='editor.call'&&['sc2_modules','sc2_list_map_cameras','sc2_search_objects'].includes(args.method);
 return /^(?:editor|game)\./.test(tool)&&!['editor.status','editor.tools','editor.job','editor.cameras','game.status','game.tools'].includes(tool)&&!metadata;
}
