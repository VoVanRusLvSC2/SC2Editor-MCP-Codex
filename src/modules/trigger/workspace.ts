import {organizeTriggerXml,ensureTriggerFolder,organizationSchema,type OrganizationArgs} from './organization.js';
import {dataDomainFromType} from '../data/domains.js';
import {skirmishRecipe,type SkirmishOptions} from './recipes/skirmish.js';
import {ScriptWorkspace} from '../script/workspace.js';
import {emitGuiGalaxy} from './runtime.js';
import {TriggerLibraries} from './libraries.js';
import type {CascWorkspace} from '../casc/workspace.js';
import {GUI_TYPE_CODES,GUI_VARIABLE_TYPES,definitionsFor} from './typeSystem.js';
import {DataWorkspace} from "../data/workspace.js";
import {promises as fs} from "node:fs";
import {StringTableDocument} from "../text/stringTable.js";
import {projectPath} from "../../app/paths.js";
import {describeFunction, renderCalls, registry, registryDigest, registrySourceDigest, digest, encode, type GuiRequest, type GuiText, functionSupport, registrationSupport, inspectGuiVariables, validateGuiRequestSize, collectGuiValues, inspectGuiFunctions, withGuiFunctions, resolveFunction} from './authoring.js';
import {triggerPlanSchema} from './schemas.js';
import {declareVariables} from './variables.js';
import {declareGuiTypes} from './declarations.js';
import {declareFunctions,populateFunctions} from './functions.js';
import {PlacementDocument} from '../placement/document.js';
import { randomBytes } from 'node:crypto';
import { Workspace } from '../../core/workspace.js';
import { scanXml, decodeXmlValue } from '../../core/xmlScanner.js';
import type { XmlNode } from '../../core/types.js';
import { normalizeCustomScriptLayout } from './scriptLayout.js';
import {upsertCustomScripts,customScriptsSchema,type CustomScriptsArgs} from './customScripts.js';
import {inspectRevisedGui} from './revisedImport.js';
import {bindNativeGuiContext} from './nativeImport.js';
import type {NativeGuiEvidence} from '../../integrations/native/guiEvidence.js';

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
  nativeGuiArtifact?: (jobId:string)=>Promise<NativeGuiEvidence>;
  constructor(private readonly workspace: Workspace,private readonly registryFile=projectPath('generated/trigger-authoring-registry.json'),private readonly data=new DataWorkspace(workspace),private readonly casc?:CascWorkspace) {this.libraries=new TriggerLibraries(workspace,data,casc);}
  private readonly libraries:TriggerLibraries;
  private async stringFiles():Promise<string[]> {return (await fs.readdir(this.workspace.root,{withFileTypes:true})).filter(e=>e.isDirectory()&&!/^Base\.SC2Data$/i.test(e.name)&&/^[a-z]{4}\.SC2Data$/i.test(e.name)).map(e=>e.name+'/LocalizedData/TriggerStrings.txt').sort();}
  private nameKey(type:string,library:string,id:string){return type+'/Name/'+(library?'lib_'+library+'_':'')+id;}
  async organize(input:OrganizationArgs){
    const args=organizationSchema.parse(input),raw=await this.workspace.readRaw('Triggers'),organized=organizeTriggerXml(raw.text,args,await this.localizedNames());
    const locales=await this.stringFiles();if(!locales.length)locales.push('enUS.SC2Data/LocalizedData/TriggerStrings.txt');
    const transaction=await this.workspace.applyRawTransaction(this.workspace.coupledDraftFiles(['Triggers',...locales]),files=>{
      if(digest(files.get('Triggers')??'')!==digest(raw.text))throw new Error('ORGANIZATION_SOURCE_STALE');
      const next=new Map(files);next.set('Triggers',organized.xml);
      for(const file of locales){const table=new StringTableDocument(files.get(file)??'');for(const folder of organized.created)table.set(this.nameKey('Category',args.library,folder.id),folder.name);next.set(file,table.source);}
      return next;
    },{dryRun:args.dryRun,stage:args.stage,backup:true,summary:'Organize GUI folders without changing executable elements'});
    return {...organized,xml:undefined,transaction,compiler:'NOT_EXECUTED',sourceOfTruth:'Triggers'};
  }
  async customScripts(input:CustomScriptsArgs){
    const args=customScriptsSchema.parse(input),raw=await this.workspace.readRaw('Triggers'),result=upsertCustomScripts(raw.text,args,await this.localizedNames()),locales=await this.stringFiles();
    if(!locales.length)locales.push('enUS.SC2Data/LocalizedData/TriggerStrings.txt');
    const transaction=await this.workspace.applyRawTransaction(this.workspace.coupledDraftFiles(['Triggers',...locales]),files=>{
      if(digest(files.get('Triggers')??'')!==digest(raw.text))throw new Error('GUI_CUSTOM_SCRIPT_SOURCE_STALE');
      const next=new Map(files);next.set('Triggers',result.xml);
      for(const file of locales){const table=new StringTableDocument(files.get(file)??'');for(const folder of result.created)table.set(this.nameKey('Category','',folder.id),folder.name);for(const label of result.labels)table.set(label.key,label.value);next.set(file,table.source);}
      return next;
    },{dryRun:args.dryRun,stage:args.stage,backup:true,summary:'Author visible Custom Script declarations/actions in GUI folders'});
    return {...result,xml:undefined,transaction,compiler:'NOT_EXECUTED',sourceOfTruth:'Triggers',rawScript:true};
  }
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
    const functions=[...new Set(['',...graph(text).libraries.map(n=>n.attrs.Id??'')])].flatMap(library=>inspectGuiFunctions(text,library)).map(f=>({id:f.id,name:f.name,library:f.library,flags:f.flags,returnType:f.returnType,parameters:f.parameters.map(p=>({id:p.id,name:p.name,type:p.type}))}));
    return { exists: true, functions, libraryId: libraryId(text), variables:[...new Set(['',...graph(text).libraries.map(n=>n.attrs.Id??'')])].flatMap(library=>inspectGuiVariables(text,library)), count: all.length, matching: selected.length,total:selected.length,truncated:offset+limit<selected.length,next:offset+limit<selected.length?offset+limit:null, triggers: selected.slice(offset, offset + limit) };
  }
  async get(identifier: string, options: {includeRaw?:boolean;offset?:number;limit?:number} = {}) {
    const { text } = await this.workspace.readRaw('Triggers');
    const found = trigger(text, identifier);
    const nodes = graph(text);
    const refs = nodes.refs(found).filter(r => r.node.tag === 'Event' || r.node.tag === 'Condition' || r.node.tag === 'Action').map(r => ({ kind:r.node.tag, id:r.id, library:r.library, definition:nodes.byKey.get(r.key)?.xml ?? null }));
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
  private readonly plans = new Map<string,{before:string;xml:string;schema:string;schemaFile:string;root:string;strings:Map<string,string>;stringRevisions:Map<string,string>;catalogRevision?:string;objectsRevision?:string;libraryRevision?:string;needsCatalogs?:boolean}>();
  searchFunctions(query='',offset=0,limit=50){
    const r=registry(this.registryFile),needle=query.toLowerCase(),all=(r.definitions??r.functions).filter(f=>f.name.toLowerCase().includes(needle));
    return {total:all.length,offset,truncated:offset+limit<all.length,next:offset+limit<all.length?offset+limit:null,items:all.slice(offset,offset+limit).map(f=>({library:f.library,id:f.id,name:f.name,flags:f.flags,returnType:(f as typeof f & {returnType?:string}).returnType,parameters:f.parameters.map(p=>({id:p.id,name:p.name,type:p.type,gameType:p.gameType})),serializerSupported:functionSupport(f).supported,unsupportedReasons:functionSupport(f).reasons,registration:registrationSupport(f)})),source:r.source,sha256:r.sha256,editor:'NOT_RUN'};
  }
  describeFunction(name:string) { return describeFunction(name,registry(this.registryFile)); }
  async searchAvailableFunctions(query='',offset=0,limit=10,library='',registrationOnly=false) {
    const raw=await this.workspace.readRaw('Triggers'),context=await this.libraries.context(registry(this.registryFile)),r=withGuiFunctions(context.registry,raw.text,library),needle=query.toLowerCase();
    const all=(r.definitions??r.functions).filter(f=>f.name.toLowerCase().includes(needle)&&(!registrationOnly||f.flags.includes('FlagEvent')));
    return {total:all.length,offset,next:offset+limit<all.length?offset+limit:null,items:all.slice(offset,offset+limit).map(f=>({id:f.id,name:f.name,library:f.library,source:f.origin==='map'?'map':f.library==='Ntve'?'NativeLib':'dependency',flags:f.flags,returnType:f.returnType,parameters:f.parameters.map(p=>({name:p.name,type:p.type,gameType:p.gameType})),supported:functionSupport(f).supported,registration:registrationSupport(f)})),libraries:context.libraries,libraryCacheHit:context.cacheHit,compiler:'NOT_EXECUTED'};
  }
  async describeFunctions(names:string[],library='',presetLimit=12){
    if(!names.length||names.length>40)throw new Error('GUI_DESCRIBE_BATCH_LIMIT');
    const context=await this.libraries.context(registry(this.registryFile)),xml=(await this.workspace.readRaw('Triggers')).text,r=withGuiFunctions(context.registry,xml,library);
    return {cacheHit:context.cacheHit,libraryRevision:context.revision,items:names.map(name=>{try{const f=resolveFunction(name,r);return {name:f.name,id:f.id,library:f.library,roles:f.flags.filter(v=>['FlagEvent','FlagAction','FlagCall','FlagCondition'].includes(v)),returnType:f.returnGuiType,parameters:f.parameters.map(p=>({name:p.name,id:p.id,type:p.type,gameType:p.gameType,typeElement:p.typeElement,flags:p.flags,hasDefault:!!p.defaultXml,presets:p.presets?.slice(0,presetLimit),presetCount:p.presets?.length??0,presetsTruncated:(p.presets?.length??0)>presetLimit})),support:functionSupport(f),registration:registrationSupport(f)};}catch(error){return {name,error:error instanceof Error?error.message:String(error)};}})};
  }
  async runtimeSourceForPreview(file='Triggers'){
    const raw=await this.workspace.readRaw(file),context=await this.libraries.context(registry(this.registryFile));
    return {...emitGuiGalaxy(raw.text,context.registry),sourceFile:file,sourceSha256:digest(raw.text),librarySources:context.sources,registryRevision:context.revision};
  }
  async generateRuntime(dryRun=true,stage=true){
    const raw=await this.workspace.readRaw('Triggers'),context=await this.libraries.context(registry(this.registryFile)),generated=emitGuiGalaxy(raw.text,context.registry);
    const validation=await new ScriptWorkspace(this.workspace).validateSource(generated.source);if(!validation.valid)throw new Error('GUI_RUNTIME_STATIC_ERRORS: '+JSON.stringify(validation.diagnostics.filter(d=>d.severity==='error').slice(0,10)));
    const transaction=await this.workspace.applyRawTransaction(this.workspace.coupledDraftFiles(['Triggers','MapScript.galaxy']),files=>{if(digest(files.get('Triggers')!)!==digest(raw.text))throw new Error('GUI_RUNTIME_SOURCE_STALE');const next=new Map(files);next.set('MapScript.galaxy',generated.source);return next;},{dryRun,stage,backup:true,summary:'Generate playable Galaxy from the same GUI graph'});
    return {...generated,source:undefined,sourceBytes:Buffer.byteLength(generated.source),sourceSha256:digest(generated.source),transaction,validation,converterUsed:false};
  }
  recipeSkirmish(options:SkirmishOptions){return this.planBatch(skirmishRecipe(options));}
  async importRevised(args:{file:string;stringsFile?:string;nativeJobId?:string;expectedSourceSha256:string;expectedRuntimeSha256:string;dryRun:boolean;stage:boolean}):Promise<{counts:ReturnType<typeof inspectRevisedGui>;validation:unknown;transaction:Awaited<ReturnType<Workspace['applyRawTransaction']>>;inputSha256:string;runtimeSha256:string;semanticEquivalence:string;compiler:string;nativeContext:unknown}>{
    if(!this.workspace.trackingReads)return this.workspace.withReadSet(()=>this.importRevised(args));
    const input=await this.workspace.readRaw(args.file),source=await this.workspace.readRaw('Triggers'),runtime=await this.workspace.readRaw('MapScript.galaxy');
    if(digest(source.text)!==args.expectedSourceSha256||digest(runtime.text)!==args.expectedRuntimeSha256)throw new Error('GUI_IMPORT_SOURCE_STALE');
    const counts=inspectRevisedGui(input.text,{nativeLibraries:!!args.nativeJobId,localLibraries:!args.nativeJobId});
    let generated:{source:string},validation:unknown,nativeContext:unknown;
    if(args.nativeJobId){
      if(!this.nativeGuiArtifact)throw Error('GUI_NATIVE_COMPILER_NOT_CONFIGURED: use a profile with editor and script');
      const proof=await this.nativeGuiArtifact(args.nativeJobId);
      if(proof.xmlSha256!==digest(input.text))throw Error('GUI_NATIVE_XML_MISMATCH');
      const bound=await bindNativeGuiContext(this.workspace,proof);generated={source:bound.source};nativeContext=bound.context;
      validation={valid:true,compiler:'ORIGINAL_EDITOR',jobId:args.nativeJobId,scope:'Exact XML and matching template components; gameplay equivalence is separate'};
    }else{
      const context=await this.libraries.context(registry(this.registryFile));generated=emitGuiGalaxy(input.text,context.registry);
      const checked=await new ScriptWorkspace(this.workspace).validateSource(generated.source);validation=checked;
      if(!checked.valid)throw new Error('GUI_IMPORT_RUNTIME_ERRORS: '+JSON.stringify(checked.diagnostics.filter(d=>d.severity==='error').slice(0,10)));
    }
    const strings=args.stringsFile?await this.workspace.readRaw(args.stringsFile):undefined;
    const labels:Record<string,string>=strings?JSON.parse(strings.text):{};
    if(Array.isArray(labels)||typeof labels!=='object'||labels===null||Object.keys(labels).length>10000||Object.entries(labels).some(([k,v])=>!/^(Category|Trigger|FunctionDef|Variable|ParamDef)\/Name\/(?:lib_[A-Za-z0-9]+_)?[A-Fa-f0-9]+$/.test(k)||typeof v!=='string'||/[\r\n]/.test(v)))throw new Error('GUI_IMPORT_LABELS');
    const locales=await this.stringFiles();if(!locales.length)locales.push('enUS.SC2Data/LocalizedData/TriggerStrings.txt');
    const files=['Triggers','MapScript.galaxy',args.file,...(args.stringsFile?[args.stringsFile]:[]),...locales];
    const transaction=await this.workspace.applyRawTransaction(this.workspace.coupledDraftFiles(files),files=>{
      if(digest(files.get('Triggers')??'')!==args.expectedSourceSha256||digest(files.get('MapScript.galaxy')??'')!==args.expectedRuntimeSha256||files.get(args.file)!==input.text||(args.stringsFile&&files.get(args.stringsFile)!==strings!.text))throw new Error('GUI_IMPORT_SOURCE_STALE');
      const next=new Map(files);next.set('Triggers',input.text);next.set('MapScript.galaxy',generated.source);
      for(const file of locales){const table=new StringTableDocument(files.get(file)??'');for(const [key,value]of Object.entries(labels))table.set(key,value);next.set(file,table.source);}return next;
    },{dryRun:args.dryRun,stage:args.stage,backup:true,summary:'Import reviewed full GUI tree and generate its runtime atomically'});
    return {counts,validation,transaction,inputSha256:digest(input.text),runtimeSha256:digest(generated.source),semanticEquivalence:'NOT_PROVEN',compiler:args.nativeJobId?'NATIVE_PASSED':'NOT_EXECUTED',nativeContext};
  }
  async planFile(file:string){const raw=await this.workspace.readRaw(file);if(!raw.exists&&!raw.staged)throw new Error('GUI_PLAN_FILE_MISSING');if(Buffer.byteLength(raw.text)>1024*1024)throw new Error('GUI_PLAN_FILE_BYTE_LIMIT');const value=JSON.parse(raw.text);return Array.isArray(value)?this.planBatch(value):this.plan(value);}
  async planBatch(requests:GuiRequest[]){
    if(!requests.length||requests.length>100||Buffer.byteLength(JSON.stringify(requests))>1024*1024)throw new Error('GUI_PLAN_BATCH_LIMIT');
    const source=this.workspace;
    class PlanningWorkspace extends Workspace {override async readRaw(file:string,includeDraft=true){const own=await super.readRaw(file,includeDraft);return own.staged?own:source.readRaw(file,includeDraft);}}
    const virtual=new PlanningWorkspace(source.root),data=new DataWorkspace(virtual,this.data.schema,[...this.data.extraRoots]),planner=new TriggerWorkspace(virtual,this.registryFile,data,this.casc),steps=[];
    data.nativeCatalogFiles=this.data.nativeCatalogFiles;
    for(const root of this.data.extraRoots){const profile=this.data.nativePackageProfile(root);if(profile)data.addDependencyRoot(root,profile);}
    let last:NonNullable<ReturnType<typeof planner.plans.get>>|undefined,objectsRevision:string|undefined,catalogRevision:string|undefined,needsCatalogs=false;
    for(const request of requests){const step=await planner.plan(request);const saved=planner.plans.get(step.planId)!;objectsRevision??=saved.objectsRevision;catalogRevision??=saved.catalogRevision;needsCatalogs ||= !!saved.needsCatalogs;await planner.applyPlan(step.planId,false,true);last=saved;steps.push(step);}
    const strings=new Map<string,string>(),stringRevisions=new Map<string,string>();for(const file of virtual.draftFiles()){if(file==='Triggers')continue;strings.set(file,(await virtual.readRaw(file)).text);stringRevisions.set(file,digest((await source.readRaw(file)).text));}
    const planId=randomBytes(16).toString('hex'),before=digest((await source.readRaw('Triggers')).text),context=await this.libraries.context(registry(this.registryFile),needsCatalogs);
    this.plans.set(planId,{...last!,before,xml:(await virtual.readRaw('Triggers')).text,root:source.root,strings,stringRevisions,objectsRevision,catalogRevision,needsCatalogs,libraryRevision:context.revision});
    return {planId,revision:before,steps:steps.length,triggerIds:steps.map(s=>s.triggerId).filter(Boolean),variables:steps.flatMap(s=>s.variables),functions:steps.flatMap(s=>s.functions),presets:steps.flatMap(s=>s.presets),structures:steps.flatMap(s=>s.structures),calls:steps.reduce((n,s)=>n+s.calls,0),customResourceLibraryCreated:false,compiler:'NOT_EXECUTED',sourceFilesStaged:false};
  }
  async describeAvailableFunction(name:string,library='') {
    const raw=await this.workspace.readRaw('Triggers'),context=await this.libraries.context(registry(this.registryFile)),r=withGuiFunctions(context.registry,raw.text,library);
    if(!name.startsWith('custom:')&&!inspectGuiFunctions(raw.text,library).some(f=>f.id===name||f.name===name)){const f=resolveFunction(name,r);return {...f,xml:undefined,support:functionSupport(f),registration:registrationSupport(f),compiler:'NOT_EXECUTED'};}
    const f=resolveFunction(name,r);return {...f,xml:undefined,support:functionSupport(f),registration:registrationSupport(f),arguments:'Parameter IDs or unique names',compiler:'NOT_EXECUTED'};
  }
  async types(query='',offset=0,limit=30,library=''){
    const context=await this.libraries.context(registry(this.registryFile)),xml=(await this.workspace.readRaw('Triggers')).text,defs=definitionsFor(xml,library,context.registry),needle=query.toLowerCase();
    const all=[...GUI_TYPE_CODES.map(code=>({kind:'type',name:code,variable:GUI_VARIABLE_TYPES.includes(code as typeof GUI_VARIABLE_TYPES[number])})),...defs.presets.map(p=>({kind:'preset',name:p.name??p.id,id:p.id,library:p.library,baseType:p.baseType,asBits:p.asBits,members:p.values.length})),...defs.structures.map(s=>({kind:'record',name:s.name??s.id,id:s.id,library:s.library,fields:s.variables.map(ref=>{const f=defs.variables.find(v=>v.id===ref.id&&v.library===(ref.library??s.library));return {id:ref.id,name:f?.name,type:f?.variableType,arraySizes:f?.arraySizes};})}))].filter(v=>!needle||JSON.stringify(v).toLowerCase().includes(needle));
    return {total:all.length,offset,next:offset+limit<all.length?offset+limit:null,items:all.slice(offset,offset+limit),libraries:context.libraries,cacheHit:context.cacheHit,compiler:'NOT_EXECUTED'};
  }
  async validate() {
    const {text}=await this.workspace.readRaw('Triggers');const g=graph(text);
    const issues=g.elements.flatMap(e=>g.refs(e).filter(r=>r.library===e.library&&!g.byKey.has(r.key)).map(r=>({code:'TRIGGER_DANGLING_REFERENCE',key:r.key,offset:r.node.start})));
    return {valid:issues.length===0,issues,scope:'XML and local typed graph (not a compiler)',externalLibraries:[...new Set(g.elements.flatMap(e=>g.refs(e).filter(r=>r.library!==e.library).map(r=>r.library)))],compiler:'NOT_EXECUTED'};
  }
  private async catalogRevision(values?:Array<{domain:string;id:string}>) {
    const records=await this.data.catalog();
    if(records.issues.length)throw new Error('GUI_GAMELINK_COVERAGE_UNKNOWN');
    for(const value of values??[]){const matches=records.flatMap(r=>r.engineActive===false&&r.dependencyAvailability!=='DECLARED_AVAILABLE'||!r.document.source.includes(value.id)?[]:r.document.entries()).filter(o=>dataDomainFromType(o.tag)===value.domain&&o.attrs.id===value.id);if(!matches.length)throw new Error('GUI_GAMELINK_UNRESOLVED: '+value.domain+':'+value.id);}
    return digest(records.map(r=>r.absolute+'\0'+r.document.sha256+'\0'+r.engineActive+'\0'+r.dependencyAvailability).sort().join('\n'));
  }
  async plan(request:GuiRequest) {
    validateGuiRequestSize(request);
    request=triggerPlanSchema.parse(request);
    const values=collectGuiValues(request);
    const gamelinks=values.filter(v=>v.kind==='gamelink') as Array<{kind:'gamelink';domain:string;id:string}>;
    const unitValues=values.filter(v=>v.kind==='unit') as Array<{kind:'unit';objectId:number}>;
    let objectsRevision:string|undefined;
    if(unitValues.length){
      const raw=(await this.workspace.readRaw('Objects')).text,objects=new PlacementDocument(raw);
      if(objects.validate().some(d=>d.severity==='error'))throw new Error('GUI_OBJECTS_INVALID');
      for(const value of unitValues)if(!objects.list().some(o=>o.kind==='ObjectUnit'&&o.id===value.objectId))throw new Error('GUI_PLACED_UNIT_UNRESOLVED: '+value.objectId);
      objectsRevision=digest(raw);
    }
    const libraryContext=await this.libraries.context(registry(this.registryFile),gamelinks.length>0),schema=libraryContext.registry;
    const catalogRevision=gamelinks.length?await this.catalogRevision(gamelinks):undefined;
    const before=(await this.workspace.readRaw('Triggers')).text;
    let xml=before;
    const g=graph(xml),used=new Set([...g.elements.map(e=>e.id),...(schema.definitions??schema.functions).map(f=>f.id)]);
    const nextId=()=>{let id:string;do{id=randomBytes(4).toString('hex').toUpperCase();}while(used.has(id));used.add(id);return id;};
    const container=(g:ReturnType<typeof graph>,library:string)=>{
      const nodes=library ? g.libraries.filter(n=>n.attrs.Id===library) : g.parsed.rootIds.map(id=>g.parsed.nodes[id]).filter(n=>n.tag==='TriggerData');
      if(nodes.length!==1)throw new Error(library?'GUI_LIBRARY_NOT_UNIQUE':'GUI_ROOT_NOT_UNIQUE');
      return nodes[0];
    };
    const append=(source:string,node:XmlNode,fragment:string)=>node.selfClosing
      ? source.slice(0,node.start)+source.slice(node.start,node.startTagEnd).replace(/\/\s*>$/,'>')+fragment+`</${node.tag}>`+source.slice(node.end)
      : source.slice(0,node.endTagStart)+fragment+source.slice(node.endTagStart);
    let target=request.targetTrigger;
    const names:GuiText[]=[],texts:GuiText[]=[];
    if(request.create){
      if(target)throw new Error('GUI_TARGET_CONFLICT');
      const c={...request.create,library:request.create.library??''};
      if(c.category&&c.folder)throw new Error('GUI_FOLDER_CATEGORY_CONFLICT');
      let folderId:string|undefined;
      if(c.folder||c.category){const folders=ensureTriggerFolder(xml,c.library,c.folder??c.category!,nextId,await this.localizedNames());xml=folders.xml;folderId=folders.id;for(const folder of folders.created)names.push({key:this.nameKey('Category',c.library,folder.id),value:folder.name});}
      const currentGraph=graph(xml),lib=container(currentGraph,c.library);
      const localLibrary=c.library ? ` Library="${encode(c.library)}"` : '';
      const id=nextId();target=id;names.push({key:this.nameKey("Trigger",c.library,id),value:c.identifier,translations:c.translations});
      const item=`<Item Type="Trigger"${localLibrary} Id="${id}"/>`;
      let fragment=`<Element Type="Trigger" Id="${id}"><Identifier>${encode(c.identifier)}</Identifier></Element>`;
      const root=currentGraph.parsed.nodes.find(n=>n.tag==='Root'&&n.parentId===lib.id);
      if(folderId){const folder=currentGraph.byKey.get(key(c.library,'Category',folderId))!;xml=append(xml,folder.node,item);}
      else if(root){xml=xml.slice(0,root.start)+(root.selfClosing?xml.slice(root.start,root.startTagEnd).replace(/\/\s*>$/,'>')+item+'</Root>':xml.slice(root.start,root.endTagStart)+item+'</Root>')+xml.slice(root.end);}else fragment='<Root>'+item+'</Root>'+fragment;
      const current=container(graph(xml),c.library);
      xml=append(xml,current,fragment);
    }
    if(!target&&(request.calls.length||request.variables?.some(v=>v.scope==='local')))throw new Error('GUI_TARGET_MISSING');
    const scope=target?trigger(xml,target).library:'';
    const userTypes=declareGuiTypes(xml,request,scope,nextId,schema,text=>texts.push(text));xml=userTypes.xml;names.push(...userTypes.names);
    const headers=declareFunctions(xml,request.functions??[],scope,nextId,schema);xml=headers.xml;names.push(...headers.names);
    const declared=declareVariables(xml,request.variables??[],scope,target,nextId,withGuiFunctions(schema,xml,scope),text=>texts.push(text));
    xml=declared.xml;names.push(...declared.names);
    const bodies=populateFunctions(xml,request.functions??[],headers.functions,scope,nextId,schema,text=>texts.push(text));xml=bodies.xml;names.push(...bodies.names);
    if(request.calls.length){
      const block=trigger(xml,target!),rendered=renderCalls(request.calls,block.library,nextId,xml,withGuiFunctions(schema,xml,scope),{triggerId:block.id,onText:text=>texts.push(text)});
      xml=append(xml,container(graph(xml),block.library),rendered.elements);
      for(const kind of ['Event','Condition','Action'] as const){
        const references=rendered.references.filter(ref=>ref.kind===kind).map(ref=>`<${kind} Type="FunctionCall"${scope?` Library="${encode(scope)}"`:''} Id="${ref.id}"/>`).join('');if(!references)continue;
        const current=trigger(xml,target!),parsed=graph(xml).parsed,siblings=current.node.childIds.map(id=>parsed.nodes[id]);
        const insertion=siblings.filter(n=>n.tag===kind).at(-1)?.end??(kind==='Event'?siblings.find(n=>['Condition','Action'].includes(n.tag))?.start:kind==='Condition'?siblings.find(n=>n.tag==='Action')?.start:undefined)??current.node.endTagStart;
        if(current.node.selfClosing)xml=xml.slice(0,current.offset)+current.xml.replace(/\/\s*>$/,'>')+references+'</Element>'+xml.slice(current.node.end);
        else xml=xml.slice(0,insertion)+references+xml.slice(insertion);
      }
    }
    if(request.create?.folder){
      const folder=request.create.folder,tree=graph(xml),lib=container(tree,scope),root=tree.parsed.nodes.find(n=>n.tag==='Root'&&n.parentId===lib.id);
      const allowed=['Trigger','FunctionDef','Variable','CustomScript','Preset','Structure','Comment'] as const;
      const assignments=(root?.childIds??[]).map(i=>tree.parsed.nodes[i]).filter(n=>n.tag==='Item'&&allowed.includes(n.attrs.Type as typeof allowed[number])&&!g.byKey.has(key(scope,n.attrs.Type,n.attrs.Id))).map(n=>({type:n.attrs.Type as typeof allowed[number],id:n.attrs.Id,folder}));
      const organized=organizeTriggerXml(xml,{genre:request.create.genre,library:scope,folders:[folder],assignments},await this.localizedNames());xml=organized.xml;
      for(const f of organized.created)names.push({key:this.nameKey('Category',scope,f.id),value:f.name});
    }
    const result=graph(xml);
    for(const e of result.elements)for(const r of result.refs(e))if(r.library===e.library&&!result.byKey.has(r.key))throw new Error('GUI_PLAN_DANGLING_REFERENCE: '+r.key);
    const strings=new Map<string,string>(),stringRevisions=new Map<string,string>();
    const stringFiles=request.stringFiles ?? (names.length ? await this.stringFiles() : []);
    if((names.length||texts.length)&&!stringFiles.length)stringFiles.push('enUS.SC2Data/LocalizedData/TriggerStrings.txt');
    const requestedLocales=new Set([...names,...texts].flatMap(n=>Object.keys(n.translations??{})));
    for(const locale of requestedLocales)if(!stringFiles.some(f=>f.startsWith(locale+'.SC2Data/')))stringFiles.push(locale+'.SC2Data/LocalizedData/TriggerStrings.txt');
    for(const file of [...new Set(stringFiles)]){
      if(/^Base\.SC2Data\//i.test(file)||!/^[a-z]{4}\.SC2Data\/LocalizedData\/TriggerStrings\.txt$/i.test(file))throw new Error('GUI_STRING_FILE_SCOPE_INVALID');
      const source=(await this.workspace.readRaw(file)).text,table=new StringTableDocument(source);stringRevisions.set(file,digest(source));
      const locale=file.slice(0,4);
      for(const entry of [...names,...texts])table.set(entry.key,entry.translations?.[locale]??entry.value);strings.set(file,table.source);
      if(texts.length){
        const gameFile=file.replace(/TriggerStrings\.txt$/,'GameStrings.txt'),gameSource=(await this.workspace.readRaw(gameFile)).text,gameTable=new StringTableDocument(gameSource);
        stringRevisions.set(gameFile,digest(gameSource));for(const entry of texts)gameTable.set(entry.key,entry.translations?.[locale]??entry.value);strings.set(gameFile,gameTable.source);
      }
    }
    const planId=randomBytes(16).toString('hex');
    this.plans.set(planId,{before:digest(before),xml,schema:registryDigest(registry(this.registryFile)),schemaFile:registrySourceDigest(this.registryFile),root:this.workspace.root,strings,stringRevisions,catalogRevision,objectsRevision,libraryRevision:libraryContext.revision,needsCatalogs:gamelinks.length>0});
    while(this.plans.size>32||[...this.plans.values()].reduce((bytes,p)=>bytes+Buffer.byteLength(p.xml)+[...p.strings.values()].reduce((n,s)=>n+Buffer.byteLength(s),0),0)>32*1024*1024)this.plans.delete(this.plans.keys().next().value!);
    if(!this.plans.has(planId))throw new Error('GUI_PLAN_BYTE_LIMIT');
    return {planId,revision:digest(before),triggerId:target,variables:declared.variables,functions:headers.functions,presets:userTypes.presets,structures:userTypes.structures,definitionEditorValidation:headers.functions.length?'NOT_EXECUTED':undefined,customEventEditorValidation:headers.functions.some(f=>f.kind==='Event')?'NOT_EXECUTED':undefined,calls:request.calls.length,events:request.calls.filter(c=>c.kind==='Event').length,conditions:request.calls.filter(c=>c.kind==='Condition').length,actions:request.calls.filter(c=>c.kind==='Action'||c.kind==='Registration').length,registrations:request.calls.filter(c=>c.kind==='Registration').length,libraryContext:{libraries:libraryContext.libraries,cacheHit:libraryContext.cacheHit,build:libraryContext.build},customResourceLibraryCreated:false,localizedTextValues:texts.length,catalogValidation:'Local/declared-dependency definition identities; engine activation is not certified',sourceOfTruth:'Triggers',regenerateGalaxyInEditor:true,compiler:'NOT_EXECUTED'};
  }
  async applyPlan(planId:string,dryRun=true,stage=true) {
    const plan=this.plans.get(planId);if(!plan)throw new Error('GUI_PLAN_NOT_FOUND');
    if(plan.root!==this.workspace.root||plan.schema!==registryDigest(registry(this.registryFile)))throw new Error('GUI_PLAN_CONTEXT_STALE');
    return this.workspace.applyRawTransaction(this.workspace.coupledDraftFiles(['Triggers',...plan.strings.keys()]),async files=>{
      if(plan.libraryRevision&&(await this.libraries.context(registry(this.registryFile),plan.needsCatalogs)).revision!==plan.libraryRevision)throw new Error('GUI_PLAN_LIBRARIES_STALE');
      if(plan.objectsRevision&&digest((await this.workspace.readRaw('Objects')).text)!==plan.objectsRevision)throw new Error('GUI_PLAN_OBJECTS_STALE');
      if(plan.catalogRevision&&await this.catalogRevision()!==plan.catalogRevision)throw new Error('GUI_PLAN_DEPENDENCY_STALE');
      const schemaSource=await this.workspace.readDependency(this.registryFile);
      if(digest(schemaSource)!==plan.schemaFile)throw new Error('GUI_PLAN_SCHEMA_STALE');
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
