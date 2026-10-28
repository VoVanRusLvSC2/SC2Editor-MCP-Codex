import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ResourceScope } from "../core/resourceScope.js";
import { ModuleContainer } from "../app/moduleContainer.js";
import { ToolExecutor } from "../app/toolExecutor.js";
import { ToolRegistry } from "../app/toolRegistry.js";
import { ToolVisibilityPolicy } from "../app/toolPolicy.js";
import { ToolTelemetry, type ToolMetric } from "../app/telemetry.js";
import { resolveModuleSelection } from "../app/moduleSelection.js";
import { runMcpBatch } from "../app/mcpBatch.js";
import { createProject } from "../app/project.js";
import { createProjectServer } from "../app/server.js";

test("disposal drains dependents first and closes every resource once despite errors", async () => {
  const scope = new ResourceScope(),
    calls: string[] = [];
  scope.own("provider", {
    close() {
      calls.push("provider");
    },
  });
  scope.own("consumer", {
    close() {
      calls.push("consumer");
      throw new Error("fixture");
    },
  });
  scope.own("workflow", {
    async close() {
      calls.push("workflow");
    },
  });
  const first = scope.close();
  assert.equal(scope.close(), first);
  await assert.rejects(
    first,
    (error) => error instanceof AggregateError && error.errors.length === 1,
  );
  assert.deepEqual(calls, ["workflow", "consumer", "provider"]);
  assert.throws(() => scope.own("late", { close() {} }), /CLOSING/);
});

test("lazy providers initialize dependencies once, retry failed construction and reject cycles", () => {
  let count = 0;
  const container: ModuleContainer<{
    dependency: object;
    service: object;
    flaky: object;
    cyclic: object;
  }> = new ModuleContainer({
    dependency: () => {
      count++;
      return {};
    },
    service: () => container.services.dependency,
    flaky: () => {
      if (count === 1) {
        count++;
        throw new Error("fixture");
      }
      return {};
    },
    cyclic: () => container.services.cyclic,
  });
  assert.deepEqual(container.initialized(), []);
  assert.equal(container.services.service, container.services.dependency);
  assert.equal(count, 1);
  assert.throws(() => container.services.flaky, /fixture/);
  assert.ok(container.services.flaky);
  assert.throws(() => container.services.cyclic, /DEPENDENCY_CYCLE/);
  container.seal();
  assert.equal(container.services.service, container.services.dependency);
});

test("batch dispatch uses the shared executor and keeps nested spans without replacing SDK registration", async () => {
  const metrics: Array<{ tool: string; args: unknown; span: unknown }> = [];
  const executor = new ToolExecutor({
    record(tool, args, _result, _duration, span) {
      metrics.push({ tool, args, span });
      return {} as ToolMetric;
    },
  });
  const registry = new ToolRegistry(
    executor,
    new ToolVisibilityPolicy(resolveModuleSelection({ SC2_MCP_PROFILE: "workflow" })),
  );
  const raw = new McpServer({ name: "fixture", version: "1" }),
    original = raw.registerTool;
  const server = registry.bind(raw);
  server.registerTool(
    "fixture.hidden",
    { inputSchema: z.object({ dryRun: z.boolean().default(true) }) },
    async (args) => ({ content: [{ type: "text", text: JSON.stringify(args) }] }),
  );
  assert.equal(raw.registerTool, original);
  assert.equal(registry.find("fixture.hidden", 0, 10).items[0].enabled, false);
  const result = await executor.invoke(
    "fixture.outer",
    async () =>
      runMcpBatch([{ id: "one", tool: "fixture.hidden", args: {} }], registry.batchTools, {}),
    {},
    {},
    "direct",
  );
  assert.equal((result as { ok: boolean }).ok, true);
  assert.deepEqual(metrics[0].args, { dryRun: true });
  assert.deepEqual(metrics[0].span, { spanId: "2", parentSpanId: "1", origin: "internal" });
  assert.deepEqual(metrics[1].span, { spanId: "1", origin: "direct" });
  registry.enable(["fixture.hidden"]);
  assert.equal(registry.find("fixture.hidden", 0, 10).items[0].enabled, true);
  assert.throws(() => registry.enable(["fixture.hidden", "missing"]), /UNKNOWN/);
  await raw.close();
});

test("usage excludes internal payloads from model-facing totals", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refactor-metrics-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const meter = new ToolTelemetry(root);
  // Over-budget fixtures avoid tokenizer dependency while testing byte accounting.
  const result = { content: [{ type: "text", text: "x".repeat(1_100_000) }] };
  meter.record("outer", {}, result, 10, { origin: "direct", spanId: "1" });
  meter.record("inner", {}, result, 5, { origin: "internal", spanId: "2", parentSpanId: "1" });
  const summary = await meter.summary();
  assert.equal(summary.calls, 1);
  assert.equal(summary.internalCalls, 1);
  assert.deepEqual(
    summary.tools.map((row) => row.tool),
    ["outer"],
  );
  assert.equal(summary.actualModelUsage, null);
});

test("focused script project avoids unrelated providers before a capability request and closes idempotently", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refactor-project-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = await createProject(root, {
    loadUiSchema: false,
    selection: resolveModuleSelection({ SC2_MCP_PROFILE: "focused-script" }),
  });
  assert.deepEqual(project.initializedModules(), []);
  const server = createProjectServer(project);
  assert.ok(project.initializedModules().includes("script"));
  for (const name of [
    "nativeEditor",
    "nativeGame",
    "testing",
    "terrain",
    "placement",
    "cutscenePreview",
  ])
    assert.equal(project.initializedModules().includes(name), false, name);
  await server.close();
  await project.close();
  await project.close();
});
