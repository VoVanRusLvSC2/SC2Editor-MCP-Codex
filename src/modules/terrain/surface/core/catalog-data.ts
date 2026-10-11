/**
 * Read-only catalog tools, informed by SC2GameData XML.
 * No native layout claims, no implicit inheritance, no asset existence assertions.
 */
import { parseStrictXml, xmlNumber, type XmlElementView, type XmlProcessingInstructionView } from '../format/xml.js';
import type { CatalogEntry } from './catalog.js';

export function catalogRecordKind(entry: CatalogEntry): 'type-default' | 'named-default' | 'record' {
  if (entry.attributes.default !== '1') return 'record';
  return entry.id === null ? 'type-default' : 'named-default';
}

/** Catalog comma vectors are NOT the space-delimited map XML vectors. No channel-order inference. */
export function parseCatalogVector(raw: string, size: number): number[] {
  if (!Number.isSafeInteger(size) || size < 1 || size > 64) throw new RangeError('CATALOG_VECTOR_SIZE');
  const words = raw.split(',');
  if (words.length !== size) throw new Error('CATALOG_VECTOR_LENGTH');
  return words.map((word, i) => xmlNumber(word, `catalog-vector[${i}]`));
}

export interface CatalogFieldOccurrence {
  /** Position among siblings is retained even for unindexed arrays. */
  path: string;
  names: string[];
  name: string;
  authoredIndex: string | null;
  attributes: Record<string, string>;
  text: string;
}
export function catalogFieldOccurrences(entry: CatalogEntry): CatalogFieldOccurrence[] {
  const result: CatalogFieldOccurrence[] = [];
  const visit = (fields: XmlElementView[], parent: string, names: string[]): void => {
    fields.forEach((field, position) => {
      const path = `${parent}/${field.name}[ordinal=${position}]`;
      const chain = [...names, field.name];
      result.push({path, names: chain, name: field.name, authoredIndex: field.attributes.index ?? null,
        attributes: {...field.attributes}, text: field.text});
      visit(field.children, path, chain);
    });
  };
  visit(entry.fields, '', []);
  return result;
}
export interface CatalogTokenDeclaration {
  ownerPath: string;
  beforeChildIndex: number;
  raw: string;
  id: string | null;
  attributes: Record<string, string> | null;
  diagnostic: string | null;
}
/** Parse token declarations as inert metadata; never run processing instructions. */
export function catalogTokenDeclarations(entry: CatalogEntry): CatalogTokenDeclaration[] {
  const result: CatalogTokenDeclaration[] = [];
  const collect = (pis: XmlProcessingInstructionView[] | undefined, ownerPath: string): void => {
    for (const pi of pis ?? []) {
      if (pi.target !== 'token') continue;
      let attrs: Record<string, string> | null = null;
      let diagnostic: string | null = null;
      try {
        const node = parseStrictXml(`<token ${pi.data}/>`);
        if (node.name !== 'token' || node.children.length || node.text.trim()) throw new Error('BAD_TOKEN_DECLARATION');
        attrs = {...node.attributes};
        if (!attrs.id) diagnostic = 'TOKEN_ID_MISSING';
      } catch (e) { diagnostic = String(e); }
      result.push({ownerPath, beforeChildIndex: pi.beforeChildIndex, raw: pi.data,
        id: attrs?.id ?? null, attributes: attrs, diagnostic});
    }
  };
  collect(entry.processingInstructions, '');
  const walk = (fields: XmlElementView[], parent: string): void => {
    fields.forEach((n, i) => { const path = `${parent}/${n.name}[ordinal=${i}]`;
      collect(n.processingInstructions, path); walk(n.children, path); });
  };
  walk(entry.fields, '');
  return result;
}

export interface CatalogTemplatePreview {
  raw: string;
  value: string;
  missing: string[];
  unresolved: string[];
  status: 'literal' | 'expanded-once' | 'unresolved';
}
/** Explicit single-pass preview. Caller supplies id in the owning entry's scope.
 * No default selection, inheritance, recursion or executable expressions. */
