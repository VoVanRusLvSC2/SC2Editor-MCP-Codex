import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../core/workspace.js';
import { TriggerWorkspace } from '../modules/trigger/workspace.js';
import { normalizeCustomScriptLayout } from '../modules/trigger/scriptLayout.js';

test('editor ScriptCode layout preserves graph and every executable character', () => {
  const xml = '<TriggerData>\n    <Library Id="810D62ED">\n        <Root><Item Type="Category" Library="810D62ED" Id="AAAA0001"/></Root>\n        <Element Type="Category" Id="AAAA0001"><Item Type="Trigger" Library="810D62ED" Id="AAAA0002"/></Element>\n        <Element Type="Trigger" Id="AAAA0002"><Action Type="FunctionCall" Library="810D62ED" Id="AAAA0003"/></Element>\n        <Element Type="FunctionCall" Id="AAAA0003">\n            <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000123"/>\n            <ScriptCode>    DialogControlCreate(dialog, c_triggerControlTypeProgressBar);\n    lv_voteFill = DialogControlLastCreated();\n    if (lv_voteFill &gt; 0) {\n        Send("A &amp; B");\n    }</ScriptCode>\n        </Element>\n        <Element Type="Param" Id="AAAA0004"><ScriptCode>Color(0.0, 0.0, 0.0)</ScriptCode></Element>\n    </Library>\n</TriggerData>';
  const result = normalizeCustomScriptLayout(xml);
  assert.equal(result.changedScriptBlocks, 1);
  assert.equal(result.xml.replace(/<ScriptCode>[\s\S]*?<\/ScriptCode>/g, '<ScriptCode/>'), xml.replace(/<ScriptCode>[\s\S]*?<\/ScriptCode>/g, '<ScriptCode/>'));
  const block = /<ScriptCode>([\s\S]*?)<\/ScriptCode>/.exec(result.xml)![1]!;
  const editorText = block.split('\n').slice(1, -1).map(line => line.slice(16)).join('\n');
  assert.equal(editorText, 'DialogControlCreate(dialog, c_triggerControlTypeProgressBar);\nlv_voteFill = DialogControlLastCreated();\nif (lv_voteFill &gt; 0) {\n    Send("A &amp; B");\n}');
  assert.match(result.xml, /<ScriptCode>Color\(0.0, 0.0, 0.0\)<\/ScriptCode>/);
  assert.equal(normalizeCustomScriptLayout(result.xml).changedScriptBlocks, 0);
});

test('ScriptCode layout dry run leaves disk unchanged and save checks stale files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sc2-trigger-layout-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'Triggers');
  const xml = '<TriggerData><Library Id="810D62ED"><Element Type="FunctionCall" Id="AAAA0001"><FunctionDef Type="FunctionDef" Library="Ntve" Id="00000123"/><ScriptCode>ReturnCode();</ScriptCode></Element></Library></TriggerData>';
  await fs.writeFile(file, xml);
  const workspace = new TriggerWorkspace(new Workspace(root));
  assert.equal((await workspace.normalizeScriptLayout()).changedScriptBlocks, 1);
  assert.equal(await fs.readFile(file, 'utf8'), xml);
  await workspace.normalizeScriptLayout(false);
  await fs.writeFile(file, xml + '\n');
  await assert.rejects(workspace.save(false), /STALE/);
});

test('graft formats imported custom actions without changing existing script payloads', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sc2-trigger-graft-layout-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const oldCall = '<Element Type="FunctionCall" Id="AAAA0002"><FunctionDef Type="FunctionDef" Library="Ntve" Id="00000123"/><ScriptCode>Old();</ScriptCode></Element>';
  await fs.writeFile(path.join(root, 'Triggers'), '<TriggerData><Library Id="810D62ED"><Element Type="Trigger" Id="AAAA0001"><Identifier>Vote</Identifier><Action Type="FunctionCall" Library="810D62ED" Id="AAAA0002"/></Element>' + oldCall + '</Library></TriggerData>');
  await fs.writeFile(path.join(root, 'source.xml'), '<TriggerData><Library Id="810D62ED"><Element Type="Trigger" Id="BBBB0001"><Identifier>Vote</Identifier><Action Type="FunctionCall" Library="810D62ED" Id="BBBB0002"/></Element><Element Type="FunctionCall" Id="BBBB0002"><FunctionDef Type="FunctionDef" Library="Ntve" Id="00000123"/><ScriptCode>CreateProgress();</ScriptCode></Element></Library></TriggerData>');
  const workspace = new TriggerWorkspace(new Workspace(root));
  await workspace.graft({ sourceFile: 'source.xml', sourceTrigger: 'Vote', targetTrigger: 'Vote', kind: 'Action', index: 0, dryRun: false });
  await workspace.save(false);
  const saved = await fs.readFile(path.join(root, 'Triggers'), 'utf8');
  assert.ok(saved.includes(oldCall));
  assert.match(saved, /<ScriptCode>\n {16}CreateProgress\(\);\n {12}<\/ScriptCode>/);
});

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


test('root custom include uses only the XML prefix and displays at column zero',()=>{
 const xml='<TriggerData><Root/><Element Type="CustomScript" Id="AAAA0010"><ScriptCode>     include &quot;Scripts/Example&quot;</ScriptCode></Element></TriggerData>';
 const fixed=normalizeCustomScriptLayout(xml).xml;
 const block=/<ScriptCode>([\s\S]*?)<\/ScriptCode>/.exec(fixed)![1];
 const visible=block.split('\n').slice(1,-1).map(line=>line.slice(12)).join('\n');
 assert.equal(visible,'include &quot;Scripts/Example&quot;');
 assert.equal(normalizeCustomScriptLayout(fixed).changedScriptBlocks,0);
});
