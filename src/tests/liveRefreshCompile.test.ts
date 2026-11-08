import test from "node:test";
import assert from "node:assert/strict";
import { RefreshCompiler, type RefreshCompilerPort } from "../modules/editorLive/refreshCompile.js";

test("one compile job is polled and its result adopted once", async () => {
  let starts = 0,
    adopts = 0,
    state = "running";
  const port: RefreshCompilerPort = {
    snapshot: async () => ({ archive: "snapshot", sha256: "digest" }),
    active: () => true,
    current: async () => true,
    submit: async () => {
      starts++;
      return { id: "job" };
    },
    job: () => ({ state, result: { outcome: "passed" } }),
    adopt: async () => {
      adopts++;
      return { status: "prepared" };
    },
  };
  const compiler = new RefreshCompiler(port);
  assert.equal((await compiler.begin("session")).status, "compile_pending");
  assert.equal((await compiler.begin("session")).jobId, "job");
  assert.equal((await compiler.finish("session")).status, "compile_pending");
  state = "completed";
  assert.equal((await compiler.finish("session")).status, "prepared");
  assert.equal((await compiler.finish("session")).status, "prepared");
  assert.equal(starts, 1);
  assert.equal(adopts, 1);
});

test("unknown submission and uncertain adoption are never automatically replayed", async () => {
  let starts = 0,
    adopts = 0;
  const port: RefreshCompilerPort = {
    snapshot: async () => ({ archive: "snapshot", sha256: "digest" }),
    active: () => true,
    current: async () => true,
    submit: async () => {
      starts++;
      throw Error("lost acknowledgement");
    },
    job: () => ({ state: "completed", result: { outcome: "passed" } }),
    adopt: async () => {
      adopts++;
      throw Error("lost adoption acknowledgement");
    },
  };
  const a = new RefreshCompiler(port);
  assert.equal((await a.begin("a")).status, "unknown");
  assert.equal((await a.begin("a")).status, "unknown");
  assert.equal((await a.begin("a", true)).status, "unknown");
  assert.equal(starts, 1);
  port.submit = async () => ({ id: "job" });
  const b = new RefreshCompiler(port);
  await b.begin("b");
  assert.equal((await b.finish("b")).status, "adoption_unknown");
  assert.equal((await b.finish("b")).status, "adoption_unknown");
  assert.equal(adopts, 1);
});

test("concurrent begin does not create a second snapshot or compilation", async () => {
  let release!: () => void,
    snapshots = 0,
    starts = 0;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const compiler = new RefreshCompiler({
    active: () => true,
    current: async () => true,
    snapshot: async () => {
      snapshots++;
      await wait;
      return { archive: "snapshot", sha256: "digest" };
    },
    submit: async () => {
      starts++;
      return { id: "job" };
    },
    job: () => ({ state: "failed", error: "compiler failed" }),
    adopt: async () => {
      throw Error("must not adopt");
    },
  });
  const first = compiler.begin("s");
  assert.equal((await compiler.begin("s")).status, "compile_pending");
  release();
  await first;
  assert.equal((await compiler.finish("s")).status, "compile_failed");
  assert.equal(snapshots, 1);
  assert.equal(starts, 1);
});

test("compile failure exposes the native export error without retrying", async () => {
  let submissions = 0;
  const compiler = new RefreshCompiler({
    active: () => true,
    current: async () => true,
    snapshot: async () => ({ archive: "snapshot", sha256: "digest" }),
    submit: async () => {
      submissions++;
      return { id: "job" };
    },
    job: () => ({
      state: "completed",
      result: {
        outcome: "failed",
        galaxy: { error: "export failed" },
        checks: {
          compile: {
            diagnostics: {
              compilerErrors: [
                {
                  message: "Unknown function",
                  line: "263",
                  file: "Generated",
                  ignored: "large raw text",
                },
              ],
            },
          },
        },
        report: "job/result.json",
      },
    }),
    adopt: async () => {
      throw Error("must not adopt");
    },
  });
  await compiler.begin("s");
  const result = await compiler.finish("s");
  assert.equal(result.status, "compile_failed");
  assert.equal(result.error, "export failed");
  assert.deepEqual(result.compilerErrors, [
    { message: "Unknown function", line: "263", file: "Generated" },
  ]);
  assert.equal(result.reportFile, "job/result.json");
  assert.deepEqual((await compiler.finish("s")).compilerErrors, result.compilerErrors);
  await compiler.finish("s");
  assert.equal(submissions, 1);
  assert.equal((await compiler.begin("s")).status, "compile_failed");
  assert.equal((await compiler.begin("s", true)).status, "compile_pending");
  assert.equal(submissions, 2);
});

