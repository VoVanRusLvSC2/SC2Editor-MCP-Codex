/** Terrain descriptor: scoped XML parsing, raw preservation, bounded numeric conversion.
 * Authored records are data; cliff/ramp mesh-generation rules remain hypothesis-gated. */
import type { TerrainParams } from './formats/height-map.js'
import { parseStrictXml, childNamed, childrenNamed, xmlNumber, xmlVector, type XmlElementView } from './xml.js'
import { integer } from './guards.js'

export interface TerrainTexture {
  index: number
  name: string
}

/** Archive heuristic constants. Raw f is a bitfield; these names are NOT a complete proven enum. */
export const CLIFF_CELL_FLAT = 0
export const CLIFF_CELL_WALL = 1
export const CLIFF_CELL_RAMP = 2

/**
 * One `<cc>` row of `<cliffCellList>`: the map's OWN record of a 2x2-cell cliff
 * tile. Cliff tiles are authored, not derived — the level field supplies the
 * mesh code, but which cliff set and which variation to use is stored here.
 */
export interface CliffCell {
  /** Index into the `(cliffSizeX/2) × (cliffSizeY/2)` tile lattice, row-major. */
  index: number
  /** Raw uint32 flags; preserve all bits, not only heuristic 0/1/2. */
  flags: number
  effectiveFlags?: number
  attributes?: Record<string, string>
  /** `cid` — index into `cliffSets`. */
  cliffSetIndex: number
  /** Raw uint16 variation; mapping to actual asset suffix is not fully established. */
  variation: number
}

/** One positioned frame of a `<ramp>`: `u(..) r(..) c=(..) w=.. h=..`. */
export interface TerrainRampFrame {
  /** Unit "up" vector along the ramp. */
  up: [number, number]
  /** Unit "right" vector across the ramp. */
  right: [number, number]
  /** Centre, in cliff-cell coordinates. */
  center: [number, number]
  width: number
  height: number
}

/**
 * One `<ramp>` of `<rampList>`. Ramps are authored objects with their own
 * geometry — no lattice rule derives them from the level field, which is why
 * ramp tiles have codes that ship in none of the cliff mesh sets.
 */
export interface TerrainRamp {
  /** Direction code, 3–7 observed. */
  dir: number
  /** Raw high/low codes. Physical units and mesh-letter mapping require validation. */
  hi: number
  lo: number
  /** `cid` — index into `cliffSets`. */
  cliffSetIndex: number
  rawAttributes?: Record<string, string>
  rampHardTileHandles?: string
  rawFrames?: Record<string, string>
  frames: {
    leftLo?: TerrainRampFrame
    leftHi?: TerrainRampFrame
    rightLo?: TerrainRampFrame
    rightHi?: TerrainRampFrame
    base?: TerrainRampFrame
    mid?: TerrainRampFrame
  }
  /** Per-corner variation; absent corners are `0xffffffff` in the file. */
  variations: {
    leftLo?: number
    leftHi?: number
    rightLo?: number
    rightHi?: number
  }
}

export interface TerrainInfo extends TerrainParams {
  version?: number
  uvTiling?: number[]
  vertDataName?: string
  masksName?: string
  textureSets?: TerrainTexture[]
  blockTextureSets?: Array<{ index: number; tileSet: number; attributes: Record<string, string> }>
  cliffDoodads?: Array<{ name: string; position: number[]; rotation: number; attributes: Record<string, string> }>
  diagnostics?: string[]
  defaultedParameters?: string[]
  uninterpretedElements?: string[]
  _raw?: { xml: string; document: XmlElementView }

  tileSet?: string
  dimX?: number
  dimY?: number
  /** World-space grid origin from `<heightMap offset="x y z">` (default 0 0 0). */
  offsetX?: number
  offsetY?: number
  offsetZ?: number
  /** World units per cell from `<heightMap scale="x y z">` (default 1 1 1). */
  scaleX?: number
  scaleY?: number
  scaleZ?: number
  /** Textures in declaration order (index from the `i=` attribute). */
  textures: TerrainTexture[]
  /** Map-selected CCliff ids, in editor cliff-set order. */
  cliffSets?: string[]
  /** `<cliffCellList num>` — size of the tile lattice (`cliffSize/2` squared). */
  cliffCellCount?: number
  /** Serialized occupied count, distinct from lattice size and decoded row count. */
  cliffCellOccupiedCount?: number
  /** Authored cliff tiles (`<cc>` rows), sparse: only occupied lattice cells. */
  cliffCells?: CliffCell[]
  /** Authored ramps (`<rampList>`). */
  ramps?: TerrainRamp[]
}