export function previewCatalogTemplate(raw: string, bindings: Readonly<Record<string, string>>): CatalogTemplatePreview {
  if (raw.length > 1024 * 1024) throw new RangeError('TEMPLATE_BUDGET');
  const missing = new Set<string>(); let count = 0; let outputSize = raw.length;
  const value = raw.replace(/##([^#]+)##/g, (match, key: string) => {
    count++;
    if (!Object.hasOwn(bindings, key)) { missing.add(key); return match; }
    const replacement = bindings[key];
    if (typeof replacement !== 'string' || replacement.length > 8192) throw new Error('TOKEN_VALUE_INVALID');
    outputSize += replacement.length - match.length;
    if (outputSize > 2 * 1024 * 1024) throw new RangeError('EXPANDED_TEMPLATE_BUDGET');
    return replacement;
  });
  if (value.length > 2 * 1024 * 1024) throw new RangeError('EXPANDED_TEMPLATE_BUDGET');
  const unresolved = [...new Set([...value.matchAll(/##([^#]+)##/g)].map(m => m[1]!))];
  return {raw, value, missing: [...missing], unresolved,
    status: unresolved.length ? 'unresolved' : count ? 'expanded-once' : 'literal'};
}

export interface CatalogReference {
  path: string;
  raw: string;
  kind: 'catalog-link' | 'file-path' | 'directory-path' | 'asset-key';
  targetCatalog: string | null;
  template: boolean;
  existence: 'not-checked';
}
const LINKS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  CTerrain: {BlendTextures:'TerrainTex', CliffSets:'Cliff', HardTiles:'Tile', Lighting:'Light', Camera:'Camera',
    Ambience:'Sound', FixedSkyboxModel:'Model', NonFixedSkyboxModel:'Model', ReverbGlobal:'Reverb', ReverbAmbient:'Reverb'},
  CCliff: {CliffMesh:'CliffMesh'},
  CTerrainTex: {PhysicsMaterial:'PhysicsMaterial', 'DoodadEntry.Model':'Model'},
  CWater: {BeachShoreline:'Model', CliffShoreline:'Model', LavaModel:'Model', Sound:'Sound', 'Doodads.Model':'Model'},
  CCliffDoodad: {TexSets:'Terrain', CliffSet:'Cliff'}
};
const FAMILY: Readonly<Record<string, string>> = {CTerrain:'Terrain', CCliff:'Cliff', CCliffMesh:'CliffMesh',
  CTile:'Tile', CTerrainTex:'TerrainTex', CTexture:'Texture', CTextureSheet:'TextureSheet', CWater:'Water',
  CTerrainObject:'TerrainObject', CCliffDoodad:'TerrainObject', CModel:'Model', CModelFoliage:'Model',
  CPhysicsMaterial:'PhysicsMaterial', CActorTerrainDeformer:'Actor', CActorEventMacro:'Actor'};
export function inspectCatalogReferences(entry: CatalogEntry): CatalogReference[] {
  const refs: CatalogReference[] = [];
  const add = (path: string, raw: string, kind: CatalogReference['kind'], targetCatalog: string | null): void => {
    refs.push({path, raw, kind, targetCatalog, template: /##[^#]+##/.test(raw), existence:'not-checked'});
  };
  if (entry.parent !== null && entry.parent !== '') add('@parent', entry.parent, 'catalog-link', FAMILY[entry.type] ?? null);
  for (const f of catalogFieldOccurrences(entry)) {
    for (const [attribute, raw] of Object.entries(f.attributes)) {
      if (!raw) continue;
      const path = f.path + '/@' + attribute;
      const linked = attribute === 'value' ? LINKS[entry.type]?.[f.names.join('.')] : undefined;
      if (linked) add(path, raw, 'catalog-link', linked);
      else if (/\.(?:dds|m3|m3a|tga|png)$/i.test(raw) || /(?:^|[\\/])hardtile\.bin$/i.test(raw)) add(path,raw,'file-path',null);
      else if (entry.type === 'CCliffMesh' && f.names.join('.') === 'ModelPath' && attribute === 'value') add(path,raw,'directory-path',null);
      else if (/^(?:TerrainTexDef|TerrainTileDef|TerrainCliffDef)[\\/]/.test(raw)) add(path,raw,'asset-key',null);
    }
  }
  return refs;
}
function uniqueField(entry: CatalogEntry, name: string): XmlElementView {
  const found = entry.fields.filter(n => n.name === name);
  if (found.length !== 1) throw new Error(`EXACTLY_ONE_AUTHORED_FIELD_REQUIRED: ${name}`);
  return found[0]!;
}
/** Dimensions + character rows, NOT character -> numeric height or world-space mapping. */
export function inspectCliffDoodadHeightCodes(entry: CatalogEntry) {
  if (entry.type !== 'CCliffDoodad') throw new Error('CLIFF_DOODAD_REQUIRED');
  const width = xmlNumber(uniqueField(entry,'NumCellsAcross').attributes.value,'NumCellsAcross');
  const height = xmlNumber(uniqueField(entry,'NumCellsDown').attributes.value,'NumCellsDown');
  if (![width,height].every(v => Number.isSafeInteger(v) && v > 0 && v <= 4096) || width*height > 1_048_576)
    throw new RangeError('HEIGHT_CODES_DIMENSIONS');
  const authored = entry.fields.filter(n => n.name === 'HeightCodes');
  if (authored.some(n => n.attributes.index !== undefined)) throw new Error('INDEXED_HEIGHT_CODES_NEED_PROFILE');
  const rows = authored.map(n => n.attributes.value ?? '');
  const errors: string[] = [];
  if (rows.length !== height) errors.push('ROW_COUNT_MISMATCH');
  rows.forEach((line, i) => { if ([...line].length !== width) errors.push(`ROW_WIDTH_MISMATCH:${i}`); });
  return {width, height, rows, symbols:[...new Set(rows.join(''))].sort(), errors,
    levelMapping:null, worldOrientation:null, semantics:'authored-character-grid-only'};
}
/** Keep sparse indices. In particular absent index=1 is NOT manufactured as 0. */
export function inspectAuthoredCliffHeights(entry: CatalogEntry) {
  if (entry.type !== 'CCliffMesh') throw new Error('CLIFF_MESH_REQUIRED');
  const entries: {index:number; raw:string; value:number}[] = [];
  const seen = new Set<number>();
  for (const n of entry.fields.filter(n => n.name === 'CliffHeights')) {
    const index = xmlNumber(n.attributes.index,'CliffHeights.index');
    if (!Number.isSafeInteger(index) || index < 0 || index > 0xFFFFFFFF) throw new RangeError('CLIFF_HEIGHT_INDEX');
    if (seen.has(index)) throw new Error('DUPLICATE_CLIFF_HEIGHT_INDEX');
    seen.add(index);
    const raw = n.attributes.value;
    entries.push({index,raw:raw ?? '',value:xmlNumber(raw,'CliffHeights.value')});
  }
  return {entries, missingIndices:'unspecified-not-zero', semantics:'authored-values-not-HMAP-or-CLIF-decoder'};
}
