import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

test("script profile omits unrelated MCP tool schemas while retaining the public capability entry", { timeout: 15_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-focused-mcp-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["dist/index.js"], { env: { ...process.env, SC2_UI_ROOT: root, SC2_MCP_PROFILE: "script" }, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let buffer = "", stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  child.stdout.on("data", (data) => {
    buffer += data;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      const response = JSON.parse(line), item = pending.get(response.id);
      if (item) { pending.delete(response.id); response.error ? item.reject(new Error(JSON.stringify(response.error))) : item.resolve(response.result); }
    }
  });
  child.on("exit", () => { for (const item of pending.values()) item.reject(new Error(`MCP exited: ${stderr}`)); });
  let id = 0;
  const call = (method: string, params: unknown): Promise<any> => new Promise((resolve, reject) => {
    const next = ++id; pending.set(next, { resolve, reject }); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: next, method, params })}\n`);
  });
  await call("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "focused-profile-test", version: "1" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const listed = await call("tools/list", {}), names = listed.tools.map((tool: { name: string }) => tool.name);
  assert.ok(names.includes("modkit.capabilities"));
  assert.ok(names.includes("script.inspect"));
  assert.ok(names.includes("ui.read_layout"));
  assert.equal(names.some((name: string) => /^(?:data|ai|terrain|placement|browse|cutscene|map)\./.test(name)), false);
  t.diagnostic(`script profile tool count: ${names.length}`);
  assert.ok(names.length < 80, `focused profile still exposes ${names.length} tools`);
  const capabilities = await call("tools/call", { name: "modkit.capabilities", arguments: {} });
  assert.deepEqual(JSON.parse(capabilities.content[0].text).selection.modules, ["ui", "script"]);
});
