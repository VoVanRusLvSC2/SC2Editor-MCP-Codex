import test from "node:test";
import assert from "node:assert/strict";
import { resolveModuleSelection } from "../app/moduleSelection.js";

test("MCP module profiles preserve all by default and support focused tool surfaces", () => {
  const all = resolveModuleSelection({});
  assert.equal(all.profile, "all");
  assert.equal(all.modules.has("ai"), true);
  assert.equal(all.modules.has("casc"), true);
  assert.deepEqual([...resolveModuleSelection({ SC2_MCP_PROFILE: "casc" }).modules], ["ui", "casc", "data", "browse"]);
  assert.equal(all.modules.has("settings"), true);
  assert.deepEqual([...resolveModuleSelection({ SC2_MCP_PROFILE: "settings" }).modules], ["ui", "settings", "map", "text"]);
  assert.equal(resolveModuleSelection({ SC2_MCP_PROFILE: "landscape" }).modules.has("casc"), true);
  const focused = resolveModuleSelection({ SC2_MCP_PROFILE: "script" });
  assert.deepEqual([...focused.modules], ["ui", "script"]);
  const custom = resolveModuleSelection({ SC2_MCP_MODULES: "data,browse,unknown" });
  assert.deepEqual([...custom.modules], ["ui", "data", "browse"]);
  assert.deepEqual(custom.unknown, ["unknown"]);
});
