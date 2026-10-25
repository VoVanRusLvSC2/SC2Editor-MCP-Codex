import type {PhysicalAssetEntry} from './types.js';

/** Preserve first-source metadata and ordered provenance without rescanning
 * every accumulated reference when many catalog objects share one asset. */
export function mergeAssetEntries(entries:Iterable<PhysicalAssetEntry>):PhysicalAssetEntry[]{
 const assets=new Map<string,{value:PhysicalAssetEntry;references?:Set<string>;evidence?:Set<PhysicalAssetEntry['evidence'][number]>}>();
 for(const asset of entries){
  const key=`${asset.sourceLayer}:${asset.dependency}:${asset.path}`.toLowerCase(),prior=assets.get(key);
  if(!prior){assets.set(key,{value:asset});continue;}
  if(!prior.references){
   const first=prior.value;prior.references=new Set();prior.evidence=new Set(first.evidence);
   prior.value={...first,referencedBy:[],evidence:[...prior.evidence]};
   for(const reference of first.referencedBy){const encoded=JSON.stringify(reference);if(!prior.references.has(encoded)){prior.references.add(encoded);prior.value.referencedBy.push(JSON.parse(encoded));}}
  }
  for(const reference of asset.referencedBy){const encoded=JSON.stringify(reference);if(!prior.references.has(encoded)){prior.references.add(encoded);prior.value.referencedBy.push(JSON.parse(encoded));}}
  for(const evidence of asset.evidence)if(!prior.evidence!.has(evidence)){prior.evidence!.add(evidence);prior.value.evidence.push(evidence);}
 }
 return [...assets.values()].map(entry=>entry.value).sort((a,b)=>a.path.localeCompare(b.path));
}
