import {DataWorkspace} from "../data/workspace.js";
import {promises as fs} from "node:fs";
import {StringTableDocument} from "../text/stringTable.js";
import {projectPath} from "../../app/paths.js";
import {describeFunction, renderCall, registry, digest, encode, type GuiRequest} from './authoring.js';
import { randomBytes } from 'node:crypto';
import type { Workspace } from '../../core/workspace.js';
import { scanXml, decodeXmlValue } from '../../core/xmlScanner.js';
import type { XmlNode } from '../../core/types.js';
import { normalizeCustomScriptLayout } from './scriptLayout.js';

type Kind = 'Event' | 'Action';
const key = (library: string, type: string, id: string) => JSON.stringify([library,type,id]);
function graph(xml: string) {
  const parsed = scanXml(xml);
  if (parsed.diagnostics.some(d=>d.severity==='error')) throw new Error('TRIGGER_XML_INVALID: '+JSON.stringify(parsed.diagnostics.slice(0,5)));
  const libraries = parsed.nodes.filter(n=>n.tag==='Library');
  const libraryOf = (node: XmlNode): string => {
    let current: XmlNode | undefined = node;
    while (current) { if(current.tag==='Library') return current.attrs.Id ?? ''; current=current.parentId===null ? undefined : parsed.nodes[current.parentId]; }
    return '';
  };
  const elements = parsed.nodes.filter(n=>n.tag==='Element' && n.attrs.Type && n.attrs.Id).map(node=>({node,library:libraryOf(node),type:node.attrs.Type,id:node.attrs.Id,xml:xml.slice(node.start,node.end)}));
  const byKey = new Map<string,typeof elements[number]>();
  for(const element of elements) { const k=key(element.library,element.type,element.id); if(byKey.has(k)) throw new Error('TRIGGER_DUPLICATE_KEY: '+k); byKey.set(k,element); }
  const refs = (element: typeof elements[number]) => {
    const walk=(node:XmlNode):XmlNode[]=>node.childIds.flatMap(id=>[parsed.nodes[id],...walk(parsed.nodes[id])]);
    return walk(element.node).filter(n=>n.attrs.Type && n.attrs.Id).map(node=>({node,library:node.attrs.Library ?? element.library,type:node.attrs.Type,id:node.attrs.Id,key:key(node.attrs.Library ?? element.library,node.attrs.Type,node.attrs.Id)}));
  };
  return {parsed,libraries,elements,byKey,refs,libraryOf};
}
function trigger(xml: string, name: string) {
  const g=graph(xml);
  const split=name.indexOf('::'),scope=split<0?undefined:name.slice(0,split),lookup=split<0?name:name.slice(split+2);
  const matches=g.elements.filter(e=>e.type==='Trigger' && (scope===undefined||e.library===scope) && (e.id===lookup || e.node.childIds.some(id=>{const n=g.parsed.nodes[id];return n.tag==='Identifier' && decodeXmlValue(xml.slice(n.startTagEnd,n.endTagStart))===lookup;})));
  if(matches.length!==1) throw new Error(`TRIGGER_NOT_UNIQUE: ${name} (${matches.length})`);
  return {...matches[0],offset:matches[0].node.start};
}
function list(xml: string) {
  const g=graph(xml);
  return g.elements.filter(e=>e.type==='Trigger').map(e=>({id:e.id,library:e.library,identifier:e.node.childIds.map(id=>g.parsed.nodes[id]).filter(n=>n.tag==='Identifier').map(n=>decodeXmlValue(xml.slice(n.startTagEnd,n.endTagStart)))[0] ?? e.id,events:g.refs(e).filter(r=>r.node.tag==='Event').map(r=>r.id),actions:g.refs(e).filter(r=>r.node.tag==='Action').map(r=>r.id)}));
}
function libraryId(xml:string) { return graph(xml).libraries[0]?.attrs.Id ?? ''; }
function graft(target: string, source: string, sourceTrigger: string, targetTrigger: string, kind: Kind, index: number) {
  if(!Number.isInteger(index)||index<0) throw new Error('TRIGGER_INDEX_INVALID');
  const sg=graph(source),tg=graph(target),sb=trigger(source,sourceTrigger),tb=trigger(target,targetTrigger);
  const selected=sg.refs(sb).filter(r=>r.node.tag===kind)[index];
  if(!selected) throw new Error(`TRIGGER_${kind.toUpperCase()}_INDEX_MISSING`);
  if(selected.library!==sb.library) throw new Error('TRIGGER_EXTERNAL_ROOT_UNSUPPORTED');
  const closure:typeof sg.elements=[],seen=new Set<string>();
  const visit=(k:string)=>{
    if(seen.has(k))return;seen.add(k);
    const element=sg.byKey.get(k);if(!element)throw new Error('TRIGGER_DANGLING_SOURCE_REF: '+k);
    closure.push(element);
    for(const ref of sg.refs(element)){if(ref.library===sb.library)visit(ref.key);else if(sg.byKey.has(ref.key)&&!tg.byKey.has(ref.key))throw new Error('TRIGGER_CROSS_LIBRARY_RESOURCE_REQUIRED: '+ref.key);}
  };
  visit(selected.key);
  const used=new Set(tg.byKey.keys()),remap=new Map<string,string>();
  for(const e of closure){let id=e.id;while(used.has(key(tb.library,e.type,id)))id=randomBytes(4).toString('hex').toUpperCase();used.add(key(tb.library,e.type,id));remap.set(key(e.library,e.type,e.id),id);}
  const patch=(raw:string,offset:number,patches:Array<{start:number;end:number;text:string}>)=>{
    for(const p of patches.sort((a,b)=>b.start-a.start))raw=raw.slice(0,p.start-offset)+p.text+raw.slice(p.end-offset);return raw;
  };
  const encode=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&apos;').replaceAll('<','&lt;');
  const rewrite=(e:typeof closure[number])=>{
    const patches:Array<{start:number;end:number;text:string}>=[];
    const id=e.node.attrSpans.find(s=>s.name==='Id')!;
    patches.push({start:id.valueStart,end:id.valueEnd,text:remap.get(key(e.library,e.type,e.id))!});
    for(const ref of sg.refs(e)){
      if(ref.library!==sb.library)continue;
      const idSpan=ref.node.attrSpans.find(s=>s.name==='Id')!;
      patches.push({start:idSpan.valueStart,end:idSpan.valueEnd,text:remap.get(ref.key)!});
      const libSpan=ref.node.attrSpans.find(s=>s.name==='Library');
      if(libSpan)patches.push({start:libSpan.valueStart,end:libSpan.valueEnd,text:encode(tb.library)});
    }
    return patch(e.xml,e.node.start,patches);
  };
  const nl=target.includes('\r\n')?'\r\n':'\n';
  const rootId=remap.get(selected.key)!;
  const eventRef=`${nl}            <${kind} Type="${encode(selected.type)}" Library="${encode(tb.library)}" Id="${rootId}" />`;
  let updated:string;
  if(tb.node.selfClosing)updated=tb.xml.replace(/\/\s*>$/, '>')+eventRef+`</Element>`;
  else {
    const siblings=tb.node.childIds.map(id=>tg.parsed.nodes[id]);
    const same=siblings.filter(n=>n.tag===kind);
    // Append to the existing kind group. New events precede Conditions/Actions.
    const insertion=same.at(-1)?.end ?? (kind==='Event' ? siblings.find(n=>['Condition','Action'].includes(n.tag))?.start : undefined) ?? tb.node.endTagStart;
    updated=patch(tb.xml,tb.offset,[{start:insertion,end:insertion,text:eventRef}]);
  }
  for(const e of closure){
    const nodes=scanXml(e.xml).nodes;
    const localized=nodes.find(n=>(n.tag==='ValueType'&&n.attrs.Type==='text')||(n.tag==='Type'&&n.attrs.Value==='text'));
    if(localized)throw new Error('TRIGGER_LOCALIZATION_RESOURCE_REQUIRED: '+key(e.library,e.type,e.id)+'@'+localized.start);
  }
  let copied=closure.map(rewrite).join(nl);
  const open=`<TriggerData><Library Id="${encode(tb.library)}">`,close='</Library></TriggerData>';
  copied=normalizeCustomScriptLayout(open+copied+close).xml.slice(open.length,-close.length);
  const lib=tg.libraries.find(n=>n.attrs.Id===tb.library) ?? (tb.library==='' ? tg.parsed.nodes[tg.parsed.rootIds[0]] : undefined);
  if(!lib)throw new Error('TRIGGER_IMPLICIT_LIBRARY_GRAFT_UNSUPPORTED');
  const xml=patch(target,0,[{start:tb.offset,end:tb.node.end,text:updated},{start:lib.endTagStart,end:lib.endTagStart,text:copied+nl}]);
  const result=graph(xml);
  for(const e of result.elements.filter(e=>e.library===tb.library))for(const r of result.refs(e))if(r.library===tb.library&&!result.byKey.has(r.key))throw new Error('TRIGGER_DANGLING_RESULT_REF: '+r.key);
  return {xml,copied:closure.length,rootId};
}

