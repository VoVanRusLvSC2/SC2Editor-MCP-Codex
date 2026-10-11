import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

for (const profile of ["terrain", "script"]) {
  test(`Surface toolkit follows the ${profile} profile through the real MCP SDK`, { timeout: 20000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-terrain-transport-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.cp("src/tests/fixtures/terrain-surface", root, { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env.SC2_MCP_MODULES;
    env.SC2_UI_ROOT = root; env.SC2_MCP_PROFILE = profile;
    const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env, stderr: "pipe" });
    const client = new Client({ name: "terrain-surface-test", version: "1" });
    t.after(() => client.close());
    await client.connect(transport);
    const allTools = []; let cursor: string | undefined;
    do { const page = await client.listTools(cursor ? { cursor } : {}); allTools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
    const tools = allTools.filter(tool => tool.name.startsWith("terrain.surface."));
    assert.equal(tools.length, profile === "terrain" ? 10 : 0);
    assert.equal(allTools.some(tool => tool.name.startsWith("surface.")), false);
    if (profile === "terrain") {
      assert.ok(tools.every(tool => tool.annotations?.readOnlyHint === true));
      const result = await client.callTool({ name: "terrain.surface.overview", arguments: {} });
      assert.equal(result.isError, false);
      assert.equal(result.content[0].type, "text");
      if (result.content[0].type !== "text") throw new Error("Expected text result");
      const body = JSON.parse(result.content[0].text);
      assert.equal(body.engineValidated, false); assert.match(body.result.revision, /^[0-9a-f]{64}$/);
      const invalid = await client.callTool({ name: "terrain.surface.bytes", arguments: { component: "../escape", offset: 0 } });
      assert.equal(invalid.isError, true);
    }
  });
}
