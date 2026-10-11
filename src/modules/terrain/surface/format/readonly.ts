/** Prevent opaque/read-only codecs from silently discarding user edits. */
const originals = new WeakMap<object, unknown>()
function same(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true
  if (depth > 64) throw new Error('COMPARISON_DEPTH_EXCEEDED')
  if (a instanceof Uint8Array && b instanceof Uint8Array)
    return a.length === b.length && a.every((v, i) => v === b[i])
  if (a instanceof Uint32Array && b instanceof Uint32Array)
    return a.length === b.length && a.every((v, i) => v === b[i])
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const ak = Object.keys(a), bk = Object.keys(b)
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1))
}
export function protectReadOnly<T extends { raw: Uint8Array }>(model: T): T {
  originals.set(model, structuredClone(model)); return model
}
export function preservedReadOnlyBytes<T extends { raw: Uint8Array }>(model: T): Uint8Array {
  const original = originals.get(model) as T | undefined
  if (!original) throw new Error('READ_ONLY_MODEL_MUST_ORIGINATE_FROM_READER')
  if (!same(model, original)) throw new Error('SEMANTIC_WRITE_UNAVAILABLE: model changed; no edits were discarded')
  return original.raw.slice()
}
