import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject } from "../app/project.js";
import { createProjectServer } from "../app/server.js";
import { resolveModuleSelection } from "../app/moduleSelection.js";
import { projectToolRegistry } from "../app/toolServer.js";
import { compileAuthorScript } from "../app/authoringScript.js";
import { runMcpBatch } from "../app/mcpBatch.js";
import { layoutXmlSignature } from "../modules/editorLive/layoutXml.js";
import { scanXml } from "../core/xmlScanner.js";

async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-ui-live-author-"));
  const file = "Live.SC2Layout";
  await fs.writeFile(path.join(root, file), "<Desc/>");
  const project = await createProject(root, {
      selection: resolveModuleSelection({ SC2_MCP_PROFILE: "ui" }),
    }),
    server = createProjectServer(project);
  t.after(async () => {
    await server.close();
    await project.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, file, tools: projectToolRegistry(server).batchTools };
}
test("fifty concise UI operations use one original atomic UI batch and one component save", async (t) => {
  const f = await fixture(t),
    script = Array.from(
      { length: 50 },
      (_, i) => `ui frame type=Frame name=Panel${i} width=${200 + i} height=80`,
    ).join("\n");
  const steps = compileAuthorScript(script, "save", f.tools, undefined, { uiFile: f.file });
  assert.deepEqual(
    steps.map((s) => s.tool),
    ["ui.apply", "modkit.save"],
  );
  assert.equal((steps[0].args.operations as unknown[]).length, 50);
  const result = await runMcpBatch(steps, f.tools, {});
  assert.equal(result.ok, true, JSON.stringify(result));
  const xml = await fs.readFile(path.join(f.root, f.file), "utf8");
  assert.equal(scanXml(xml).nodes.filter((n) => n.tag === "Frame").length, 50);
});
test("UI aliases stay within their original command scope and live file defaults cannot redirect", async (t) => {
  const f = await fixture(t);
  const steps = compileAuthorScript(
    "ui frame type=Frame name=A as=part\nui frame type=Frame name=B as=part",
    "save",
    f.tools,
    undefined,
    { uiFile: f.file },
  );
  assert.deepEqual(
    steps.map((s) => s.tool),
    ["ui.apply", "modkit.save", "ui.apply", "modkit.save"],
  );
  assert.throws(
    () =>
      compileAuthorScript(
        "ui frame file=Other.SC2Layout type=Frame name=A",
        "save",
        f.tools,
        undefined,
        { uiFile: f.file },
      ),
    /LIVE_UI_SINGLE_LAYOUT_REQUIRED/,
  );
});
test("advanced typed UI operations retain the same guarded component lifecycle", async (t) => {
  const f = await fixture(t);
  const script = `ui.apply operations='[{"op":"create_frame","type":"Frame","name":"Advanced"},{"op":"set_property","framePath":"Advanced","property":"Width","value":80}]'`;
  const steps = compileAuthorScript(script, "save", f.tools, undefined, { uiFile: f.file });
  assert.deepEqual(
    steps.map((s) => s.tool),
    ["ui.apply", "modkit.save"],
  );
  assert.equal((await runMcpBatch(steps, f.tools, {})).ok, true);
  assert.ok((await fs.readFile(path.join(f.root, f.file), "utf8")).includes('val="80"'));
});
test("a failing UI operation leaves the whole combined group unstaged and unsaved", async (t) => {
  const f = await fixture(t),
    steps = compileAuthorScript(
      "ui frame type=Frame name=Panel\nui property framePath=Missing property=Width value=10",
      "save",
      f.tools,
      undefined,
      { uiFile: f.file },
    );
  assert.equal(steps.length, 2);
  const result = await runMcpBatch(steps, f.tools, {});
  assert.equal(result.ok, false);
  assert.equal(await fs.readFile(path.join(f.root, f.file), "utf8"), "<Desc/>");
});
test("layout readback ignores formatting but retains frame order, property values and literal whitespace", () => {
  const xml =
    '<Desc><Frame type="Frame" name="A"><Width val="50"/><Text val=" key "/></Frame><Frame type="Frame" name="B"/></Desc>';
  assert.equal(layoutXmlSignature(xml), layoutXmlSignature(xml.replaceAll("/><", "/>\r\n <")));
  for (const changed of [
    xml.replace('val="50"', 'val="51"'),
    xml.replace('val=" key "', 'val="key"'),
    xml.replace('name="A"', 'name="C"'),
  ])
    assert.notEqual(layoutXmlSignature(xml), layoutXmlSignature(changed));
});
