import {createHash} from 'node:crypto';
import * as z from 'zod/v4';
import { decodeXmlValue } from "../../core/xmlScanner.js";
import { readTriggerXml as scanXml } from "./preparedXml.js";
import type {XmlNode} from '../../core/types.js';

export const missionFolders=['FUNCTIONS','MAIN','GAMEPLAY','OBJECTIVES','CINEMATICS'] as const;
export const genreFolders:Record<string,string[]>={mission:[...missionFolders],coop:[...missionFolders],melee:['FUNCTIONS','MAIN','GAMEPLAY','ECONOMY','BASES','TECH','VICTORY','AI'],tower_defense:['FUNCTIONS','MAIN','GAMEPLAY','PATHS','WAVES','TOWERS','UPGRADES','LIVES'],survival:['FUNCTIONS','MAIN','GAMEPLAY','SPAWNING','WAVES','BASE_DEFENSE','SCALING','BOSSES'],rpg:['FUNCTIONS','MAIN','GAMEPLAY','HEROES','ABILITIES','QUESTS','INVENTORY','LOOT','PROGRESSION','DUNGEONS'],moba:['FUNCTIONS','MAIN','GAMEPLAY','HERO_SELECTION','LANES','CREEPS','JUNGLE','SHOPS','RESPAWN','MATCH_FLOW'],arena:['FUNCTIONS','MAIN','GAMEPLAY','LOADOUTS','ROUNDS','SCORING','RESPAWN','ARENA_EVENTS'],auto_battler:['FUNCTIONS','MAIN','GAMEPLAY','DRAFT','BOARD','SYNERGIES','COMBAT','ROUNDS','ECONOMY'],puzzle:['FUNCTIONS','MAIN','GAMEPLAY','PUZZLES','INTERACTIONS','ROOMS','TRAPS','HINTS','CHECKPOINTS'],racing:['FUNCTIONS','MAIN','GAMEPLAY','MOVEMENT','TRACKS','CHECKPOINTS','TIMERS','PLACEMENT'],party:['FUNCTIONS','MAIN','GAMEPLAY','MINIGAMES','ROTATION','ROUNDS','SCORING','VOTING']};
export const folderPath=z.string().max(256).regex(/^[A-Z][A-Z0-9_]*(\/[A-Z][A-Z0-9_]*)*$/).refine(v=>!v.split('/').some(s=>['OTHER','MISC','NEW_FOLDER'].includes(s)),'Catch-all folders are not allowed');
export const organizationSchema=z.object({genre:z.enum(['mission','coop','melee','tower_defense','survival','rpg','moba','arena','auto_battler','puzzle','racing','party']).default('mission'),library:z.string().max(128).default(''),folders:z.array(folderPath).max(100).default([]),assignments:z.array(z.object({type:z.enum(['Trigger','FunctionDef','Variable','CustomScript','Preset','Structure','Comment']),id:z.string().min(1).max(128),folder:folderPath}).strict()).max(1000).default([]),order:z.array(z.object({folder:folderPath,items:z.array(z.object({type:z.enum(['Category','Trigger','FunctionDef','Variable','CustomScript','Preset','Structure','Comment']),id:z.string().min(1).max(128)}).strict()).min(1).max(1000)}).strict()).max(40).default([]),dryRun:z.boolean().default(true),stage:z.boolean().default(true)}).strict();
export type OrganizationArgs=z.input<typeof organizationSchema>;
const enc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

/** Reusable folder creation for typed trigger plans, including legacy category names. */
export function ensureTriggerFolder(source:string,library:string,path:string,nextId:()=>string,names:ReadonlyMap<string,string>=new Map()){
 if(!path||path.length>256||path.split('/').some(s=>!s.trim()||s==='.'||s==='..'))throw new Error('GUI_FOLDER_PATH_INVALID');
 let xml=source,parentId:string|undefined;const created:Array<{id:string;name:string}>=[];
 const append=(node:XmlNode,text:string)=>{xml=node.selfClosing?xml.slice(0,node.start)+xml.slice(node.start,node.startTagEnd).replace(/\/\s*>$/,'>')+text+`</${node.tag}>`+xml.slice(node.end):xml.slice(0,node.endTagStart)+text+xml.slice(node.endTagStart);};
 const scope=()=>{const p=scanXml(xml),matches=p.nodes.filter(n=>library?n.tag==='Library'&&n.attrs.Id===library:n.tag==='TriggerData'&&n.parentId===null);if(matches.length!==1)throw new Error('GUI_FOLDER_SCOPE_NOT_UNIQUE');return {p,container:matches[0]};};
 for(const name of path.split('/')){
  let {p,container}=scope(),parent=parentId?p.nodes.find(n=>n.tag==='Element'&&n.attrs.Type==='Category'&&n.attrs.Id===parentId&&n.parentId===container.id):p.nodes.find(n=>n.tag==='Root'&&n.parentId===container.id);
  if(!parent){append(container,'<Root/>');({p,container}=scope());parent=p.nodes.find(n=>n.tag==='Root'&&n.parentId===container.id)!;}
  const candidates=parent.childIds.map(i=>p.nodes[i]).filter(n=>n.tag==='Item'&&n.attrs.Type==='Category'&&(n.attrs.Library??library)===library).flatMap(ref=>p.nodes.filter(n=>n.tag==='Element'&&n.attrs.Type==='Category'&&n.attrs.Id===ref.attrs.Id&&n.parentId===container.id)).filter(n=>names.get('Category/Name/'+(library?'lib_'+library+'_':'')+n.attrs.Id)===name||n.childIds.map(i=>p.nodes[i]).some(c=>c.tag==='Identifier'&&decodeXmlValue(xml.slice(c.startTagEnd,c.endTagStart))===name));
  if(candidates.length>1)throw new Error('GUI_FOLDER_DUPLICATE: '+name);if(candidates.length){parentId=candidates[0].attrs.Id;continue;}
  const id=nextId();append(parent,`<Item Type="Category"${library?` Library="${enc(library)}"`:''} Id="${id}"/>`);append(scope().container,`<Element Type="Category" Id="${id}"><Identifier>${enc(name)}</Identifier></Element>`);created.push({id,name});parentId=id;
 }
 return {xml,id:parentId!,created};
}

