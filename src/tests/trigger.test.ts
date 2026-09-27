import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../core/workspace.js';
import { TriggerWorkspace } from '../modules/trigger/workspace.js';

test('GUI event graft keeps category and trigger IDs while remapping colliding graph IDs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sc2-trigger-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = '<TriggerData><Library Id="810D62ED"><Element Type="Category" Id="AAAA0001"><Identifier>OriginalFolder</Identifier></Element><Element Type="Trigger" Id="AAAA0002"><Identifier>Vote</Identifier><Action Type="FunctionCall" Library="810D62ED" Id="AAAA0003" /></Element><Element Type="FunctionCall" Id="AAAA0003"><ScriptCode>Old();</ScriptCode></Element></Library></TriggerData>';
  const source = '<TriggerData><Library Id="810D62ED"><Element Type="Trigger" Id="BBBB0001"><Identifier>Vote</Identifier><Event Type="FunctionCall" Library="810D62ED" Id="AAAA0003" /></Element><Element Type="FunctionCall" Id="AAAA0003"><Parameter Type="Param" Library="810D62ED" Id="BBBB0002" /></Element><Element Type="Param" Id="BBBB0002"><Value>0.5</Value></Element></Library></TriggerData>';
  await fs.writeFile(path.join(root, 'Triggers'), target);
  await fs.writeFile(path.join(root, 'source.xml'), source);
  const workspace = new TriggerWorkspace(new Workspace(root));
  const preview = await workspace.graft({ sourceFile: 'source.xml', sourceTrigger: 'Vote', targetTrigger: 'Vote', kind: 'Event', index: 0 });
  assert.equal(preview.copiedElements, 2);
  assert.equal(await fs.readFile(path.join(root, 'Triggers'), 'utf8'), target);
  await workspace.graft({ sourceFile: 'source.xml', sourceTrigger: 'Vote', targetTrigger: 'Vote', kind: 'Event', index: 0, dryRun: false });
  await fs.writeFile(path.join(root, 'source.xml'), source.replace('0.5', '1.0'));
  await assert.rejects(workspace.save(false), /STALE_FILE_TRANSACTION|STALE_DEPENDENCY/);
  await fs.writeFile(path.join(root, 'source.xml'), source);
  await workspace.save(false);
  const after = await fs.readFile(path.join(root, 'Triggers'), 'utf8');
  assert.match(after, /<Identifier>OriginalFolder<\/Identifier>/);
  assert.match(after, /<Element Type="Trigger" Id="AAAA0002">/);
  assert.match(after, /<ScriptCode>Old\(\);<\/ScriptCode>/);
  assert.equal((after.match(/<Element Type="FunctionCall" Id="AAAA0003">/g) ?? []).length, 1);
  const details = await workspace.get('Vote');
  assert.equal(details.references.filter(x => x.kind === 'Event').length, 1);
  assert.equal(details.references.filter(x => x.kind === 'Action').length, 1);
});

test('GUI triggers without Identifier can be inspected and selected by ID', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sc2-trigger-id-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'Triggers'), '<TriggerData><Library Id="810D62ED"><Element Type="Trigger" Id="20DF7BE4"><Action Type="FunctionCall" Library="810D62ED" Id="1F1812E9"/></Element><Element Type="FunctionCall" Id="1F1812E9"><ScriptCode>Run();</ScriptCode></Element></Library></TriggerData>');
  const workspace = new TriggerWorkspace(new Workspace(root));
  const listing = await workspace.inspect();
  assert.equal(listing.count, 1);
  assert.equal(listing.triggers[0]?.identifier, '20DF7BE4');
  const details = await workspace.get('20DF7BE4');
  assert.equal(details.references[0]?.id, '1F1812E9');
});
