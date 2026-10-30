import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Workspace } from '../core/workspace.js';
import { SettingsWorkspace } from '../modules/settings/workspace.js';

test('restoring missing Attributes preserves opaque MapInfo and all existing attributes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sc2-legacy-attributes-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const mapInfo = Buffer.alloc(40); mapInfo.writeUInt32LE(0x4d617049); mapInfo.writeUInt32LE(34, 4);
  await fs.writeFile(path.join(root, 'MapInfo'), mapInfo);
  await fs.writeFile(path.join(root, 'ComponentList.SC2Components'), '<Components><DataComponent Type="attr">Attributes</DataComponent></Components>');
  const settings = new SettingsWorkspace(new Workspace(root));
  const plan = await settings.plan({operations: [{op: 'attributes.ensure', reason: 'Restore the declared missing component.'}]});
  assert.equal(plan.after.mapInfo, 'UNCHANGED_NOT_PARSED');
  assert.deepEqual(plan.files.map(file => file.file), ['Attributes']);
  await settings.apply(plan.id, {dryRun: false, stage: false});
  assert.deepEqual(await fs.readFile(path.join(root, 'MapInfo')), mapInfo);
  const second = await settings.plan({operations: [{op: 'attributes.ensure', reason: 'Idempotency check.'}]});
  assert.deepEqual(second.files, []);
  await fs.writeFile(path.join(root, 'Attributes'), '<wrong/>');
  await assert.rejects(settings.plan({operations: [{op: 'attributes.ensure', reason: 'No malformed data replacement.'}]}));
  await assert.rejects(settings.plan({operations: [{op: 'options.set', patch: {hideErrorsTest: true}}]}));
});
