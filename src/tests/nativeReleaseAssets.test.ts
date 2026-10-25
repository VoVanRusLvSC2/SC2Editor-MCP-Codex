import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {nativeReleaseAssets,nativePublishedChecksum,nativeBuildMetadata}=await import(pathToFileURL(path.resolve('scripts/native-release-assets.mjs')).href);
const digest='2c49df1f3d16adaa3598413d2458080c9f22099306867f2afc9361d1909b8b6d';

test('native release setup supports the protocol15 asset layout and preserves legacy defaults',()=>{
 const release=nativeReleaseAssets({version:'0.14.0-rc.1',repository:'VoVanRusLvSC2/SC2EditorToolkit',assetPrefix:'SC2EditorToolkit',asset:'SC2EditorToolkit-v0.14.0-rc.1-win64.zip',checksumAsset:'SHA256SUMS.txt'});
 assert.equal(release.name,'SC2EditorToolkit-v0.14.0-rc.1-win64.zip');assert.ok(release.url.endsWith('/v0.14.0-rc.1/'+release.name));assert.ok(release.checksumUrl.endsWith('/SHA256SUMS.txt'));assert.equal(release.allowBareChecksum,false);
 const legacy=nativeReleaseAssets({version:'0.13.0-rc.1'});assert.equal(legacy.name,'SC2NativeToolkit-v0.13.0-rc.1-win-x64.zip');assert.equal(legacy.checksumUrl,legacy.url+'.sha256');assert.equal(legacy.allowBareChecksum,true);
});

test('published checksums select the exact archive entry rather than the first digest',()=>{
 const name='SC2EditorToolkit-v0.14.0-rc.1-win64.zip',other='0'.repeat(64);
 assert.equal(nativePublishedChecksum(`${other}  unrelated.zip\r\n${digest.toUpperCase()} *${name}\r\n`,name),digest);
 assert.equal(nativePublishedChecksum(`${digest}  ./${name}`,name),digest);
 assert.throws(()=>nativePublishedChecksum(`${digest}  unrelated.zip`,name),/MISSING/);
 assert.throws(()=>nativePublishedChecksum(digest,name),/MISSING/);assert.equal(nativePublishedChecksum(digest,name,true),digest);
 assert.throws(()=>nativePublishedChecksum(`${digest} ${name}\n${digest} ${name}`,name),/AMBIGUOUS/);
});

test('native release asset names cannot redirect extraction or checksum lookup paths',()=>{
 for(const asset of ['../x.zip','C:/x.zip','x\\y.zip','https://x/y.zip','.zip','x.tar'])assert.throws(()=>nativeReleaseAssets({version:'0.14.0-rc.1',asset}),/ASSET_INVALID/);
 for(const checksumAsset of ['../SHA256SUMS.txt','/tmp/sums','x\\sums','SC2NativeToolkit-v0.14.0-rc.1-win-x64.zip'])assert.throws(()=>nativeReleaseAssets({version:'0.14.0-rc.1',checksumAsset}),/ASSET_INVALID/);
 assert.throws(()=>nativeReleaseAssets({version:'0.14.0-rc.1',repository:'x/y/../../z'}),/LOCATION_INVALID/);
});

test('embedded build metadata is explicit while legacy BUILD.json mismatches still reject',()=>{
 const pin={version:'0.14.0-rc.1',nativeProtocol:15};
 assert.deepEqual(nativeBuildMetadata({...pin,buildMetadata:'embedded'}),{...pin,buildMetadata:'embedded'});
 assert.throws(()=>nativeBuildMetadata(pin),/PROTOCOL_MISMATCH/);
 assert.throws(()=>nativeBuildMetadata(pin,{...pin,nativeProtocol:14}),/PROTOCOL_MISMATCH/);
 assert.equal(nativeBuildMetadata(pin,{...pin,sourceCommit:'original'}).sourceCommit,'original');
 assert.throws(()=>nativeBuildMetadata({...pin,buildMetadata:'optional'}),/METADATA_INVALID/);
});
