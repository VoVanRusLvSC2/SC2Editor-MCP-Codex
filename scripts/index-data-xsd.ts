import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanXml } from "../src/core/xmlScanner.js";
import type { XmlNode } from "../src/core/types.js";
import type { DataXsdField, DataXsdManifest, DataXsdType } from "../src/modules/data/xsdRegistry.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const input = args.find((entry) => !entry.startsWith("--"));
const outputArg = args.find((entry) => entry.startsWith("--output="))?.slice("--output=".length);
if (!input) throw new Error("Usage: npm run data:xsd:index -- <catalogsData.xsd> [--output=generated/data-xsd-index]");
const inputFile = path.resolve(input), output = path.resolve(projectRoot, outputArg ?? "generated/data-xsd-index");
if (!output.startsWith(projectRoot + path.sep) || path.basename(output) !== "data-xsd-index") throw new Error("XSD_OUTPUT_SCOPE_INVALID");
// Never follow a symlink/junction ancestor during replacement or cleanup.
for(let current=output;current!==projectRoot;current=path.dirname(current)){
  const stat=await fs.lstat(current).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
  if(stat?.isSymbolicLink())throw new Error('XSD_OUTPUT_SYMLINK_UNSUPPORTED');
}
const staging = `${output}.tmp-${process.pid}`;
const source = await fs.readFile(inputFile, "utf8"), parsed = scanXml(source);
if (parsed.diagnostics.length) throw new Error(`XSD_XML_INVALID ${JSON.stringify(parsed.diagnostics.slice(0, 20))}`);

const nodes = parsed.nodes;
const namespaces = new Map<number,Record<string,string>>();
for(const node of nodes){const bindings={...(node.parentId===null?{}:namespaces.get(node.parentId))};for(const [name,value]of Object.entries(node.attrs)){if(name==="xmlns")bindings[""]=value;else if(name.startsWith("xmlns:"))bindings[name.slice(6)]=value;}namespaces.set(node.id,bindings);}
const qname=(node:XmlNode,value:string)=>{const colon=value.indexOf(":");const prefix=colon<0?"":value.slice(0,colon);return {name:colon<0?value:value.slice(colon+1),namespace:namespaces.get(node.id)?.[prefix]??""};};
const schemaNode=(node:XmlNode)=>qname(node,node.tag).namespace==="http://www.w3.org/2001/XMLSchema";
const local = (tag: string) => tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
const attr = (node: XmlNode, name: string) => node.attrs[name];
const facets = new Set(["length", "minLength", "maxLength", "pattern", "minInclusive", "maxInclusive", "minExclusive", "maxExclusive", "totalDigits", "fractionDigits", "whiteSpace"]);
const definitions = nodes.filter((node) => schemaNode(node) && node.parentId===parsed.rootIds[0] && ["complexType", "simpleType"].includes(local(node.tag)) && attr(node, "name"));
const types: DataXsdType[] = [];

