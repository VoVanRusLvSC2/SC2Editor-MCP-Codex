/** Resource and numeric guards for untrusted map input. These are toolkit limits, not engine limits. */
export const MAX_INPUT_BYTES = 128 * 1024 * 1024
export const MAX_CELLS = 4_194_304
export const MAX_RECORDS = 100_000
export function integer(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label}: expected integer ${min}..${max}, got ${value}`)
  }
  return value
}
export function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label}: finite number required`)
  return value
}
export function inputSize(data: Uint8Array): void {
  if (data.byteLength > MAX_INPUT_BYTES) throw new RangeError('INPUT_BUDGET_EXCEEDED')
}
export function countBytes(count: number, stride: number, available: number, label: string, max = MAX_CELLS): number {
  integer(count, 0, max, `${label} count`)
  integer(stride, 1, MAX_INPUT_BYTES, `${label} stride`)
  const size = count * stride
  if (!Number.isSafeInteger(size) || size > available) throw new RangeError(`${label}: truncated; need ${size}, have ${available}`)
  return count
}
export function gridCount(x: number, y: number, stride = 1, available = MAX_INPUT_BYTES, label = 'grid'): number {
  integer(x, 1, MAX_CELLS, `${label} width`); integer(y, 1, MAX_CELLS, `${label} height`)
  return countBytes(x * y, stride, available, label)
}
export function cellIndex(x: number, y: number, width: number, height: number): number {
  integer(x, 0, width - 1, 'x'); integer(y, 0, height - 1, 'y')
  return y * width + x
}
export function bytesLength(bytes: Uint8Array, expected: number, label: string): void {
  if (bytes.length !== expected) throw new RangeError(`${label}: expected ${expected} bytes, got ${bytes.length}`)
}
export function versionIs(version: number, allowed: readonly number[], label: string): void {
  if (!allowed.includes(version)) throw new RangeError(`${label}: unsupported version ${version}`)
}
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
