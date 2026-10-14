import {createGlobalLightingKernel} from '../lighting/math.js';
import {createGlobalToneMath} from '../lighting/tone.js';
import type {GlobalLighting} from '../lighting/types.js';
import { deflateSync } from "node:zlib";
import type { TerrainState } from "./operations.js";
export type PreviewMode = "height" | "texture" | "water" | "cliff" | "visibility" | "lit";
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type),
    head = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  tail.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([head, t, data, tail]);
}
export function renderTerrainPng(
  state: TerrainState,
  mode: PreviewMode = "height",
  size = 128,
  lighting?:GlobalLighting,
): Buffer {
  if (!Number.isInteger(size) || size < 16 || size > 512)
    throw new Error("PREVIEW_SIZE_RANGE");
  const hm = state.heights, lightMath=createGlobalLightingKernel(),tone=createGlobalToneMath();
  let min = Infinity,
    max = -Infinity;
  for (let y = 0; y < hm.height; y++)
    for (let x = 0; x < hm.width; x++)
      if (hm.mask(x, y) !== 0) {
        const z = hm.z(x, y);
        min = Math.min(min, z);
        max = Math.max(max, z);
      }
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const colors = [
    [80, 125, 65],
    [151, 126, 86],
    [155, 151, 145],
    [196, 182, 131],
    [82, 119, 126],
    [110, 79, 65],
    [126, 127, 102],
    [179, 184, 167],
  ];
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const gx = ((px + 0.5) / size) * (hm.width - 1),
        gy = (1 - (py + 0.5) / size) * (hm.height - 1);
      const p = {
        x: gx * state.descriptor.scale[0] + state.descriptor.offset[0],
        y: gy * state.descriptor.scale[1] + state.descriptor.offset[1],
      };
      const sample = hm.sample(p);
      let rgb: number[];
      const hidden = state.visibility?.atGrid(gx, gy) ?? false;
      if (hidden) rgb = [0, 0, 0];
      else if (sample.mask === 0) rgb = [31, 35, 44];
      else if (mode === "visibility") rgb = [150, 190, 130];
      else if (mode === "cliff") rgb = colors[sample.mask % 8];
      else if ((mode === "texture" || mode === "lit") && state.masks) {
        const x = Math.min(state.masks.width - 1, Math.floor(gx * 8)),
          y = Math.min(state.masks.height - 1, Math.floor(gy * 8)),
          weights = state.masks.weights(x, y),
          sum = weights.reduce((a, b) => a + b, 0) || 1;
        rgb = [0, 1, 2].map((c) =>
          Math.round(
            weights.reduce((v, w, l) => v + w * colors[l][c], 0) / sum,
          ),
        );
      } else {
        const t = max === min ? 0.5 : (sample.height - min) / (max - min);
        rgb = [
          Math.round(42 + 178 * t),
          Math.round(65 + 160 * t),
          Math.round(80 + 150 * t),
        ];
      }
      if (!hidden && mode === "water" && state.water?.at(p).length) rgb = [45, 128, 200];
      if(mode==='lit'&&lighting&&!hidden&&sample.mask!==0){
        const left=Math.max(0,gx-1),right=Math.min(hm.width-1,gx+1),bottom=Math.max(0,gy-1),top=Math.min(hm.height-1,gy+1);
        const at=(x:number,y:number)=>hm.sample({x:x*state.descriptor.scale[0]+state.descriptor.offset[0],y:y*state.descriptor.scale[1]+state.descriptor.offset[1]}).height;
        const normal=[-(at(right,gy)-at(left,gy))/((right-left)*state.descriptor.scale[0]),-(at(gx,top)-at(gx,bottom))/((top-bottom)*state.descriptor.scale[1]),1],params=lighting.parameters??{};
        const lit=lightMath.diffuse(lighting,normal,rgb.map(v=>v/255),1,lightMath.cube(lighting,normal));
        rgb=tone.color(lit,lighting.operatorHDR??0,params.HDRExposure??1,params.HDRContrast??1,params.HDRWhitePoint??1,!!params.HDRWhiteShift).map(v=>Math.round(Math.max(0,Math.min(1,v))*255));
      }
      const off = py * (size * 3 + 1) + 1 + px * 3;
      for (let c = 0; c < 3; c++) raw[off + c] = rgb[c];
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
