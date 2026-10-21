// Validate the published record's internal consistency and current source scope.
// This checks evidence integrity; it does not rerun the original Editor.
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,URL} from 'node:url';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const load=async p=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const record=await load('docs/verification/native-editor-0.9.2.json'),pin=await load('native-toolkit-release.json');
assert.equal(record.runtime.version,pin.version);assert.equal(record.runtime.nativeProtocol,pin.nativeProtocol);
assert.equal(record.runtime.archiveSha256,pin.archiveSha256);assert.equal(record.live.sourceUnchanged,true);
assert.equal(record.live.compile.nativeCompilePassed,true);assert.equal(record.live.gracefulStop,true);
assert.equal(record.live.saveReopen.componentComparison.savedToReopenedEqual,true);
assert.equal(record.regressions.final.fail,0);
assert.equal(record.regressions.final.tests,record.regressions.final.pass+record.regressions.final.skipped);
assert.equal(record.protocols.publicEditorTools.length,7);assert.equal(record.protocols.allUpstreamToolsExecuted,false);
const extract=await fs.readFile(path.join(root,'docs/verification',record.regressions.publicStatusExtract));
assert.equal(createHash('sha256').update(extract).digest('hex'),record.regressions.publicStatusExtractSha256);
for(const frame of record.live.savedCameras){assert.equal(frame.mapCamera.nativeSelectionVerified,true);assert.equal(frame.mcpImage.matchesArtifact,true);}
for(const {file,sha256LfUtf8} of record.nativeBridgeSourceFingerprints.files){
  const target=path.resolve(root,file),relative=path.relative(root,target);
  assert.ok(!path.isAbsolute(relative)&&!relative.startsWith('..'),'Source fingerprint outside repository');
  const text=(await fs.readFile(target,'utf8')).replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(text).digest('hex'),sha256LfUtf8,'Renew native evidence scope after changing '+file);
}
process.stdout.write(JSON.stringify({ok:true,toolkit:pin.version,nativeProtocol:pin.nativeProtocol,sourceFingerprints:record.nativeBridgeSourceFingerprints.files.length,
  coreRegressions:record.regressions.final,scope:'Published record/source integrity; original Editor execution is recorded, not rerun.'})+'\n');
