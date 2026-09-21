import type { DataFieldPathSegment } from "./types.js";

const SEGMENT = /^([A-Za-z_][A-Za-z0-9_:.-]*)(?:\[([^\]]+)\])?$/;

export function parseDataFieldPath(value: string): DataFieldPathSegment[] {
  if (!value.trim()) throw new Error("Data field path must not be empty");
  return value.split(".").map((part) => {
    const match = SEGMENT.exec(part);
    if (!match) throw new Error(`Invalid Data field path segment '${part}' in '${value}'`);
    return { name: match[1], index: match[2] };
  });
}

export function formatDataFieldPath(segments: DataFieldPathSegment[]): string {
  return segments.map((entry) => entry.index === undefined ? entry.name : `${entry.name}[${entry.index}]`).join(".");
}
