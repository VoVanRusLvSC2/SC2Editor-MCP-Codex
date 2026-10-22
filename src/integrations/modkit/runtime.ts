import {existsSync,promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {Workspace} from '../../core/workspace.js';
import type {CascBackend,CascEntry} from '../../modules/casc/backend.js';

export const modkitHome=()=>path.resolve(process.env.SC2_MODKIT_HOME??fileURLToPath(new URL('../../../.modkit-runtime/ModKit-Blizzard/',import.meta.url)));
export const modkitAvailable=()=>existsSync(path.join(modkitHome(),'sc2-mcp-runtime.json'));
type JsonRecord=Record<string,any>;
interface Reader {entryIndex:{size:number;lowerBound(key:string):number;keyAt(row:number):string;contentSizeAt(row:number):number};localRow(row:number):boolean;contentSizeOf(file:string):number|undefined;readPath(file:string):Promise<Uint8Array>;
  resolveFile(file:string):{contentKey:string;encodingKeys?:string[]}|undefined;resolveContentKey(contentKey:string):string|undefined}
interface Backend {
  catalogFiles():Promise<string[]>;
  terrain(view:string,files:Map<string,Uint8Array>,request:JsonRecord|JsonRecord[]):Promise<any>;
  data(request:JsonRecord):Promise<JsonRecord>;preview(request:JsonRecord):Promise<{input:JsonRecord;summary:JsonRecord}>;
  png(input:JsonRecord,options:JsonRecord):Promise<{bytes:Uint8Array;width:number;height:number;diagnostics:unknown[];limitations:string[]}>;
  casc():Promise<Reader>;viewerScript():Promise<string>;close():Promise<void>;
}
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');

/** One optional, retained ModKit host/content catalogue per MCP workspace. No game writes. */
export class ModkitIntegration {
  private backend?:Promise<Backend>;
  private backendRoots='';
  private retiring:Promise<unknown>=Promise.resolve();
  private queue:Promise<unknown>=Promise.resolve();
  private runtimeDigest?:string;
  constructor(readonly workspace:Workspace,readonly install:string,readonly dependencies:()=>string[]=()=>[]){}
  status(){return {available:modkitAvailable(),runtimeRoot:modkitHome(),nodeSupported:Number(process.versions.node.split('.')[0])>=22,
    data:'canonical ModKit ModContext',mapPreview:'ModKit world renderer',terrain:'native format editors and static navigation; engine validation separate',casc:'ModKit local installation reader',localOnly:true,gameWrites:false};}
  async provenance(){if(!modkitAvailable())return {...this.status(),setup:'npm run modkit:setup'};const bytes=await fs.readFile(path.join(modkitHome(),'sc2-mcp-runtime.json'));return {...this.status(),pin:JSON.parse(bytes.toString('utf8')),receiptSha256:sha(bytes),loadedReceiptSha256:this.runtimeDigest??null,restartRequired:!!this.runtimeDigest&&this.runtimeDigest!==sha(bytes)};}
  async port():Promise<Backend>{
    if(!modkitAvailable())throw Error('MODKIT_RUNTIME_NOT_INSTALLED: run npm run modkit:setup');
    const runtimeDigest=sha(await fs.readFile(path.join(modkitHome(),'sc2-mcp-runtime.json')));
    if(this.runtimeDigest&&this.runtimeDigest!==runtimeDigest)throw Error('MODKIT_RUNTIME_CHANGED_RESTART_REQUIRED: reconnect MCP after changing its installed modules');
    const build=await fs.readFile(path.join(this.install,'.build.info')).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return Buffer.alloc(0);throw e;});
    const roots=JSON.stringify([this.dependencies(),sha(build)]);
    if(this.backend&&this.backendRoots!==roots)this.reset();
    if(!this.backend)this.backend=(async()=>{
      this.backendRoots=roots;
      this.runtimeDigest=runtimeDigest;
      await this.retiring;
      if(!modkitAvailable())throw Error('MODKIT_RUNTIME_NOT_INSTALLED: run npm run modkit:setup');
      if(Number(process.versions.node.split('.')[0])<22)throw Error('MODKIT_REQUIRES_NODE_22');
      const module=await import(new URL('../../../scripts/modkit/backend.mjs',import.meta.url).href) as {createBackend(options:Record<string,unknown>):Promise<Backend>};
      return module.createBackend({runtimeRoot:modkitHome(),root:this.workspace.root,install:this.install,
        storage:this.workspace.resolveUserPath('.sc2mcp-modkit-cache'),dependencyRoots:this.dependencies()}) as Promise<Backend>;
    })().catch(error=>{this.backend=undefined;throw error;});
    return this.backend;
  }
  exclusive<T>(work:()=>Promise<T>):Promise<T>{const next=this.queue.then(work,work);this.queue=next.then(()=>undefined,()=>undefined);return next;}
  /** Exact immutable input copy: arbitrary component-folder names become native package names. */
  async snapshot(directory:string){
    const absolute=this.workspace.resolveUserPath(directory),entries:Array<{relative:string;bytes:Buffer}>=[];
    if(this.workspace.draftFiles().some(f=>{const rel=path.relative(absolute,this.workspace.resolveUserPath(f));return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel));}))throw Error('MODKIT_PENDING_DRAFT: save the map/mod before preview or Data queries');
    let bytes=0;
    const read=async(folder:string,prefix='')=>{
      for(const e of (await fs.readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        if(e.name.startsWith('.sc2mcp-')||['.git','node_modules'].includes(e.name))continue;
        if(e.isSymbolicLink())throw Error('MODKIT_INPUT_SYMLINK_REFUSED');
        const file=this.workspace.resolveUserPath(path.join(folder,e.name)),relative=prefix+e.name;
        if(e.isDirectory())await read(file,relative+'/');else if(e.isFile()){
          if(entries.length>=8192)throw Error('MODKIT_INPUT_FILE_LIMIT: select the map/mod component directory');
          const size=(await fs.stat(file)).size;if(bytes+size>256*1024*1024)throw Error('MODKIT_INPUT_BYTE_LIMIT');
          const data=await fs.readFile(file);bytes+=data.length;if(bytes>256*1024*1024)throw Error('MODKIT_INPUT_BYTE_LIMIT');
          entries.push({relative,bytes:data});
        }
      }
    };
    const st=await fs.stat(absolute);
    if(st.isFile()){
      if(!/\.SC2(?:Map|Mod)$/i.test(absolute)||st.size>256*1024*1024)throw Error('MODKIT_PACKAGE_INPUT_REQUIRED');
      entries.push({relative:'package',bytes:await fs.readFile(absolute)});
    }else if(st.isDirectory())await read(absolute);else throw Error('MODKIT_PACKAGE_INPUT_REQUIRED');
    // Include game build identity: an update may change every dependency without changing this map.
    const build=await fs.readFile(path.join(this.install,'.build.info')).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return Buffer.alloc(0);throw e;});
    const dependencyState:unknown[]=[];let dependencyFiles=0,dependencyBytes=0;
    const dependency=async(folder:string)=>{
      for(const e of (await fs.readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        if(e.name.startsWith('.')||e.name==='node_modules')continue;
        const file=path.join(folder,e.name);if(e.isSymbolicLink())throw Error('MODKIT_DEPENDENCY_SYMLINK_REFUSED');
        if(e.isDirectory())await dependency(file);else if(e.isFile()){
          if(++dependencyFiles>12000)throw Error('MODKIT_DEPENDENCY_FILE_LIMIT');
          const stat=await fs.stat(file);
          if(/\.(xml|txt|SC2Components)$/i.test(file)||/^(DocumentInfo|MapInfo)$/i.test(e.name)){
            dependencyBytes+=stat.size;if(dependencyBytes>256*1024*1024)throw Error('MODKIT_DEPENDENCY_BYTE_LIMIT');
            dependencyState.push([file,sha(await fs.readFile(file))]);
          }else dependencyState.push([file,stat.size,stat.mtimeMs]);
        }
      }
    };
    for(const root of this.dependencies())await dependency(root);
    const revision=sha(JSON.stringify(entries.map(e=>[e.relative,sha(e.bytes)]))+sha(build)+JSON.stringify(dependencyState));
    const packed=st.isFile(),map=packed?/\.SC2Map$/i.test(absolute):entries.some(e=>e.relative.toLowerCase()==='mapinfo');
    const target=this.workspace.resolveUserPath(path.join('.sc2mcp-modkit-cache','snapshots',revision,`Document.SC2${map?'Map':'Mod'}`));
    if(!existsSync(target)){
      const temporary=this.workspace.resolveUserPath(target+'.'+randomUUID()+'.tmp');
      await fs.mkdir(path.dirname(target),{recursive:true});
      if(packed)await fs.writeFile(temporary,entries[0].bytes,{flag:'wx'});
      else {await fs.mkdir(temporary);for(const entry of entries){const file=this.workspace.resolveUserPath(path.join(temporary,entry.relative));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,entry.bytes,{flag:'wx'});}}
      for(let attempt=0;;attempt++){
        try{await fs.rename(temporary,target);break;}
        catch(e){if(existsSync(target))break;if(attempt>=5||!['EPERM','EACCES','EBUSY'].includes((e as NodeJS.ErrnoException).code??''))throw e;await new Promise(r=>setTimeout(r,25*(attempt+1)));}
      }
    }
    // Never trust a previous partial/tampered cache as an immutable source snapshot.
    for(const entry of entries){const file=this.workspace.resolveUserPath(packed?target:path.join(target,entry.relative));if(sha(await fs.readFile(file))!==sha(entry.bytes))throw Error('MODKIT_SNAPSHOT_INTEGRITY_MISMATCH');}
    return {target,revision,source:absolute,files:entries.length,inputBytes:entries.reduce((n,e)=>n+e.bytes.length,0)};
  }
  async dataQuery(request:{directory:string;view:'entities'|'authoring'|'ids'|'exists';refs?:{namespace:string;entityId:string}[];namespace?:string;fields?:string[];offset:number;limit:number;locales:string[]}):Promise<JsonRecord>{
    return this.exclusive(async()=>{
      const snapshot=await this.snapshot(request.directory),result=structuredClone(await (await this.port()).data({...request,...snapshot}));
      const answer=result.answer;
      if(request.view==='ids'){
        const all=answer.ids as string[];answer.ids=all.slice(request.offset,request.offset+request.limit);answer.total=all.length;
        answer.nextOffset=request.offset+request.limit<all.length?request.offset+request.limit:null;
      }
      if(request.view==='entities')for(const entity of answer.entities??[]){
        const fields=entity.fields as JsonRecord,keys=request.fields??Object.keys(fields).slice(0,24);
        entity.fields=Object.fromEntries(keys.filter(k=>Object.hasOwn(fields,k)).map(k=>[k,fields[k]]));
        entity.omittedFieldCount=Object.keys(fields).filter(k=>!keys.includes(k)).length;
        for(const name of ['fieldSources','fieldLexemes'])if(entity[name])entity[name]=Object.fromEntries(keys.filter(k=>k in entity[name]).map(k=>[k,entity[name][k]]));
      }
      if(request.view==='authoring'&&request.fields)for(const entity of answer.index?.entities??[]){
        const fields=entity.fields??[];entity.fields=fields.filter((f:{fieldId:string})=>request.fields!.includes(f.fieldId));entity.omittedFieldCount=fields.length-entity.fields.length;
      }
      const output={backend:'ModKit',inputRevision:snapshot.revision,...result};
      if(Buffer.byteLength(JSON.stringify(output))>48000)throw Error('MODKIT_DATA_OUTPUT_BUDGET: select fewer entities/fields');
      return output;
    });
  }
  reset(){const old=this.backend;this.backend=undefined;if(old)this.retiring=this.retiring.then(()=>old.then(b=>b.close())).catch(()=>undefined);}
  async close(){await this.queue;this.reset();await this.retiring;}
}

