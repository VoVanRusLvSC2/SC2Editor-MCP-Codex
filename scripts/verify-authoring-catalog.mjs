/* global process */
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../resources/authoring-catalog');
const manifest=JSON.parse(await fs.readFile(path.join(root,'IMPORT.json'),'utf8'));
let bytes=0;
for(const entry of manifest.entries){
 const file=path.resolve(root,entry.storage);if(!file.startsWith(root+path.sep))throw new Error('CATALOG_MANIFEST_PATH');
 const stored=await fs.readFile(file),raw=entry.storage.endsWith('.gz')?gunzipSync(stored,{maxOutputLength:32*1024*1024}):stored;
 if(raw.length!==entry.bytes||createHash('sha256').update(raw).digest('hex')!==entry.sha256)throw new Error('CATALOG_CHECKSUM: '+entry.file);
 if(entry.file.endsWith('.json'))JSON.parse(raw.toString('utf8'));
 bytes+=raw.length;
}
process.stdout.write(JSON.stringify({ok:true,files:manifest.entries.length,originalBytes:bytes,sourceSha256:manifest.sourceSha256,scope:'Imported payload integrity and JSON parsing; no engine or visual certification'})+'\n');
