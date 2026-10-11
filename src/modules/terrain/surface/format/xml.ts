import { DOMParser } from '@xmldom/xmldom'
/** A bounded XML view. Original XML remains the write authority: this is not a lossy serializer. */
export interface XmlProcessingInstructionView {
  target: string
  data: string
  /** Number of element children preceding this instruction; not a byte offset. */
  beforeChildIndex: number
}
export interface XmlElementView {
  name: string
  attributes: Record<string, string>
  children: XmlElementView[]
  text: string
  /** Preserved inspection metadata. Original XML remains the serialization authority. */
  processingInstructions?: XmlProcessingInstructionView[]
}
export function parseStrictXml(xml: string): XmlElementView {
  if (xml.length > 8 * 1024 * 1024) throw new RangeError('XML_INPUT_BUDGET_EXCEEDED')
  // No DTD/external-entity resolution is needed for map components.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('XML_DTD_ENTITY_DISABLED')
  const doc = new DOMParser({onError: (level, message) => { throw new Error(`XML_${level}: ${message}`) }}).parseFromString(xml, 'application/xml')
  const root = doc.documentElement
  if (!root) throw new Error('XML_ROOT_MISSING')
  let count = 0
  const convert = (node: typeof root, depth: number): XmlElementView => {
    if (depth > 64 || ++count > 100_000) throw new RangeError('XML_TREE_BUDGET_EXCEEDED')
    const attributes: Record<string, string> = Object.create(null) as Record<string, string>
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes.item(i)!
      attributes[attr.name] = attr.value
    }
    const children: XmlElementView[] = []
    let text = ''
    const processingInstructions: XmlProcessingInstructionView[] = []
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes.item(i)!
      if (child.nodeType === 1) children.push(convert(child as typeof root, depth + 1))
      else if (child.nodeType === 3 || child.nodeType === 4) text += child.nodeValue ?? ''
      else if (child.nodeType === 7) processingInstructions.push({
        target: child.nodeName, data: child.nodeValue ?? '', beforeChildIndex: children.length
      })
    }
    return {name: node.tagName, attributes, children, text,
      ...(processingInstructions.length ? {processingInstructions} : {})}
  }
  return convert(root, 0)
}
export function childrenNamed(node: XmlElementView, name: string): XmlElementView[] {
  return node.children.filter(child => child.name.toLowerCase() === name.toLowerCase())
}
export function childNamed(node: XmlElementView, name: string): XmlElementView | undefined {
  const matches = childrenNamed(node, name)
  if (matches.length > 1) throw new Error(`XML_DUPLICATE_ELEMENT: ${name}`)
  return matches[0]
}
export function xmlNumber(text: string | undefined, label: string, fallback?: number): number {
  if (text === undefined) {
    if (fallback !== undefined) return fallback
    throw new Error(`XML_MISSING_NUMBER: ${label}`)
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim())) throw new Error(`XML_BAD_NUMBER: ${label}=${text}`)
  const value = Number(text)
  if (!Number.isFinite(value)) throw new Error(`XML_NONFINITE: ${label}`)
  return value
}
export function xmlVector(text: string | undefined, size: number, label: string, fallback?: number[]): number[] {
  if (text === undefined && fallback) return fallback.slice()
  const items = text?.trim().split(/\s+/) ?? []
  if (items.length !== size) throw new Error(`XML_VECTOR_LENGTH: ${label}`)
  return items.map((item, i) => xmlNumber(item, `${label}[${i}]`))
}
