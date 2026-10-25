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
assert.equal(record.live.sourceUnchanged,true);
assert.equal(record.live.compile.nativeCompilePassed,true);assert.equal(record.live.gracefulStop,true);
assert.equal(record.live.saveReopen.componentComparison.savedToReopenedEqual,true);
assert.equal(record.regressions.final.fail,0);
assert.equal(record.regressions.final.tests,record.regressions.final.pass+record.regressions.final.skipped);
assert.equal(record.protocols.publicEditorTools.length,7);assert.equal(record.protocols.allUpstreamToolsExecuted,false);
const extract=await fs.readFile(path.join(root,'docs/verification',record.regressions.publicStatusExtract));
assert.equal(createHash('sha256').update(extract).digest('hex'),record.regressions.publicStatusExtractSha256);
for(const frame of record.live.savedCameras){assert.equal(frame.mapCamera.nativeSelectionVerified,true);assert.equal(frame.mcpImage.matchesArtifact,true);}
async function fingerprints(files){const changed=[];for(const {file,sha256LfUtf8} of files){
  const target=path.resolve(root,file),relative=path.relative(root,target);
  assert.ok(!path.isAbsolute(relative)&&!relative.startsWith('..'),'Source fingerprint outside repository');
  const text=(await fs.readFile(target,'utf8')).replaceAll('\r\n','\n');
  if(createHash('sha256').update(text).digest('hex')!==sha256LfUtf8)changed.push(file);
}return changed;}
const historicalChanges=await fingerprints(record.nativeBridgeSourceFingerprints.files);
const current=await load('docs/verification/toolkit-update-2026-10-21.json');
assert.equal(current.runtime.version,pin.version);assert.equal(current.runtime.nativeProtocol,pin.nativeProtocol);assert.equal(current.runtime.archiveSha256,pin.archiveSha256);
assert.deepEqual(await fingerprints(current.sourceFingerprints),[],'Update evidence source scope after changing reviewed files');
if(current.gameToolkitEvidence){
 const game=JSON.parse(await fs.readFile(path.join(root,'docs/verification',current.gameToolkitEvidence),'utf8'));
 const pin=JSON.parse(await fs.readFile(path.join(root,'game-toolkit-release.json'),'utf8'));
 assert.equal(game.release.releaseTag,'v'+pin.version);assert.equal(game.release.archiveSha256,pin.archiveSha256);
 assert.deepEqual(await fingerprints(game.sourceFingerprints),[],'Refresh scoped game evidence after adapter changes');
 assert.equal(game.extended.outcome,'passed');assert.equal(game.extended.calledOperations.length,18);
 assert.equal(game.lifecycle.runs.length,4);assert.ok(game.lifecycle.runs.every(r=>r.outcome==='passed'));assert.equal(game.lifecycle.sameRetainedBridge,true);
 assert.equal(game.privacy.passed,true);assert.equal(game.privacy.privateRuntimeBundled,false);assert.equal(game.regressions.fail,0);
 assert.equal(game.metadataReader.positive,'passed');assert.equal(game.metadataReader.negativeBlockedBeforeLaunch,true);
}
assert.equal(current.modkit.outcome,'passed');assert.equal(current.dataPresentation.outcome,'passed');assert.equal(current.privacy.passed,true);
if(current.terrainJunctionEvidence){
 const terrain=await load('docs/verification/'+current.terrainJunctionEvidence);
 assert.deepEqual(await fingerprints(terrain.sourceFingerprints),[],'Refresh terrain evidence after changing its scoped implementation');
 assert.equal(terrain.render.outcome,'passed');assert.equal(terrain.render.images.length,5);assert.equal(terrain.traversal.sameRetainedBridge,true);
 const routes=terrain.traversal.runs.flatMap(r=>r.checks.filter(c=>c.id.startsWith('route:')&&!c.id.endsWith(':cleanup')));
 assert.equal(routes.length,32);assert.ok(routes.every(c=>c.status==='passed'&&c.evidence.arrived&&c.evidence.maxObservedDeviation<=c.evidence.maxDeviation));
 assert.ok(terrain.traversal.runs.every(r=>r.outcome==='passed'&&r.sourceSha256===terrain.render.sourceSha256));
 assert.equal(terrain.repair.legacyRamp.repairedArchiveSha256,terrain.render.sourceSha256);assert.equal(terrain.repair.legacyRamp.repeat.sourceUnchanged,true);
 assert.equal(terrain.repair.cliff.diff.coarseVerticesChanged,0);assert.equal(terrain.repair.cliff.diff.baseHeightsChanged,0);assert.equal(terrain.regressions.fail,0);
 assert.equal(terrain.scope.nativeNavigationRebuilt,false);assert.equal(terrain.scope.allCliffsCertified,false);
}
const accepted=current.native.liveAcceptance==='passed'&&current.native.currentAdapterAcceptance===true,integrityOnly=process.argv.includes('--integrity-only');
process.stdout.write(JSON.stringify({ok:integrityOnly||accepted,integrity:true,currentNativeAcceptance:accepted,toolkit:pin.version,nativeProtocol:pin.nativeProtocol,
  historical:{version:record.runtime.version,currentSourceDifferences:historicalChanges.length,scope:'Retained original observations; not current acceptance'},
  pending:accepted?[]:['Renew complete live native acceptance for the pinned executable and current adapter'],
  openCoverage:current.native.openCoverage,allFeaturesCertified:false,
  scope:'Recorded evidence integrity and explicit current acceptance gate; no Editor execution or automatic certification.'})+'\n');
if(!integrityOnly&&!accepted)process.exitCode=1;
