import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CutsceneSchemaData,
  CutsceneSchemaNode,
  CutsceneSchemaProperty,
  CutsceneValueKind,
} from "./types.js";
import { classifyNativeType } from "./schemaRegistry.js";

export interface PeSection {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  rawOffset: number;
  rawSize: number;
  characteristics: number;
}

export interface PeStringRecord {
  text: string;
  encoding: "ascii" | "utf16le";
  fileOffset: number;
  rva?: number;
  virtualAddress?: string;
  pointerFileOffsets: number[];
  pointerRvas: number[];
  xrefRvas: number[];
  containingFunctions: Array<{ beginRva: number; endRva: number }>;
}

export interface EditorBuildEvidence {
  executable: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  architecture: "x64" | "x86" | "unknown";
  machine: string;
  peTimestamp: string;
  peTimestampUnix: number;
  imageBase: string;
  entryPointRva: string;
  fileVersion?: string;
  productVersion?: string;
  productName?: string;
  companyName?: string;
  originalFilename?: string;
  pdbPath?: string;
  inferredBranch?: string;
  sections: PeSection[];
  readOnlyAnalysis: true;
}

export interface EditorObjectTypeEvidence {
  nativeId: string;
  displayName: string;
  className: string;
  category: string;
  representations: Array<"xml-name" | "rtti">;
  fileOffsets: string[];
  rvas: string[];
  pointerRvas: string[];
  xrefRvas: string[];
  functions: Array<{ beginRva: string; endRva: string }>;
  vtable: null;
  factory: null;
  baseClass: null;
  confidence: number;
  limitations: string[];
}

export interface EditorPropertyEvidence {
  category: string;
  schemaObjectType: string;
  property: string;
  displayName: string;
  displayKey: string;
  internalName?: string;
  xmlNameCandidate: string;
  xmlNameStatus: "corpus-confirmed" | "adjacent-internal-string" | "exe-internal-cluster" | "display-derived";
  valueType: CutsceneValueKind;
  defaultValue?: string;
  minimum?: number;
  maximum?: number;
  enumName?: string;
  enumValues?: string[];
  keyframeable: "confirmed" | "unknown";
  readOnly: "unknown";
  editorOnly: boolean;
  fileOffset: string;
  rva?: string;
  pointerRvas: string[];
  xrefRvas: string[];
  functions: Array<{ beginRva: string; endRva: string }>;
  confidence: number;
  evidence: string[];
}

export interface EditorEnumEvidence {
  name: string;
  values: Array<{ token: string; nativeId: null; displayKey: string; fileOffset: string; rva?: string }>;
  nativeIdsStatus: "not-recovered";
}

export interface EditorPeDiscovery {
  build: EditorBuildEvidence;
  strings: PeStringRecord[];
  rtti: Array<{
    mangled: string;
    className: string;
    fileOffset: string;
    rva?: string;
    pointerRvas: string[];
  }>;
  objectTypes: EditorObjectTypeEvidence[];
  properties: EditorPropertyEvidence[];
  enums: EditorEnumEvidence[];
  uiFrameClasses: Array<{
    className: string;
    representations: Array<"string" | "rtti">;
    fileOffsets: string[];
    rvas: string[];
  }>;
}

