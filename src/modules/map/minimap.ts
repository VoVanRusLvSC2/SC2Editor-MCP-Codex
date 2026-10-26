/** Native-style uncompressed, top-left-origin TGA 2.0 (BGR24 + footer). */
export function minimapTga(rgb: Uint8Array, width: number, height: number): Buffer {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1024||height>1024||rgb.length!==width*height*3)throw Error('MINIMAP_PIXEL_BOUNDS');
  const bytes=Buffer.alloc(18+rgb.length+26);
  bytes[2]=2;bytes.writeUInt16LE(width,12);bytes.writeUInt16LE(height,14);bytes[16]=24;bytes[17]=32;
  for(let i=0;i<rgb.length;i+=3){bytes[18+i]=rgb[i+2];bytes[19+i]=rgb[i+1];bytes[20+i]=rgb[i];}
  bytes.write('TRUEVISION-XFILE.\0',bytes.length-18,'ascii');
  return bytes;
}
