/** Small native SEQS v2 fixture: binary metadata, not a caller-supplied inventory. */
export function sequenceModel(names=['Attack','Spell','Stand Victory']){
 const sections:Array<{tag:string;bytes:Buffer;count:number;version:number}>=[{tag:'MODL',bytes:Buffer.alloc(124),count:1,version:23},{tag:'SEQS',bytes:Buffer.alloc(92*names.length),count:names.length,version:2},...names.map(name=>({tag:'CHAR',bytes:Buffer.from(name+'\0'),count:Buffer.byteLength(name)+1,version:0}))];
 names.forEach((_,i)=>{sections[1].bytes.writeUInt32LE(sections[i+2].count,i*92+8);sections[1].bytes.writeUInt32LE(i+2,i*92+12);});
 let offset=24;const offsets=sections.map(s=>{const at=offset;offset+=s.bytes.length;return at;}),b=Buffer.alloc(offset+sections.length*16);b.write('43DM');b.writeUInt32LE(offset,4);b.writeUInt32LE(sections.length,8);b.writeUInt32LE(1,12);
 sections.forEach((s,i)=>{s.bytes.copy(b,offsets[i]);const at=offset+i*16;b.write(s.tag.split('').reverse().join(''),at);b.writeUInt32LE(offsets[i],at+4);b.writeUInt32LE(s.count,at+8);b.writeUInt32LE(s.version,at+12);});return b;
}
