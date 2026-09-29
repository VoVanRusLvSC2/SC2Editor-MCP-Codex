import type { DataFieldPathSegment } from "./types.js";

const SEGMENT = /^([A-Za-z_][A-Za-z0-9_:.-]*)(?:\[([^\]]+)\])?$/;

export function parseDataFieldPath(value: string): DataFieldPathSegment[] {
  if (!value.trim()) throw new Error("Data field path must not be empty");
  const parts:string[]=[];let start=0,depth=0;
  for(let i=0;i<value.length;i++){if(value[i]==="[")depth++;if(value[i]==="]")depth--;if(value[i]==="."&&depth===0){parts.push(value.slice(start,i));start=i+1;}}
  parts.push(value.slice(start));
  return parts.map((part) => {
    const match = SEGMENT.exec(part);
    if (!match) throw new Error(`Invalid Data field path segment '${part}' in '${value}'`);
    return /^#\d+$/.test(match[2]??"") ? {name:match[1],ordinal:Number(match[2].slice(1))} : { name: match[1], index: match[2] };
  });
}

export function formatDataFieldPath(segments: DataFieldPathSegment[]): string {
  return segments.map((entry) => entry.ordinal!==undefined ? `${entry.name}[#${entry.ordinal}]` : entry.index === undefined ? entry.name : `${entry.name}[${entry.index}]`).join(".");
}