const categoryObjectTypes: Record<string, string> = {
  Element: "@Category:Element",
  Animation: "CCutsceneElementAnim",
  Object: "@Category:Object",
  ActorModel: "CCutsceneNodeActor",
  Node: "@Category:Node",
  Commandable: "@Category:Commandable",
  Folder: "CCutsceneNodeFolder",
  Director: "CCutsceneNodeDirector",
  PathMarker: "CCutsceneNodePathMarker",
  Property: "@Category:Property",
  Attachment: "@Category:Attachment",
  LookAt: "@Category:LookAt",
  ActiveLight: "@Category:ActiveLight",
  ActiveShot: "@Category:ActiveShot",
  Sound: "CCutsceneNodeSound",
  SoundGroup: "CCutsceneNodeSoundGroup",
  Cutscene: "CutsceneState",
  PreviewScene: "@Category:PreviewScene",
  Camera: "@Category:Camera",
  Light: "CCutsceneNodeLight",
  LightGlobal: "CCutsceneNodeEnvironmentLight",
  LightToneMapping: "CCutsceneNodeEnvironmentLight",
  LightColorization: "CCutsceneNodeEnvironmentLight",
  LightTerrain: "CCutsceneNodeEnvironmentLight",
  LightSSAO: "CCutsceneNodeEnvironmentLight",
  LightKey: "CCutsceneNodeEnvironmentLight",
  LightFill: "CCutsceneNodeEnvironmentLight",
  LightBack: "CCutsceneNodeEnvironmentLight",
  Path: "CCutsceneNodePath",
  File: "CCutsceneNodeFile",
  M3A: "CCutsceneNodeM3A",
  RTTChannel: "CCutsceneNodeRTTChannel",
  Fog: "CCutsceneNodeFog",
  ConversationDriver: "CCutsceneNodeConversationDriver",
  Text: "CCutsceneNodeText",
  HaloController: "CCutsceneNodeHaloController",
  ModelMaterial: "CCutsceneNodeModelMaterial",
  Bookmark: "@Category:Bookmark",
  PropertyValue: "@Category:PropertyValue",
  ActiveCamera: "@Category:ActiveCamera",
  Conversation: "CCutsceneElementConversation",
  PathElement: "@Category:PathElement",
  Fade: "CCutsceneElementFade",
};

function hex(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `0x${value.toString(16).toUpperCase()}`;
}

function readCString(buffer: Buffer, offset: number): string {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end++;
  return buffer.toString("ascii", offset, end);
}

export function extractAsciiStrings(buffer: Buffer, minLength = 4): PeStringRecord[] {
  const output: PeStringRecord[] = [];
  let start = -1;
  for (let index = 0; index <= buffer.length; index++) {
    const byte = index < buffer.length ? buffer[index] : 0;
    const printable = byte >= 0x20 && byte <= 0x7e;
    if (printable && start < 0) start = index;
    if (!printable && start >= 0) {
      if (index - start >= minLength) output.push({
        text: buffer.toString("ascii", start, index),
        encoding: "ascii",
        fileOffset: start,
        pointerFileOffsets: [],
        pointerRvas: [],
        xrefRvas: [],
        containingFunctions: [],
      });
      start = -1;
    }
  }
  return output;
}

export function extractUtf16Strings(buffer: Buffer, minLength = 4): PeStringRecord[] {
  const output: PeStringRecord[] = [];
  for (const alignment of [0, 1]) {
    let start = -1;
    let characters = 0;
    for (let index = alignment; index + 1 <= buffer.length; index += 2) {
      const low = buffer[index];
      const high = buffer[index + 1];
      const printable = high === 0 && low >= 0x20 && low <= 0x7e;
      if (printable) {
        if (start < 0) start = index;
        characters++;
      } else {
        if (start >= 0 && characters >= minLength) output.push({
          text: buffer.toString("utf16le", start, start + characters * 2),
          encoding: "utf16le",
          fileOffset: start,
          pointerFileOffsets: [],
          pointerRvas: [],
          xrefRvas: [],
          containingFunctions: [],
        });
        start = -1;
        characters = 0;
      }
    }
  }
  return output.sort((a, b) => a.fileOffset - b.fileOffset || a.encoding.localeCompare(b.encoding));
}

function fileOffsetToRva(offset: number, sections: PeSection[]): number | undefined {
  const section = sections.find((entry) => offset >= entry.rawOffset && offset < entry.rawOffset + entry.rawSize);
  return section ? section.virtualAddress + offset - section.rawOffset : undefined;
}