const FRAME_KEYS = ['leftLo', 'rightLo', 'leftHi', 'rightHi', 'base', 'mid'] as const
const CORNER_KEYS = ['leftLo', 'rightLo', 'leftHi', 'rightHi'] as const
function uintAttr(node: XmlElementView, key: string, fallback?: number, max = 0xffffffff): number {
  return integer(xmlNumber(node.attributes[key], `${node.name}.${key}`, fallback), 0, max, `${node.name}.${key}`)
}
function parseFrame(text: string): TerrainRampFrame | undefined {
  const n = '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)'
  const match = new RegExp(`^\\s*u\\(\\s*${n}\\s*,\\s*${n}\\s*\\)\\s*r\\(\\s*${n}\\s*,\\s*${n}\\s*\\)\\s*c=\\(\\s*${n}\\s*,\\s*${n}\\s*\\)\\s*w=${n}\\s*h=${n}\\s*$`).exec(text)
  if (!match) throw new Error(`RAMP_FRAME_INVALID: ${text}`)
  const v = match.slice(1).map(Number)
  if (!v.every(Number.isFinite)) throw new Error('RAMP_FRAME_NONFINITE')
  if (v.every(x => x === 0)) return undefined // rawFrames still retain the sentinel
  return {up: [v[0]!, v[1]!], right: [v[2]!, v[3]!], center: [v[4]!, v[5]!], width: v[6]!, height: v[7]!}
}
export function parseTerrainXml(xml: string): TerrainInfo {
  const root = parseStrictXml(xml)
  if (root.name.toLowerCase() !== 'terrain') throw new Error('TERRAIN_ROOT_REQUIRED')
  const hm = childNamed(root, 'heightMap')
  if (!hm) throw new Error('TERRAIN_HEIGHTMAP_REQUIRED')
  const diagnostics: string[] = [], defaultedParameters: string[] = []
  const version = uintAttr(root, 'version', 115)
  if (!root.attributes.version) defaultedParameters.push('version')
  const vert = childNamed(hm, 'vertData')
  const parameter = (name: string, fallback: number): number => {
    const v = vert?.attributes[name] ?? hm.attributes[name]
    if (v === undefined) defaultedParameters.push(name)
    return xmlNumber(v, `vertData.${name}`, fallback)
  }
  const dim = hm.attributes.dim === undefined ? undefined : xmlVector(hm.attributes.dim, 2, 'heightMap.dim')
  if (dim) for (const value of dim) integer(value, 1, 65536, 'heightMap.dim')
  const offset = xmlVector(hm.attributes.offset, 3, 'heightMap.offset', [0,0,0])
  const scale = xmlVector(hm.attributes.scale, 3, 'heightMap.scale', [1,1,1])
  if (scale.some(n => n === 0)) diagnostics.push('ZERO_GEOMETRY_SCALE')
  const section = (name: string) => childNamed(hm, name)
  const rows = (list: string, item: string): XmlElementView[] => {
    const node = section(list)
    return node ? childrenNamed(node, item) : []
  }
  const names = (list: string, item: string): TerrainTexture[] => {
    const used = new Set<number>()
    return rows(list, item).map(node => {
      const index = uintAttr(node, 'i')
      if (used.has(index)) diagnostics.push(`DUPLICATE_${item.toUpperCase()}_INDEX:${index}`)
      used.add(index)
      if (node.attributes.name === undefined) throw new Error(`${item}.name missing`)
      return {index, name: node.attributes.name}
    })
  }
  const cliffSets: string[] = []
  for (const row of names('cliffSetList','cliffSet')) {
    integer(row.index, 0, 65535, 'cliffSet index')
    cliffSets[row.index] = row.name
  }
  const cliffCells = rows('cliffCellList','cc').map(node => {
    const flags = uintAttr(node, 'f', 1), index = uintAttr(node, 'i')
    const cliffSetIndex = uintAttr(node,'cid',0,65535), variation = uintAttr(node,'cvar',0,65535)
    if (dim && index >= Math.floor((dim[0]!-1)/2) * Math.floor((dim[1]!-1)/2)) diagnostics.push(`CLIFF_CELL_OUTSIDE_LATTICE:${index}`)
    return {index, flags, effectiveFlags: version <= 112 ? (flags & ~4) >>> 0 : flags, cliffSetIndex, variation, attributes: {...node.attributes}}
  })
  const ramps: TerrainRamp[] = rows('rampList','ramp').map(node => {
    const frames: TerrainRamp['frames'] = {}, rawFrames: Record<string, string> = {}
    for (const key of FRAME_KEYS) {
      const text = node.attributes[key]
      if (text === undefined) continue
      rawFrames[key] = text
      const frame = parseFrame(text)
      if (frame) frames[key] = frame
    }
    const variations: TerrainRamp['variations'] = {}
    for (const key of CORNER_KEYS) {
      if (node.attributes[`${key}Var`] === undefined) continue
      const value = uintAttr(node,`${key}Var`)
      if (value !== 0xffffffff) variations[key] = value
    }
    const dir = uintAttr(node,'dir',0,255), hi = uintAttr(node,'hi',0), lo = uintAttr(node,'lo',0)
    if (dir === 0 || hi >= 8 || lo >= 16) diagnostics.push('RAMP_REFERENCE_VALIDITY_CHECK_FAILED')
    return {dir, hi, lo, cliffSetIndex: uintAttr(node,'cid',0), frames, variations, rawFrames, rawAttributes:{...node.attributes}, rampHardTileHandles:node.attributes.rampHardTileHandles}
  })
  const cliffDoodads = rows('cliffDoodadList','cliffDoodad').map(node => ({
    name: node.attributes.name ?? '', position: xmlVector(node.attributes.pos, 3, 'cliffDoodad.pos', [0,0,0]), rotation:uintAttr(node,'rot',0), attributes:{...node.attributes},
  }))
  const blockTextureSets = rows('blockTextureSetList','blockTextureSet').map(node => ({index:uintAttr(node,'i'),tileSet:uintAttr(node,'tileSet',0),attributes:{...node.attributes}}))
  const known = new Set(['terrain','heightmap','vertdata','masks','texturesetlist','textureset','texturelist','texture','cliffsetlist','cliffset','cliffcelllist','cc','ramplist','ramp','cliffdoodadlist','cliffdoodad','blocktexturesetlist','blocktextureset'])
  const uninterpretedElements: string[] = []
  const walk = (node: XmlElementView, parent: string): void => {
    const path = `${parent}/${node.name}`
    if (!known.has(node.name.toLowerCase())) uninterpretedElements.push(path)
    for (const child of node.children) walk(child,path)
  }
  walk(root,'')
  const ccSection = section('cliffCellList')
  const quantizeScale=parameter('quantizeScale',0.1)
  if(quantizeScale<=0)diagnostics.push('NONPOSITIVE_QUANTIZE_SCALE')
  const occupied=ccSection?.attributes.numOccupied===undefined?undefined:uintAttr(ccSection,'numOccupied')
  if(occupied!==undefined&&occupied!==cliffCells.length)diagnostics.push('CLIFF_OCCUPIED_COUNT_DIFFERS_FROM_PARSED_ROWS')
  return {
    version, tileSet:hm.attributes.tileSet, dimX:dim?.[0], dimY:dim?.[1],
    quantizeScale, quantizeBias:parameter('quantizeBias',0), standardHeight:parameter('standardHeight',8),
    offsetX:offset[0],offsetY:offset[1],offsetZ:offset[2],scaleX:scale[0],scaleY:scale[1],scaleZ:scale[2],
    uvTiling:xmlVector(hm.attributes.uvtiling,4,'heightMap.uvtiling',[1,1,0,0]),
    vertDataName:vert?.attributes.name ?? 't3HeightMap', masksName:section('masks')?.attributes.name ?? 't3TextureMasks',
    textures:names('textureList','texture'),textureSets:names('textureSetList','textureSet'),blockTextureSets,
    cliffSets,cliffCells,cliffCellCount:ccSection?.attributes.num === undefined ? undefined : uintAttr(ccSection,'num'),
    cliffCellOccupiedCount:occupied,cliffDoodads,ramps,diagnostics,defaultedParameters,uninterpretedElements,_raw:{xml,document:root},
  }
}
/** No-op persistence only. Semantic XML changes must use a minimal-diff patcher and revalidation. */
export function writeTerrainXml(info: TerrainInfo): string {
  if (!info._raw) throw new Error('TERRAIN_XML_ORIGINAL_REQUIRED')
  const before = parseTerrainXml(info._raw.xml)
  const semantic = (value: TerrainInfo) => JSON.stringify({...value,_raw:undefined})
  if (semantic(before) !== semantic(info)) throw new Error('TERRAIN_XML_SEMANTIC_WRITE_REQUIRES_PATCH')
  return info._raw.xml
}
