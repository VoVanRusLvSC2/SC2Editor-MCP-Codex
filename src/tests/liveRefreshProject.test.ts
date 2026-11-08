import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { acquireRefreshProject } from "../modules/editorLive/refreshProject.js";

test("concurrent resumptions reclaim a dead owner once and preserve the new live owner", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refresh-owner-")),
    file = path.join(directory, "Prepared.lock"),
    exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore", windowsHide: true });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await new Promise<void>((resolve, reject) => {
    exited.once("error", reject);
    exited.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Owned fixture child failed")),
    );
  });
  assert.throws(() => process.kill(exited.pid!, 0), { code: "ESRCH" });
  await fs.writeFile(file, JSON.stringify({ pid: exited.pid, owner: randomUUID() }));
  const attempts = await Promise.allSettled([
      acquireRefreshProject(directory),
      acquireRefreshProject(directory),
    ]),
    won = attempts.filter(
      (r): r is PromiseFulfilledResult<() => Promise<void>> => r.status === "fulfilled",
    ),
    lost = attempts.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.match(String(lost[0].reason), /PROJECT_OWNED/);
  const liveOwner = await fs.readFile(file, "utf8");
  assert.equal(JSON.parse(liveOwner).pid, process.pid);
  await assert.rejects(acquireRefreshProject(directory), /PROJECT_OWNED/);
  assert.equal(await fs.readFile(file, "utf8"), liveOwner);
  await won[0].value();
  const release = await acquireRefreshProject(directory);
  await release();
  await assert.rejects(fs.stat(file), { code: "ENOENT" });
});