export function parsePe(buffer: Buffer): { machine: number; timestamp: number; architecture: EditorBuildEvidence["architecture"]; imageBase: bigint; entryPoint: number; sections: PeSection[] } {
  if (buffer.toString("ascii", 0, 2) !== "MZ") throw new Error("Input is not a DOS/PE executable");
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") throw new Error("PE signature was not found");
  const coff = peOffset + 4;
  const machine = buffer.readUInt16LE(coff);
  const sectionCount = buffer.readUInt16LE(coff + 2);
  const timestamp = buffer.readUInt32LE(coff + 4);
  const optionalSize = buffer.readUInt16LE(coff + 16);
  const optional = coff + 20;
  const magic = buffer.readUInt16LE(optional);
  const entryPoint = buffer.readUInt32LE(optional + 16);
  const imageBase = magic === 0x20b ? buffer.readBigUInt64LE(optional + 24) : BigInt(buffer.readUInt32LE(optional + 28));
  const sectionTable = optional + optionalSize;
  const sections: PeSection[] = [];
  for (let index = 0; index < sectionCount; index++) {
    const cursor = sectionTable + index * 40;
    sections.push({
      name: readCString(buffer, cursor).slice(0, 8),
      virtualSize: buffer.readUInt32LE(cursor + 8),
      virtualAddress: buffer.readUInt32LE(cursor + 12),
      rawSize: buffer.readUInt32LE(cursor + 16),
      rawOffset: buffer.readUInt32LE(cursor + 20),
      characteristics: buffer.readUInt32LE(cursor + 36),
    });
  }
  return {
    machine,
    timestamp,
    architecture: machine === 0x8664 ? "x64" : machine === 0x14c ? "x86" : "unknown",
    imageBase,
    entryPoint,
    sections,
  };
}

function versionValue(strings: PeStringRecord[], key: string): string | undefined {
  const record = strings.find((entry) => entry.encoding === "utf16le" && entry.text === key);
  if (!record) return undefined;
  return strings.find((entry) => entry.encoding === "utf16le" && entry.fileOffset > record.fileOffset && entry.fileOffset - record.fileOffset < 256 && entry.text !== key)?.text;
}

function propertyValueType(name: string): CutsceneValueKind {
  if (/curve(?:in|out)value/i.test(name)) return "Vec2";
  if (/curve(?:in|out)type/i.test(name)) return "Enum";
  if (/guid|parentid|objectid$/i.test(name)) return "ObjectRef";
  if (/link|filepath|modelpath|overridepath|lightid|attachid/i.test(name)) return "AssetRef";
  if (/^(?:start|duration|time|.*duration|blendTime|blendOutTime|startOffset|randomOffsetMin|randomOffsetMax|endBufferTime)$/i.test(name)) return "Time";
  if (/color/i.test(name)) return "Decimal";
  if (/^(?:enabled|visible|locked|guide|interactive|looping|playonce|playforever|rightaligned|.*visibility|.*physics|.*hit|.*seeking|.*forget|.*casting|specular|.*opaque|.*transparent|colorize|overriding|.*whenhit|alwayspointup|holdfade|fadein)$/i.test(name)) return "Bool";
  if (/index$|priority$|quality$|^(?:animId|lineId|alternateLineId)$/i.test(name)) return "Int";
  if (/position|rotation|scale|direction/i.test(name) && !/[xyz]$/i.test(name)) return "Vec3";
  if (/^text$/i.test(name)) return "Text";
  if (/^(?:name|filter|property|anim|.*alias|.*tag|.*group)$/i.test(name)) return "String";
  return "Decimal";
}

function lowerCamel(label: string): string {
  const acronym = label.match(/^[A-Z]+(?=[A-Z][a-z]|$)/)?.[0];
  if (acronym) return acronym.toLowerCase() + label.slice(acronym.length);
  return label.length ? label[0].toLowerCase() + label.slice(1) : label;
}

function comparablePropertyName(name: string): string {
  return name.toLowerCase()
    .replace(/^environmentlight/, "")
    .replace(/^bokeh/, "")
    .replace(/guid/g, "id")
    .replace(/mode$/g, "");
}