/** Edit only category definitions and Item references; executable elements stay byte-identical. */
export function organizeTriggerXml(source:string,input:OrganizationArgs,names:ReadonlyMap<string,string>=new Map()){
 const args=organizationSchema.parse(input),created:Array<{id:string;name:string;path:string}>=[],moved:Array<{type:string;id:string;folder:string}>=[];
 let xml=source||'<TriggerData><Root/></TriggerData>';
 const parse=()=>{const p=scanXml(xml);if(p.diagnostics.some(d=>d.severity==='error'))throw new Error('ORGANIZATION_XML_INVALID');const containers=p.nodes.filter(n=>args.library?n.tag==='Library'&&n.attrs.Id===args.library:n.tag==='TriggerData'&&n.parentId===null);if(containers.length!==1)throw new Error('ORGANIZATION_SCOPE_NOT_UNIQUE');const scope=containers[0];const children=scope.childIds.map(id=>p.nodes[id]);return {p,scope,children};};
 const append=(node:XmlNode,value:string)=>{xml=node.selfClosing?xml.slice(0,node.start)+xml.slice(node.start,node.startTagEnd).replace(/\/\s*>$/,'>')+value+`</${node.tag}>`+xml.slice(node.end):xml.slice(0,node.endTagStart)+value+xml.slice(node.endTagStart);};
 const item=(type:string,id:string)=>`<Item Type="${enc(type)}"${args.library?` Library="${enc(args.library)}"`:''} Id="${enc(id)}"/>`;
 const tree=()=>{
  const {p,scope,children}=parse(),elements=children.filter(n=>n.tag==='Element'),byKey=new Map<string,XmlNode>();
  for(const n of elements){const k=n.attrs.Type+':'+n.attrs.Id;if(byKey.has(k))throw new Error('ORGANIZATION_DUPLICATE_ID: '+k);byKey.set(k,n);}
  const root=children.find(n=>n.tag==='Root'),paths=new Map<string,XmlNode>(),owners=new Map<string,XmlNode>();
  const walk=(parent:XmlNode,path:string,stack:Set<string>)=>{for(const id of parent.childIds){const n=p.nodes[id];if(n.tag!=='Item'||(n.attrs.Library??args.library)!==args.library)continue;const k=n.attrs.Type+':'+n.attrs.Id;if(owners.has(k))throw new Error('ORGANIZATION_MULTIPLE_OWNERS: '+k);owners.set(k,parent);if(n.attrs.Type==='Library')continue;const target=byKey.get(k);if(!target)throw new Error('ORGANIZATION_DANGLING_ITEM: '+k);if(n.attrs.Type==='Category'){if(stack.has(k))throw new Error('ORGANIZATION_CATEGORY_CYCLE');const nameNode=target.childIds.map(i=>p.nodes[i]).find(x=>x.tag==='Identifier');const name=nameNode?decodeXmlValue(xml.slice(nameNode.startTagEnd,nameNode.endTagStart)):(names.get('Category/Name/'+(args.library?'lib_'+args.library+'_':'')+target.attrs.Id)??target.attrs.Id);const full=path?path+'/'+name:name;if(paths.has(full))throw new Error('ORGANIZATION_DUPLICATE_FOLDER: '+full);paths.set(full,target);walk(target,full,new Set([...stack,k]));}}};
  if(root)walk(root,'',new Set());
  for(const n of elements.filter(n=>n.attrs.Type==='Category'))if(!owners.has('Category:'+n.attrs.Id))throw new Error('ORGANIZATION_ORPHAN_CATEGORY: '+n.attrs.Id);
  return {p,scope,root,elements,byKey,paths,owners};
 };
 const mission=args.genre==='mission'||args.genre==='coop';
 const explicit=[...args.folders,...args.assignments.map(a=>a.folder),...args.order.map(a=>a.folder)];
 const requested=explicit.length?explicit:tree().paths.size?[]:[...(mission?missionFolders:['FUNCTIONS','MAIN','GAMEPLAY'])];
 for(const path of requested){folderPath.parse(path);const parts=path.split('/');for(let i=1;i<=parts.length;i++){
  const full=parts.slice(0,i).join('/');let t=tree();if(t.paths.has(full))continue;
  const used=new Set(t.elements.map(e=>e.attrs.Id));let counter=0,id:string;do{id=createHash('sha256').update(args.library+':'+full+':'+counter++).digest('hex').slice(0,8).toUpperCase();}while(used.has(id));
  if(!t.root){append(t.scope,'<Root/>');t=tree();}
  const parent=i===1?t.root!:t.paths.get(parts.slice(0,i-1).join('/'))!;append(parent,item('Category',id));
  const current=parse();append(current.scope,`<Element Type="Category" Id="${id}"><Identifier>${enc(parts[i-1])}</Identifier></Element>`);created.push({id,name:parts[i-1],path:full});
 }}
 for(const assignment of args.assignments){let t=tree();const key=assignment.type+':'+assignment.id;if(!t.byKey.has(key))throw new Error('ORGANIZATION_ELEMENT_MISSING: '+key);const target=t.paths.get(assignment.folder)!;const owner=t.owners.get(key);if(owner?.attrs.Id===target.attrs.Id)continue;
  if(owner){const ref=owner.childIds.map(i=>t.p.nodes[i]).find(n=>n.tag==='Item'&&n.attrs.Type===assignment.type&&n.attrs.Id===assignment.id&&(n.attrs.Library??args.library)===args.library)!;xml=xml.slice(0,ref.start)+xml.slice(ref.end);}
  t=tree();append(t.paths.get(assignment.folder)!,item(assignment.type,assignment.id));moved.push(assignment);
 }
 for(const order of args.order){const t=tree(),folder=t.paths.get(order.folder)!,refs=folder.childIds.map(i=>t.p.nodes[i]).filter(n=>n.tag==='Item'),keys=order.items.map(i=>i.type+':'+i.id);if(new Set(keys).size!==keys.length)throw new Error('ORGANIZATION_DUPLICATE_ORDER');const keyOf=(n:XmlNode)=>n.attrs.Type+':'+n.attrs.Id;for(const k of keys)if(!refs.some(n=>keyOf(n)===k&&(n.attrs.Library??args.library)===args.library))throw new Error('ORGANIZATION_ORDER_MEMBER_NOT_IN_FOLDER: '+k);const sorted=[...keys.map(k=>refs.find(n=>keyOf(n)===k)!),...refs.filter(n=>!keys.includes(keyOf(n)))],texts=sorted.map(n=>xml.slice(n.start,n.end));for(let i=refs.length-1;i>=0;i--)xml=xml.slice(0,refs[i].start)+texts[i]+xml.slice(refs[i].end);}
 {const t=tree();if(t.root){const refs=t.root.childIds.map(i=>t.p.nodes[i]).filter(n=>n.tag==='Item'&&n.attrs.Type==='Category'&&(n.attrs.Library??args.library)===args.library);const rank=new Map((genreFolders[args.genre]??[...missionFolders]).map((name,i)=>[t.paths.get(name)?.attrs.Id,i]));const known=refs.filter(n=>rank.has(n.attrs.Id));const sorted=[...known].sort((a,b)=>rank.get(a.attrs.Id)!-rank.get(b.attrs.Id)!);const replacements=sorted.map(n=>xml.slice(n.start,n.end));for(let i=known.length-1;i>=0;i--)xml=xml.slice(0,known[i].start)+replacements[i]+xml.slice(known[i].end);}}
 const t=tree(),issues:string[]=[];
 for(const n of t.elements){if(t.root&&t.owners.get(n.attrs.Type+':'+n.attrs.Id)===t.root&&['Trigger','FunctionDef','Variable','CustomScript','Preset','Structure'].includes(n.attrs.Type))issues.push('ROOT_ELEMENT: '+n.attrs.Type+':'+n.attrs.Id);if(['Trigger','FunctionDef','Variable','CustomScript','Preset','Structure'].includes(n.attrs.Type)&&!t.owners.has(n.attrs.Type+':'+n.attrs.Id)){
  // Local variables and nested definitions are owned by executable elements, not folders.
  const referenced=t.p.nodes.some(r=>r.tag!=='Element'&&r.tag!=='Item'&&r.attrs.Type===n.attrs.Type&&r.attrs.Id===n.attrs.Id&&(r.attrs.Library??args.library)===args.library);
  if(!referenced)issues.push('UNASSIGNED: '+n.attrs.Type+':'+n.attrs.Id);
 }}
 return {xml,created,moved,folders:[...t.paths].map(([path,n])=>({path,id:n.attrs.Id})),issues,changed:xml!==source};
}