test("a terminal job without a known outcome cannot be retried as a confirmed failure", async () => {
  let submissions = 0;
  const compiler = new RefreshCompiler({
    active: () => true,
    current: async () => true,
    snapshot: async () => ({ archive: "snapshot", sha256: "digest" }),
    submit: async () => ({ id: `job-${++submissions}` }),
    job: () => ({ state: "completed" }),
    adopt: async () => {
      throw Error("must not adopt");
    },
  });
  await compiler.begin("s");
  assert.equal((await compiler.finish("s")).status, "unknown");
  assert.equal((await compiler.begin("s", true)).status, "unknown");
  assert.equal(submissions, 1);
});

test("bounded wait observes completion and concurrent observers never adopt twice", async () => {
  let state = "running",
    adoptions = 0;
  const compiler = new RefreshCompiler({
    active: () => true,
    current: async () => true,
    snapshot: async () => ({ archive: "snapshot", sha256: "digest" }),
    submit: async () => ({ id: "job" }),
    job: () => ({ state, result: { outcome: "passed" } }),
    adopt: async () => {
      adoptions++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {};
    },
  });
  await compiler.begin("s");
  setTimeout(() => {
    state = "completed";
  }, 5);
  const both = await Promise.all([compiler.finish("s", 40), compiler.finish("s", 40)]);
  assert.ok(both.some((result) => result.status === "prepared"));
  assert.equal(adoptions, 1);
  assert.equal((await compiler.finish("s")).status, "prepared");
  await assert.rejects(compiler.finish("s", 30001), /WAIT_INVALID/);
});

test("changed prepared components require a new compile without parallel duplicate submissions", async () => {
  let current = true,
    submissions = 0,
    release!: () => void;
  let gate: Promise<void> = Promise.resolve();
  const compiler = new RefreshCompiler({
    active: () => true,
    current: async () => {
      await gate;
      return current;
    },
    snapshot: async () => ({ archive: "snapshot", sha256: "digest" }),
    submit: async () => ({ id: `job-${++submissions}` }),
    job: () => ({ state: "completed", result: { outcome: "passed" } }),
    adopt: async () => ({}),
  });
  await compiler.begin("s");
  await compiler.finish("s");
  assert.equal((await compiler.begin("s")).status, "prepared");
  current = false;
  assert.equal((await compiler.finish("s")).status, "compile_stale");
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = compiler.begin("s");
  assert.equal((await compiler.begin("s")).status, "compile_pending");
  release();
  assert.equal((await first).jobId, "job-2");
  assert.equal(submissions, 2);
  current = true;
  assert.equal((await compiler.finish("s")).status, "prepared");
});

test("concurrent observers stop while adoption is still in progress", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const compiler = new RefreshCompiler({
    active: () => true,
    current: async () => true,
    snapshot: async () => ({ archive: "snapshot", sha256: "digest" }),
    submit: async () => ({ id: "job" }),
    job: () => ({ state: "completed", result: { outcome: "passed" } }),
    adopt: async () => {
      await gate;
      return {};
    },
  });
  await compiler.begin("s");
  const first = compiler.finish("s");
  assert.equal((await compiler.finish("s")).status, "compile_pending");
  assert.equal((await compiler.begin("s")).status, "compile_pending");
  release();
  assert.equal((await first).status, "prepared");
});

test("capacity cleanup drops only terminal runs from released sessions", async () => {
  const active = new Set<string>();
  let submissions = 0;
  const compiler = new RefreshCompiler({
    active: (id) => active.has(id),
    current: async () => true,
    snapshot: async () => ({ archive: "snapshot", sha256: "digest" }),
    submit: async () => {
      submissions++;
      if (submissions === 1) throw Error("unknown admission");
      return { id: `job-${submissions}` };
    },
    job: () => ({ state: "completed", result: { outcome: "passed" } }),
    adopt: async () => ({}),
  });
  assert.equal((await compiler.begin("uncertain")).status, "unknown");
  for (let i = 0; i < 127; i++) {
    const id = `session-${i}`;
    active.add(id);
    await compiler.begin(id);
    await compiler.finish(id);
  }
  await assert.rejects(compiler.begin("new"), /RUN_LIMIT/);
  active.delete("session-0");
  assert.equal((await compiler.begin("new")).status, "compile_pending");
  assert.equal((await compiler.begin("uncertain", true)).status, "unknown");
  assert.equal(submissions, 129);
});