function corpusPropertyName(names: string[], derived: string, internalName: string | undefined): string | undefined {
  const exact = internalName
    ? names.find((name) => name.toLowerCase() === internalName.toLowerCase())
    : undefined;
  if (exact) return exact;
  const derivedExact = names.find((name) => name.toLowerCase() === derived.toLowerCase());
  if (derivedExact) return derivedExact;
  const comparable = comparablePropertyName(internalName ?? derived);
  const compatible = names.filter((name) => comparablePropertyName(name) === comparable);
  return compatible.length === 1 ? compatible[0] : undefined;
}

const exeInternalAliases: Record<string, string> = {
  HDRWhitePoint: "hdrWhitePoint",
  AOOcclusionRadius: "ssaoOcclusionRadius",
  AONoOcclusion: "ssaoNoOcclusion",
  AOFullOcclusion: "ssaoFullOcclusion",
  AOOcclusionPower: "ssaoOcclusionPower",
  AODetailOcclusionRadius: "ssaoDetailOcclusionRadius",
  AODetailNoOcclusion: "ssaoDetailNoOcclusion",
  AODetailFullOcclusion: "ssaoDetailFullOcclusion",
  AODetailOcclusionPower: "ssaoDetailOcclusionPower",
};

function isInternalCandidate(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text)
    && (/^[a-z_]/.test(text) || text === "RTTChannel")
    && !/^(?:CutsceneState|CameraParams|SoundParams|Previewer|Enabled|Disabled|Visible|Hidden|Default|EyeLeft|EyeRight|FastStanding)$/i.test(text)
    && text.length < 80;
}

export function attachAddresses(records: PeStringRecord[], buffer: Buffer, imageBase: bigint, sections: PeSection[]): void {
  const byVirtualAddress = new Map<bigint, PeStringRecord>();
  const byRva = new Map<number, PeStringRecord>();
  for (const record of records) {
    record.rva = fileOffsetToRva(record.fileOffset, sections);
    if (record.rva === undefined) continue;
    record.virtualAddress = `0x${(imageBase + BigInt(record.rva)).toString(16).toUpperCase()}`;
    byVirtualAddress.set(imageBase + BigInt(record.rva), record);
    byRva.set(record.rva, record);
  }
  for (const section of sections.filter((entry) => entry.name === ".rdata" || entry.name === ".data")) {
    const end = Math.min(buffer.length - 8, section.rawOffset + section.rawSize);
    for (let cursor = section.rawOffset; cursor <= end; cursor += 4) {
      const pointer = buffer.readBigUInt64LE(cursor);
      const target = byVirtualAddress.get(pointer);
      if (target) {
        target.pointerFileOffsets.push(cursor);
        const rva = fileOffsetToRva(cursor, sections);
        if (rva !== undefined) target.pointerRvas.push(rva);
      }
      const rvaTarget = byRva.get(buffer.readUInt32LE(cursor));
      if (rvaTarget) {
        rvaTarget.pointerFileOffsets.push(cursor);
        const rva = fileOffsetToRva(cursor, sections);
        if (rva !== undefined) rvaTarget.pointerRvas.push(rva);
      }
    }
  }
  const text = sections.find((entry) => entry.name === ".text");
  const pdata = sections.find((entry) => entry.name === ".pdata");
  const functions: Array<{ beginRva: number; endRva: number }> = [];
  if (pdata) {
    const end = Math.min(buffer.length - 12, pdata.rawOffset + pdata.rawSize);
    for (let cursor = pdata.rawOffset; cursor <= end; cursor += 12) {
      const beginRva = buffer.readUInt32LE(cursor);
      const endRva = buffer.readUInt32LE(cursor + 4);
      if (beginRva && endRva > beginRva) functions.push({ beginRva, endRva });
    }
    functions.sort((a, b) => a.beginRva - b.beginRva);
  }
  const containingFunction = (rva: number): { beginRva: number; endRva: number } | undefined => {
    let low = 0;
    let high = functions.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const candidate = functions[middle];
      if (rva < candidate.beginRva) high = middle - 1;
      else if (rva >= candidate.endRva) low = middle + 1;
      else return candidate;
    }
    return undefined;
  };
  if (text) {
    const end = Math.min(buffer.length - 7, text.rawOffset + text.rawSize);
    for (let cursor = text.rawOffset; cursor <= end; cursor++) {
      const rex = buffer[cursor] >= 0x40 && buffer[cursor] <= 0x4f;
      const opcodeOffset = cursor + (rex ? 1 : 0);
      if (buffer[opcodeOffset] !== 0x8d && buffer[opcodeOffset] !== 0x8b) continue;
      if ((buffer[opcodeOffset + 1] & 0xc7) !== 0x05) continue;
      const length = rex ? 7 : 6;
      const instructionRva = text.virtualAddress + cursor - text.rawOffset;
      const targetRva = instructionRva + length + buffer.readInt32LE(opcodeOffset + 2);
      const target = byRva.get(targetRva);
      if (!target) continue;
      target.xrefRvas.push(instructionRva);
      const owner = containingFunction(instructionRva);
      if (owner) target.containingFunctions.push(owner);
    }
  }
  for (const record of records) {
    record.pointerFileOffsets = [...new Set(record.pointerFileOffsets)].sort((a, b) => a - b).slice(0, 64);
    record.pointerRvas = [...new Set(record.pointerRvas)].sort((a, b) => a - b).slice(0, 64);
    record.xrefRvas = [...new Set(record.xrefRvas)].sort((a, b) => a - b).slice(0, 64);
    record.containingFunctions = [...new Map(record.containingFunctions.map((entry) => [`${entry.beginRva}:${entry.endRva}`, entry])).values()]
      .sort((a, b) => a.beginRva - b.beginRva)
      .slice(0, 64);
  }
}