export class TriggerWorkspace {
  constructor(private readonly workspace: Workspace,private readonly registryFile=projectPath('generated/trigger-authoring-registry.json')) {}
  private async stringFiles():Promise<string[]> {return (await fs.readdir(this.workspace.root,{withFileTypes:true})).filter(e=>e.isDirectory()&&!/^Base\.SC2Data$/i.test(e.name)&&/^[a-z]{4}\.SC2Data$/i.test(e.name)).map(e=>e.name+'/LocalizedData/TriggerStrings.txt').sort();}
  private nameKey(type:string,library:string,id:string){return type+'/Name/'+(library?'lib_'+library+'_':'')+id;}
  private async localizedNames(){const files=await this.stringFiles();const table=new Map<string,string>();for(const file of files){const raw=await this.workspace.readRaw(file);for(const entry of new StringTableDocument(raw.text).list(undefined,100000))if(!table.has(entry.key))table.set(entry.key,entry.value);}return table;}
  async labels(query='',offset=0,limit=100) {
    const {text}=await this.workspace.readRaw('Triggers'),g=graph(text);
    const localized=new Map<string,Map<string,string>>();
    for(const file of await this.stringFiles()){
      const locale=file.slice(0,4).toLowerCase(),entries=new Map<string,string>();
      const raw=await this.workspace.readRaw(file);
      for(const item of new StringTableDocument(raw.text).list(undefined,100000))entries.set(item.key,item.value);
      localized.set(locale,entries);
    }
    const native=(registry(this.registryFile).labels??[]).map(label=>({...label,source:'NativeLib97563',name:label.names.enUS??label.id}));
    const local=g.elements.filter(e=>e.type==='Label').map(e=>{
      const children=e.node.childIds.map(id=>g.parsed.nodes[id]);
      const content=(tag:string)=>{const n=children.find(n=>n.tag===tag);return n?decodeXmlValue(text.slice(n.startTagEnd,n.endTagStart)):null;};
      const nameKey=this.nameKey('Label',e.library,e.id),enUS=localized.get('enus')?.get(nameKey)??null,ruRU=localized.get('ruru')?.get(nameKey)??null;
      return {library:e.library,type:'Label',id:e.id,names:{enUS,ruRU},name:enUS??ruRU??e.id,icon:content('Icon'),color:content('Color'),source:'project'};
    });
    const all=[...native,...local],needle=query.toLowerCase();
    const selected=all.filter(l=>!needle||[l.library,l.id,l.name,l.names.ruRU??''].some(v=>v.toLowerCase().includes(needle)));
    return {total:selected.length,offset,limit,next:offset+limit<selected.length?offset+limit:null,truncated:offset+limit<selected.length,labels:selected.slice(offset,offset+limit),mutation:'UNSUPPORTED: Editor-saved FunctionCall before/after and None/default encoding required'};
  }
  async labelOf(target:{library:string;type:string;id:string}) {
    const {text}=await this.workspace.readRaw('Triggers'),g=graph(text),e=g.byKey.get(key(target.library,target.type,target.id));
    if(!e)throw new Error('TRIGGER_ELEMENT_NOT_FOUND');
    const children=e.node.childIds.map(id=>g.parsed.nodes[id]);
    const own=children.find(n=>n.tag==='Label');
    if(own)return {target,own:{library:own.attrs.Library??e.library,type:own.attrs.Type??'Label',id:own.attrs.Id},source:'explicit',effectiveStatus:'declared',mutation:'UNSUPPORTED'};
    const def=children.find(n=>n.tag==='FunctionDef');
    if(def){
      const library=def.attrs.Library??e.library,id=def.attrs.Id;
      const local=g.byKey.get(key(library,'FunctionDef',id));
      const localLabel=local?.node.childIds.map(index=>g.parsed.nodes[index]).find(n=>n.tag==='Label');
      if(localLabel)return {target,own:null,inherited:{library:localLabel.attrs.Library??library,type:localLabel.attrs.Type??'Label',id:localLabel.attrs.Id},source:'local FunctionDef',effectiveStatus:'inherited',mutation:'UNSUPPORTED'};
      const native=library==='Ntve'?registry(this.registryFile).functions.find(f=>f.id===id):undefined;
      if(native?.xml){const parsed=scanXml(native.xml),label=parsed.nodes.find(n=>n.tag==='Label');if(label)return {target,own:null,inherited:{library:label.attrs.Library??'Ntve',type:label.attrs.Type??'Label',id:label.attrs.Id},source:'verified NativeLib FunctionDef',effectiveStatus:'inherited',mutation:'UNSUPPORTED'};}
      return {target,own:null,inherited:null,source:'FunctionDef unavailable',effectiveStatus:'unknown',mutation:'UNSUPPORTED'};
    }
    return {target,own:null,inherited:null,source:'no own Label; inheritance unverified for type',effectiveStatus:'unknown',mutation:'UNSUPPORTED'};
  }
  async inspect(query?: string, offset = 0, limit = 100) {
    const { text, exists } = await this.workspace.readRaw('Triggers');
    if (!exists) return { exists: false, triggers: [] };
    const names=await this.localizedNames();
    const all = list(text).map(t=>({...t,displayName:names.get(this.nameKey("Trigger",t.library,t.id)) ?? t.identifier})), selected = query ? all.filter(t => (t.identifier+" "+t.displayName).toLowerCase().includes(query.toLowerCase())) : all;
    return { exists: true, libraryId: libraryId(text), count: all.length, matching: selected.length,total:selected.length,truncated:offset+limit<selected.length,next:offset+limit<selected.length?offset+limit:null, triggers: selected.slice(offset, offset + limit) };
  }
  async get(identifier: string, options: {includeRaw?:boolean;offset?:number;limit?:number} = {}) {
    const { text } = await this.workspace.readRaw('Triggers');
    const found = trigger(text, identifier);
    const nodes = graph(text);
    const refs = nodes.refs(found).filter(r => r.node.tag === 'Event' || r.node.tag === 'Action').map(r => ({ kind:r.node.tag, id:r.id, library:r.library, definition:nodes.byKey.get(r.key)?.xml ?? null }));
    const offset=options.offset??0,limit=options.limit??100;
    return {identifier,id:found.id,library:found.library,xml:options.includeRaw ? found.xml : found.xml.slice(0,16384),xmlTruncated:!options.includeRaw&&found.xml.length>16384,total:refs.length,next:offset+limit<refs.length?offset+limit:null,truncated:offset+limit<refs.length,references:refs.slice(offset,offset+limit).map(r=>({...r,definition:options.includeRaw?r.definition:r.definition?.slice(0,4096)??null,definitionTruncated:!options.includeRaw&&(r.definition?.length??0)>4096}))};
  }
  async graft(args: { sourceFile: string; sourceTrigger: string; targetTrigger: string; kind: Kind; index: number; dryRun?: boolean; stage?: boolean }) {
    this.workspace.resolveUserPath(args.sourceFile);
    let result: ReturnType<typeof graft> | undefined;
    const transaction = await this.workspace.applyRawTransaction(this.workspace.coupledDraftFiles(['Triggers']), async files => {
      const source = (await this.workspace.readRaw(args.sourceFile)).text;
      result = graft(files.get('Triggers')!, source, args.sourceTrigger, args.targetTrigger, args.kind, args.index);
      return new Map([...files,['Triggers', result.xml]]);
    }, { dryRun: args.dryRun ?? true, stage: args.stage ?? true, requireExisting: true, summary: `Graft ${args.kind} ${args.index} from ${args.sourceTrigger} into ${args.targetTrigger}` });
    return { ...transaction, copiedElements: result?.copied, eventOrActionId: result?.rootId };
  }
  private readonly plans = new Map<string,{before:string;xml:string;schema:string;root:string;strings:Map<string,string>;stringRevisions:Map<string,string>;catalogRevision?:string}>();
  searchFunctions(query='',offset=0,limit=50){
    const r=registry(this.registryFile),needle=query.toLowerCase(),all=(r.definitions??r.functions).filter(f=>f.name.toLowerCase().includes(needle));
    return {total:all.length,offset,truncated:offset+limit<all.length,next:offset+limit<all.length?offset+limit:null,items:all.slice(offset,offset+limit).map(f=>({library:f.library,id:f.id,name:f.name,flags:f.flags,returnType:(f as typeof f & {returnType?:string}).returnType,parameters:f.parameters.map(p=>({id:p.id,name:p.name,type:p.type,gameType:p.gameType})),serializerSupported:r.functions.some(x=>x.id===f.id)})),source:r.source,sha256:r.sha256,editor:'NOT_RUN'};
  }
  describeFunction(name:string) { return describeFunction(name,registry(this.registryFile)); }
  async validate() {
    const {text}=await this.workspace.readRaw('Triggers');const g=graph(text);
    const issues=g.elements.flatMap(e=>g.refs(e).filter(r=>r.library===e.library&&!g.byKey.has(r.key)).map(r=>({code:'TRIGGER_DANGLING_REFERENCE',key:r.key,offset:r.node.start})));
    return {valid:issues.length===0,issues,scope:'XML and local typed graph',externalLibraries:[...new Set(g.elements.flatMap(e=>g.refs(e).filter(r=>r.library!==e.library).map(r=>r.library)))],compiler:'NOT_EXECUTED'};
  }
  private async catalogRevision(values?:Array<{domain:string;id:string}>) {
    const records=await new DataWorkspace(this.workspace).catalog();
    if(records.issues.length)throw new Error('GUI_GAMELINK_COVERAGE_UNKNOWN');
    for(const value of values??[]){const matches=records.flatMap(r=>r.engineActive===false?[]:r.document.objects()).filter(o=>o.domain===value.domain&&o.id===value.id);if(!matches.length)throw new Error('GUI_GAMELINK_UNRESOLVED: '+value.domain+':'+value.id);}
    return digest(records.map(r=>r.absolute+'\0'+r.document.sha256+'\0'+r.engineActive).sort().join('\n'));
  }
  async plan(request:GuiRequest) {
    if(request.calls.length>100)throw new Error('GUI_BATCH_LIMIT');
    const gamelinks=request.calls.flatMap(c=>Object.values(c.args).filter(v=>v.kind==='gamelink')) as Array<{kind:'gamelink';domain:string;id:string}>;
    const catalogRevision=gamelinks.length?await this.catalogRevision(gamelinks):undefined;
    const before=(await this.workspace.readRaw('Triggers')).text;
    let xml=before;
    const g=graph(xml),used=new Set(g.elements.map(e=>e.id));
    const nextId=()=>{let id:string;do{id=randomBytes(4).toString('hex').toUpperCase();}while(used.has(id));used.add(id);return id;};
    let target=request.targetTrigger;
    const names:Array<{key:string;value:string}>=[];
    if(request.create){
      if(target)throw new Error('GUI_TARGET_CONFLICT');
      const c=request.create,lib=g.libraries.filter(n=>n.attrs.Id===c.library);
      if(lib.length!==1)throw new Error('GUI_LIBRARY_NOT_UNIQUE');
      const id=nextId();target=id;names.push({key:this.nameKey("Trigger",c.library,id),value:c.identifier});
      const item=`<Item Type="Trigger" Library="${encode(c.library)}" Id="${id}"/>`;
      let fragment=`<Element Type="Trigger" Id="${id}"><Identifier>${encode(c.identifier)}</Identifier></Element>`;
      const root=g.parsed.nodes.find(n=>n.tag==='Root'&&n.parentId===lib[0].id);
      if(c.category){const cat=nextId();names.push({key:this.nameKey("Category",c.library,cat),value:c.category});fragment=`<Element Type="Category" Id="${cat}"><Identifier>${encode(c.category)}</Identifier>${item}</Element>`+fragment;const categoryItem=`<Item Type="Category" Library="${encode(c.library)}" Id="${cat}"/>`;if(root){xml=xml.slice(0,root.start)+(root.selfClosing?xml.slice(root.start,root.startTagEnd).replace(/\/\s*>$/,'>')+categoryItem+'</Root>':xml.slice(root.start,root.endTagStart)+categoryItem+'</Root>')+xml.slice(root.end);}else fragment='<Root>'+categoryItem+'</Root>'+fragment;}
      else if(root){xml=xml.slice(0,root.start)+(root.selfClosing?xml.slice(root.start,root.startTagEnd).replace(/\/\s*>$/,'>')+item+'</Root>':xml.slice(root.start,root.endTagStart)+item+'</Root>')+xml.slice(root.end);}else fragment='<Root>'+item+'</Root>'+fragment;
      const current=graph(xml).libraries.find(n=>n.attrs.Id===c.library)!;
      xml=xml.slice(0,current.endTagStart)+fragment+xml.slice(current.endTagStart);
    }
    if(!target)throw new Error('GUI_TARGET_MISSING');
    for(const call of request.calls){
      const block=trigger(xml,target),rendered=renderCall(call,block.library,nextId,xml,registry(this.registryFile));
      const library=graph(xml).libraries.find(n=>n.attrs.Id===block.library)!;
      xml=xml.slice(0,library.endTagStart)+rendered.elements+xml.slice(library.endTagStart);
      const current=trigger(xml,target),parsed=graph(xml).parsed;
      const same=current.node.childIds.map(id=>parsed.nodes[id]).filter(n=>n.tag===call.kind);
      const siblings=current.node.childIds.map(id=>parsed.nodes[id]);
      const insertion=same.at(-1)?.end ?? (call.kind==='Event'?siblings.find(n=>['Condition','Action'].includes(n.tag))?.start:call.kind==='Condition'?siblings.find(n=>n.tag==='Action')?.start:undefined) ?? current.node.endTagStart;
      const reference=`<${call.kind} Type="FunctionCall" Library="${encode(block.library)}" Id="${rendered.id}"/>`;
      if(current.node.selfClosing)xml=xml.slice(0,current.offset)+current.xml.replace(/\/\s*>$/,'>')+reference+'</Element>'+xml.slice(current.node.end);
      else xml=xml.slice(0,insertion)+reference+xml.slice(insertion);
    }
    const result=graph(xml);
    for(const e of result.elements)for(const r of result.refs(e))if(r.library===e.library&&!result.byKey.has(r.key))throw new Error('GUI_PLAN_DANGLING_REFERENCE: '+r.key);
    const strings=new Map<string,string>(),stringRevisions=new Map<string,string>();
    const stringFiles=request.stringFiles ?? (names.length ? await this.stringFiles() : []);
    if(names.length&&!stringFiles.length)stringFiles.push('enUS.SC2Data/LocalizedData/TriggerStrings.txt');
    for(const file of stringFiles){
      if(/^Base\.SC2Data\//i.test(file)||!/^[a-z]{4}\.SC2Data\/LocalizedData\/TriggerStrings\.txt$/i.test(file))throw new Error('GUI_STRING_FILE_SCOPE_INVALID');
      const source=(await this.workspace.readRaw(file)).text,table=new StringTableDocument(source);stringRevisions.set(file,digest(source));
      for(const entry of names)table.set(entry.key,entry.value);strings.set(file,table.source);
    }
    const planId=randomBytes(16).toString('hex');
    this.plans.set(planId,{before:digest(before),xml,schema:digest(JSON.stringify(registry(this.registryFile))),root:this.workspace.root,strings,stringRevisions,catalogRevision});
    while(this.plans.size>32||[...this.plans.values()].reduce((bytes,p)=>bytes+Buffer.byteLength(p.xml)+[...p.strings.values()].reduce((n,s)=>n+Buffer.byteLength(s),0),0)>32*1024*1024)this.plans.delete(this.plans.keys().next().value!);
    if(!this.plans.has(planId))throw new Error('GUI_PLAN_BYTE_LIMIT');
    return {planId,revision:digest(before),triggerId:target,calls:request.calls.length,sourceOfTruth:'Triggers',regenerateGalaxyInEditor:true,compiler:'NOT_EXECUTED'};
  }
  async applyPlan(planId:string,dryRun=true,stage=true) {
    const plan=this.plans.get(planId);if(!plan)throw new Error('GUI_PLAN_NOT_FOUND');
    if(plan.root!==this.workspace.root||plan.schema!==digest(JSON.stringify(registry(this.registryFile))))throw new Error('GUI_PLAN_CONTEXT_STALE');
    return this.workspace.applyRawTransaction(this.workspace.coupledDraftFiles(['Triggers',...plan.strings.keys()]),async files=>{
      if(plan.catalogRevision&&await this.catalogRevision()!==plan.catalogRevision)throw new Error('GUI_PLAN_DEPENDENCY_STALE');
      const schemaSource=await this.workspace.readDependency(this.registryFile);
      if(digest(JSON.stringify(JSON.parse(schemaSource)))!==plan.schema)throw new Error('GUI_PLAN_SCHEMA_STALE');
      if(digest(files.get('Triggers')!)!==plan.before)throw new Error('GUI_PLAN_SOURCE_STALE');
      for(const [file,revision]of plan.stringRevisions)if(digest(files.get(file)??'')!==revision)throw new Error('GUI_PLAN_STRINGS_STALE: '+file);
      graph(plan.xml);return new Map([...files,['Triggers',plan.xml],...plan.strings]);
    },{dryRun,stage,summary:'Apply typed GUI authoring plan'});
  }

  save(backup = true) { return this.workspace.save('Triggers', { backup }); }
  async normalizeScriptLayout(dryRun = true, stage = true) {
    let result: ReturnType<typeof normalizeCustomScriptLayout> | undefined;
    const transaction = await this.workspace.applyRawTransaction(this.workspace.coupledDraftFiles(['Triggers']), async files => {
      result = normalizeCustomScriptLayout(files.get('Triggers')!);
      return new Map([...files,['Triggers', result.xml]]);
    }, { dryRun, stage, requireExisting: true, summary: 'Normalize editor ScriptCode indentation; preserve all trigger elements and references' });
    return { ...transaction, changedScriptBlocks: result?.changedScriptBlocks, ownerIds: result?.ownerIds };
  }
  discard() { return this.workspace.discard('Triggers'); }
}