/** Preserve the existing MCP CASC contract while reading bytes with ModKit. Keys stay explicit. */
export class ModkitCascBackend implements CascBackend {
  private closed=false;
  private held?:{path:string;bytes:Uint8Array};
  constructor(readonly integration:ModkitIntegration){}
  private async reader(){if(this.closed)throw Error('CASC_BACKEND_CLOSED');return (await this.integration.port()).casc();}
  async info(){const r=await this.reader();return {backend:'ModKit',entries:r.entryIndex.size,localOnly:true,contentKeysAvailable:true,localeFlagsAvailable:false,
    identityPolicy:'native content key + active build + decoded SHA256'};}
  private entry(r:Reader,row:number):CascEntry{
    const file=r.entryIndex.keyAt(row),resolved=r.resolveFile(file),contentKey=resolved?.contentKey??'',encodingKey=resolved?.encodingKeys?.[0]??r.resolveContentKey(contentKey)??'';
    if(!/^[a-f0-9]{32}$/i.test(contentKey)||!/^[a-f0-9]{32}$/i.test(encodingKey))throw Error('CASC_MODKIT_KEY_UNAVAILABLE');
    return {path:file,size:r.entryIndex.contentSizeAt(row),local:r.localRow(row),contentKey,encodingKey,localeFlags:0,nameType:0};
  }
  async list(prefix:string,query:string,offset:number,limit:number){
    const r=await this.reader(),items:CascEntry[]=[],index=r.entryIndex;let total=0;
    for(let i=prefix?index.lowerBound(prefix):0;i<index.size;i++){
      const key=index.keyAt(i);if(prefix&&key!==prefix&&!key.startsWith(prefix+'/')){if(!key.startsWith(prefix))break;continue;}
      if(query&&!key.includes(query.toLowerCase()))continue;
      if(total>=offset&&items.length<limit)items.push(this.entry(r,i));total++;
    }return {items,total,nextOffset:offset+items.length<total?offset+items.length:null};
  }
  private row(r:Reader,file:string){
    const candidates=[file,file.replace(/^((?:mods|campaigns)\/[^/]+\/)(?!base\.sc2data\/)/,'$1base.sc2data/')];
    for(const candidate of candidates){const row=r.entryIndex.lowerBound(candidate);if(row<r.entryIndex.size&&r.entryIndex.keyAt(row)===candidate)return row;}
    throw Error('CASC_FILE_NOT_FOUND');
  }
  async inspect(file:string){const r=await this.reader();return {...this.entry(r,this.row(r,file)),path:file};}
  async read(file:string,offset:number,length:number){
    const entry=await this.inspect(file);if(!entry.local)throw Error('CASC_FILE_NOT_LOCAL');
    if(entry.size>64*1024*1024)throw Error('CASC_MODKIT_FULL_READ_LIMIT_64MIB');
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||offset+length>entry.size)throw Error('CASC_READ_RANGE_INVALID');
    if(this.held?.path!==file){const r=await this.reader();this.held={path:file,bytes:await r.readPath(r.entryIndex.keyAt(this.row(r,file)))};}
    if(this.held.bytes.length!==entry.size)throw Error('CASC_DECODED_SIZE_MISMATCH');
    return {path:file,size:entry.size,offset,contentKey:entry.contentKey,encodingKey:entry.encodingKey,base64:Buffer.from(this.held.bytes.subarray(offset,offset+length)).toString('base64')};
  }
  close(){if(this.closed)return;this.closed=true;this.held=undefined;this.integration.reset();}
}