function rttiClassName(mangled: string): string {
  return mangled.replace(/^\.\?A[UV]/, "").replace(/@@$/, "");
}

export async function discoverEditorPe(executable: string, corpusSchema?: CutsceneSchemaData): Promise<EditorPeDiscovery> {
  const absolute = path.resolve(executable);
  const buffer = await fs.readFile(absolute);
  const pe = parsePe(buffer);
  const allAscii = extractAsciiStrings(buffer);
  const allUtf16 = extractUtf16Strings(buffer);
  const interesting = [...allAscii, ...allUtf16].filter((entry) =>
    /Cutscene|SC2Cutscene|Director|Timeline|Keyframe|Tangent|Interpolation|Target Camera|Game Camera|Omni Light|Spot Light|RTT Channel|PropertyGrid|PropertyPanel|PropertyDescriptor/i.test(entry.text),
  );
  attachAddresses(interesting, buffer, pe.imageBase, pe.sections);
  const addressByKey = new Map(interesting.map((entry) => [`${entry.encoding}\0${entry.fileOffset}\0${entry.text}`, entry]));
  const interestingAscii = allAscii
    .filter((entry) => entry.text.startsWith("Cutscenes/") || /^(?:CCutscene|\.\?A[UV]CCutscene)/.test(entry.text))
    .map((entry) => addressByKey.get(`ascii\0${entry.fileOffset}\0${entry.text}`) ?? entry)
    .sort((a, b) => a.fileOffset - b.fileOffset);

  const rtti = interestingAscii
    .filter((entry) => /^\.\?A[UV]CCutscene.*@@$/.test(entry.text))
    .map((entry) => ({
      mangled: entry.text,
      className: rttiClassName(entry.text),
      fileOffset: hex(entry.fileOffset)!,
      rva: hex(entry.rva),
      pointerRvas: entry.pointerRvas.map((value) => hex(value)!),
      xrefRvas: entry.xrefRvas.map((value) => hex(value)!),
      functions: entry.containingFunctions.map((value) => ({ beginRva: hex(value.beginRva)!, endRva: hex(value.endRva)! })),
    }));

  const uiClasses = new Map<string, { strings: PeStringRecord[]; rtti: PeStringRecord[] }>();
  for (const record of allAscii) {
    const rttiMatch = record.text.match(/^\.\?A[UV]([A-Za-z_][A-Za-z0-9_]*(?:Frame|FrameDesc))@@$/);
    const directMatch = record.text.match(/^([A-Za-z_][A-Za-z0-9_]*(?:Frame|FrameDesc))$/);
    const className = rttiMatch?.[1] ?? directMatch?.[1];
    if (!className || className.length > 96) continue;
    const entry = uiClasses.get(className) ?? { strings: [], rtti: [] };
    (rttiMatch ? entry.rtti : entry.strings).push(record);
    uiClasses.set(className, entry);
  }
  const uiFrameClasses = [...uiClasses.entries()].map(([className, records]) => {
    const entries = [...records.strings, ...records.rtti];
    return {
      className,
      representations: [...new Set([...(records.strings.length ? ["string" as const] : []), ...(records.rtti.length ? ["rtti" as const] : [])])],
      fileOffsets: entries.map((entry) => hex(entry.fileOffset)!),
      rvas: entries.map((entry) => hex(fileOffsetToRva(entry.fileOffset, pe.sections))).filter((entry): entry is string => Boolean(entry)),
    };
  }).sort((a, b) => a.className.localeCompare(b.className));

  const typeRecords = interestingAscii.filter((entry) => /^CCutscene(?:Node|Element|Commandable|State)[A-Za-z0-9_]*$/.test(entry.text));
  const rttiNames = new Set(rtti.map((entry) => entry.className));
  const groupedTypes = new Map<string, PeStringRecord[]>();
  for (const record of typeRecords) {
    const list = groupedTypes.get(record.text) ?? [];
    list.push(record);
    groupedTypes.set(record.text, list);
  }
  for (const name of rttiNames) if (!groupedTypes.has(name)) groupedTypes.set(name, []);
  const objectTypes = [...groupedTypes.entries()].map<EditorObjectTypeEvidence>(([nativeId, records]) => ({
    nativeId,
    displayName: nativeId.replace(/^CCutscene(?:Node|Element)?/, "").replace(/([a-z])([A-Z])/g, "$1 $2") || nativeId,
    className: nativeId,
    category: classifyNativeType(nativeId),
    representations: [...new Set([...(records.length ? ["xml-name" as const] : []), ...(rttiNames.has(nativeId) ? ["rtti" as const] : [])])],
    fileOffsets: records.map((entry) => hex(entry.fileOffset)!),
    rvas: records.map((entry) => hex(entry.rva)).filter((entry): entry is string => Boolean(entry)),
    pointerRvas: [...new Set(records.flatMap((entry) => entry.pointerRvas))].map((value) => hex(value)!),
    xrefRvas: [...new Set(records.flatMap((entry) => entry.xrefRvas))].map((value) => hex(value)!),
    functions: [...new Map(records.flatMap((entry) => entry.containingFunctions).map((value) => [`${value.beginRva}:${value.endRva}`, value])).values()]
      .map((value) => ({ beginRva: hex(value.beginRva)!, endRva: hex(value.endRva)! })),
    vtable: null,
    factory: null,
    baseClass: null,
    confidence: records.length && rttiNames.has(nativeId) ? 1 : records.length || rttiNames.has(nativeId) ? 0.9 : 0.7,
    limitations: ["Static string/RTTI evidence confirms the class token; factory, vtable, and inheritance still require targeted RTTI/COL recovery."],
  })).sort((a, b) => a.nativeId.localeCompare(b.nativeId));

  const enumGroups = new Map<string, Array<{ token: string; record: PeStringRecord }>>();
  for (const record of interestingAscii) {
    const match = record.text.match(/^Cutscenes\/Value\/([^/]+)\/([^/]+)$/);
    if (!match) continue;
    const values = enumGroups.get(match[1]) ?? [];
    values.push({ token: match[2], record });
    enumGroups.set(match[1], values);
  }
  const enums = [...enumGroups.entries()].map<EditorEnumEvidence>(([name, values]) => ({
    name,
    values: values.map(({ token, record }) => ({ token, nativeId: null, displayKey: record.text, fileOffset: hex(record.fileOffset)!, rva: hex(record.rva) })),
    nativeIdsStatus: "not-recovered",
  })).sort((a, b) => a.name.localeCompare(b.name));

  const corpusNames = [...new Set((corpusSchema?.properties ?? []).map((entry) => entry.xmlName))];
  let category = "Unknown";
  let boundary = 0;
  const properties: EditorPropertyEvidence[] = [];
  const propertyLabels = allAscii.filter((entry) => /^Cutscenes\/(?:Property|PathElement)\//.test(entry.text));
  const categories = allAscii.filter((entry) => /^Cutscenes\/Category\//.test(entry.text));
  const clusterStart = Math.min(...categories.map((entry) => entry.fileOffset));
  const clusterEnd = Math.max(...propertyLabels.map((entry) => entry.fileOffset)) + 256;
  const cluster = allAscii
    .filter((entry) => entry.fileOffset >= clusterStart && entry.fileOffset <= clusterEnd)
    .map((entry) => addressByKey.get(`ascii\0${entry.fileOffset}\0${entry.text}`) ?? entry);
  for (let index = 0; index < cluster.length; index++) {
    const record = cluster[index];
    const categoryMatch = record.text.match(/^Cutscenes\/Category\/(.+)$/);
    if (categoryMatch) {
      category = categoryMatch[1];
      boundary = record.fileOffset;
      continue;
    }
    const propertyMatch = record.text.match(/^Cutscenes\/(?:Property|PathElement)\/(.+)$/);
    if (!propertyMatch) continue;
    const leaf = propertyMatch[1].split("/").at(-1)!;
    const prior = cluster
      .slice(Math.max(0, index - 5), index)
      .filter((candidate) => candidate.fileOffset >= boundary && record.fileOffset - candidate.fileOffset <= 96 && isInternalCandidate(candidate.text))
      .at(-1);
    const derived = lowerCamel(leaf.replace(/^EnvironmentLight\//, ""));
    const internalName = prior?.text;
    const clusterInternalName = exeInternalAliases[leaf];
    const corpusName = corpusPropertyName(corpusNames, derived, internalName ?? clusterInternalName);
    const xmlNameCandidate = corpusName ?? clusterInternalName ?? internalName ?? derived;
    const enumEntry = enums.find((entry) => (/^Curve(?:In|Out)Type$/i.test(leaf) && entry.name === "TangentType")
      || entry.name.toLowerCase() === leaf.toLowerCase()
      || leaf.toLowerCase().endsWith(entry.name.toLowerCase())
      || xmlNameCandidate.toLowerCase().endsWith(entry.name.toLowerCase()));
    const schemaObjectType = categoryObjectTypes[category] ?? `@Category:${category}`;
    properties.push({
      category,
      schemaObjectType,
      property: xmlNameCandidate,
      displayName: leaf,
      displayKey: record.text,
      internalName,
      xmlNameCandidate,
      xmlNameStatus: corpusName ? "corpus-confirmed" : clusterInternalName ? "exe-internal-cluster" : internalName ? "adjacent-internal-string" : "display-derived",
      valueType: enumEntry ? "Enum" : propertyValueType(xmlNameCandidate),
      enumName: enumEntry?.name,
      enumValues: enumEntry?.values.map((entry) => entry.token),
      keyframeable: corpusSchema?.properties.some((entry) => entry.objectType === "CCutsceneNodePropertyValue" && entry.xmlName === "propertyName" && entry.enumValues?.includes(xmlNameCandidate)) ? "confirmed" : "unknown",
      readOnly: "unknown",
      editorOnly: !corpusName,
      fileOffset: hex(record.fileOffset)!,
      rva: hex(record.rva),
      pointerRvas: record.pointerRvas.map((value) => hex(value)!),
      xrefRvas: record.xrefRvas.map((value) => hex(value)!),
      functions: record.containingFunctions.map((value) => ({ beginRva: hex(value.beginRva)!, endRva: hex(value.endRva)! })),
      confidence: corpusName ? 1 : internalName || clusterInternalName ? 0.9 : 0.7,
      evidence: [
        `SC2Editor property localization key ${record.text}`,
        ...(internalName ? [`Adjacent internal token ${internalName}`] : []),
        ...(clusterInternalName ? [`Matching internal field token in the same EnvironmentLight registry cluster: ${clusterInternalName}`] : []),
        ...(corpusName ? [`Exact case-insensitive XML attribute match in Cutscene corpus: ${corpusName}`] : []),
      ],
    });
    boundary = record.fileOffset;
  }

  const timestampDate = new Date(pe.timestamp * 1000).toISOString();
  const pdbPath = allAscii.find((entry) => /SC2Editor_x64\.pdb$/i.test(entry.text))?.text;
  return {
    build: {
      executable: absolute,
      fileName: path.basename(absolute),
      fileSize: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      architecture: pe.architecture,
      machine: hex(pe.machine)!,
      peTimestamp: timestampDate,
      peTimestampUnix: pe.timestamp,
      imageBase: `0x${pe.imageBase.toString(16).toUpperCase()}`,
      entryPointRva: hex(pe.entryPoint)!,
      fileVersion: versionValue(allUtf16, "FileVersion"),
      productVersion: versionValue(allUtf16, "ProductVersion"),
      productName: versionValue(allUtf16, "ProductName"),
      companyName: versionValue(allUtf16, "CompanyName"),
      originalFilename: versionValue(allUtf16, "OriginalFilename"),
      pdbPath,
      inferredBranch: pdbPath?.match(/branches\\([^\\]+)/i)?.[1],
      sections: pe.sections,
      readOnlyAnalysis: true,
    },
    strings: interesting.sort((a, b) => a.fileOffset - b.fileOffset),
    rtti,
    objectTypes,
    properties,
    enums,
    uiFrameClasses,
  };
}

export function editorEvidenceSchema(discovery: EditorPeDiscovery, current?: CutsceneSchemaData): Pick<CutsceneSchemaData, "nodes" | "properties" | "enums"> {
  const currentPropertyKeys = new Set((current?.properties ?? []).map((entry) => `${entry.objectType}\0${entry.xmlName}`));
  const nodes = discovery.objectTypes.filter((entry) => entry.representations.includes("xml-name")).map<CutsceneSchemaNode>((entry) => ({
    nativeType: entry.nativeId,
    category: entry.category,
    parentTypes: [],
    childTypes: [],
    observedInCorpus: current?.nodes.find((node) => node.nativeType === entry.nativeId)?.observedInCorpus ?? 0,
    discoveredFrom: [`SC2Editor ${discovery.build.fileVersion ?? "unknown"} ${discovery.build.sha256}@${entry.fileOffsets[0] ?? "RTTI"}`],
    confidence: "confirmed",
    coverage: current?.nodes.some((node) => node.nativeType === entry.nativeId) ? "SUPPORTED" : "SUPPORTED_PRESERVE_ONLY",
  }));
  const properties = discovery.properties.map<CutsceneSchemaProperty>((entry) => {
    const key = `${entry.schemaObjectType}\0${entry.xmlNameCandidate}`;
    return {
      objectType: entry.schemaObjectType,
      property: entry.xmlNameCandidate,
      xmlName: entry.xmlNameCandidate,
      valueType: entry.valueType,
      enumValues: entry.enumValues,
      keyframeable: entry.keyframeable === "confirmed",
      required: false,
      description: `SC2Editor property '${entry.displayName}' (${entry.category}); XML name is ${entry.xmlNameStatus}.`,
      observedInCorpus: 0,
      discoveredFrom: [`SC2Editor ${discovery.build.fileVersion ?? "unknown"} ${discovery.build.sha256}@${entry.fileOffset}`],
      confidence: entry.xmlNameStatus === "corpus-confirmed" ? "confirmed" : "inferred",
      coverage: currentPropertyKeys.has(key) || entry.xmlNameStatus === "corpus-confirmed" ? "SUPPORTED" : "EDITOR_ONLY",
    };
  });
  const enums = discovery.enums.map((entry) => ({
    name: entry.name,
    values: entry.values.map((value) => value.token),
    discoveredFrom: [`SC2Editor ${discovery.build.fileVersion ?? "unknown"} ${discovery.build.sha256}`],
  }));
  return { nodes, properties, enums };
}