function parseType(definition: XmlNode, name: string): DataXsdType {
  const value: DataXsdType = {name,schemaSpan:{start:definition.start,end:definition.end},namespace:nodes[parsed.rootIds[0]].attrs.targetNamespace??"", kind: local(definition.tag) === "complexType" ? "complex" : "simple", abstract: attr(definition,"abstract") === "true" || undefined, mixed: attr(definition,"mixed") === "true" || undefined, fields: [], enumValues: [], facets: []};
  const groupStack=new Set<string>();
  const walk = (node: XmlNode) => {
    if(!schemaNode(node)){(value.issues??=[]).push({construct:node.tag,offset:node.start});return;}
    const tag = local(node.tag);
    if (tag === "annotation") return;
    if(["any","anyAttribute","import","include","redefine","union","list"].includes(tag))(value.issues??=[]).push({construct:tag,offset:node.start});
    if ((tag === "extension" || tag === "restriction") && attr(node,"base")) {const base=qname(node,attr(node,"base"));value.base=base.namespace==="http://www.w3.org/2001/XMLSchema"?"xs:"+base.name:base.name;value.baseNamespace=base.namespace;value.derivation=tag;}
    if (tag === "element" || tag === "attribute") {
      const schema=nodes[parsed.rootIds[0]],form=node.attrs.form??schema.attrs[tag==='element'?'elementFormDefault':'attributeFormDefault'];
      const field: DataXsdField = {kind:tag,schemaSpan:{start:node.start,end:node.end},namespace:form==='qualified'?schema.attrs.targetNamespace??'':''};
      for (const key of ["name","ref","type","minOccurs","maxOccurs","use","default","fixed"] as const) if (attr(node,key) !== undefined) field[key]=attr(node,key);
      if(field.ref){const ref=qname(node,field.ref);field.ref=ref.name;field.refNamespace=ref.namespace;(value.issues??=[]).push({construct:'MEMBER_REFERENCE_REQUIRES_GLOBAL_DECLARATION:'+ref.name,offset:node.start});}
      if(field.type){const type=qname(node,field.type);field.typeNamespace=type.namespace;field.type=type.namespace==="http://www.w3.org/2001/XMLSchema"?"xs:"+type.name:type.name;}
      const particle:Array<{kind:string;minOccurs?:string;maxOccurs?:string}>=[];
      let holder=node.parentId;
      while(holder!==null&&holder!==definition.id){const ancestor=nodes[holder];if(["choice","sequence","all"].includes(local(ancestor.tag)))particle.unshift({kind:local(ancestor.tag),minOccurs:ancestor.attrs.minOccurs,maxOccurs:ancestor.attrs.maxOccurs});holder=ancestor.parentId;}
      field.particle=particle;
      const inline = node.childIds.map(id=>nodes[id]).find(n=>["complexType","simpleType"].includes(local(n.tag)));
      if (inline) field.inlineType = parseType(inline, name + "." + (field.name ?? field.ref));
      value.fields.push(field);
      return;
    }
    if((tag === "group" || tag === "attributeGroup") && attr(node,"ref")){
      const resolved=qname(node,attr(node,"ref")),name=resolved.name;
      if((resolved.namespace??'')!==(nodes[parsed.rootIds[0]].attrs.targetNamespace??'')){(value.issues??=[]).push({construct:'FOREIGN_GROUP:'+name,offset:node.start});return;}
      if(groupStack.has(name)){(value.issues??=[]).push({construct:"CYCLIC_GROUP:"+name,offset:node.start});return;}
      const definition=nodes.find(n=>schemaNode(n)&&n.parentId===parsed.rootIds[0]&&local(n.tag)===tag&&attr(n,"name")===name);
      if(!definition)(value.issues??=[]).push({construct:"UNRESOLVED_GROUP:"+name,offset:node.start});
      else {groupStack.add(name);for(const id of definition.childIds)walk(nodes[id]);groupStack.delete(name);}
      return;
    }
    if (tag === "enumeration" && attr(node,"value") !== undefined) value.enumValues.push(attr(node,"value"));
    if (facets.has(tag) && attr(node,"value") !== undefined) value.facets.push({kind:tag,value:attr(node,"value")});
    for (const id of node.childIds) walk(nodes[id]);
  };
  for (const id of definition.childIds) walk(nodes[id]);
  return value;
}
for (const definition of definitions) types.push(parseType(definition, attr(definition,"name")));
types.sort((a, b) => a.name<b.name?-1:a.name>b.name?1:0);

await fs.rm(staging, { recursive: true, force: true });
await fs.mkdir(path.join(staging, "types"), { recursive: true });
const manifestTypes: DataXsdManifest["types"] = [];
for (const type of types) {
  const shard = `types/${createHash("sha256").update(type.name).digest("hex").slice(0, 20)}.json`;
  await fs.writeFile(path.join(staging, shard), `${JSON.stringify(type)}\n`);
  manifestTypes.push({ name: type.name, kind: type.kind, base: type.base, fields: type.fields.length, enumValues: type.enumValues.length, shard });
}
const manifest: DataXsdManifest = {
  schemaVersion: "2",
  targetNamespace:nodes[parsed.rootIds[0]].attrs.targetNamespace??"",
  source: { file: path.basename(inputFile), bytes: Buffer.byteLength(source), sha256: createHash("sha256").update(source).digest("hex") },
  statistics: {
    complexTypes: types.filter((entry) => entry.kind === "complex").length,
    simpleTypes: types.filter((entry) => entry.kind === "simple").length,
    fields: types.reduce((sum, entry) => sum + entry.fields.length, 0),
    enumValues: types.reduce((sum, entry) => sum + entry.enumValues.length, 0),
  },
  types: manifestTypes,
  issues:nodes.filter(n=>n.parentId===parsed.rootIds[0]&&["import","include","redefine","any","anyAttribute"].includes(local(n.tag))).map(n=>({construct:local(n.tag),offset:n.start})),
};
await fs.writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest)}\n`);
const previous = output + ".previous-" + process.pid;
let moved = false;
try { await fs.rename(output, previous); moved = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
try { await fs.rename(staging, output); } catch (error) { if (moved) await fs.rename(previous, output); throw error; }
if (moved) await fs.rm(previous, {recursive:true,force:true});
console.log(JSON.stringify({ output, ...manifest.statistics, source: manifest.source }, null, 2));
