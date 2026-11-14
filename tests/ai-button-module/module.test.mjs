import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  aiButtonFiles,
  aiButtonDigest,
  inspectAiButtonModule,
  copyAiButtonModule,
  installAiButtonHost,
} from "../../scripts/ai-button-module.mjs";
import { buildPeLauncher } from "../../scripts/build-pe-launcher.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pin = JSON.parse(await fs.readFile(path.join(root, "ai-button-release.json"), "utf8"));
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-ai-button-test-"));
  t.after(async () => {
    const parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(path.resolve(directory)), parent);
    assert.ok(path.basename(directory).startsWith("sc2-ai-button-test-"));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const module = path.join(directory, "module");
  const manifest = { schemaVersion: 1, ...pin, loader: "SC2AILoader.exe", files: {} };
  for (const file of aiButtonFiles) {
    const target = path.join(module, file),
      bytes = Buffer.from("fixture:" + file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    manifest.files[file] = aiButtonDigest(bytes);
  }
  await fs.writeFile(path.join(module, "module.json"), JSON.stringify(manifest));
  return { directory, module, manifest };
}

test("module copy preserves pinned runtime but excludes source, secrets and debug artifacts", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.module, "account.json"), "private fixture");
  await fs.writeFile(path.join(f.module, "source.cpp"), "private fixture");
  const target = path.join(f.directory, "copy");
  assert.equal((await copyAiButtonModule(f.module, target)).revision, pin.revision);
  assert.deepEqual(await inspectAiButtonModule(target), f.manifest);
  await assert.rejects(fs.access(path.join(target, "account.json")));
  await assert.rejects(fs.access(path.join(target, "source.cpp")));
  await assert.rejects(copyAiButtonModule(f.module, target), { code: "EEXIST" });
});

test("a corrupt bridge refuses module validation and copying", async (t) => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.module, "bridge/main.mjs"), "changed");
  await assert.rejects(inspectAiButtonModule(f.module), /HASH_MISMATCH/);
  const target = path.join(f.directory, "copy");
  await assert.rejects(copyAiButtonModule(f.module, target), /HASH_MISMATCH/);
  await assert.rejects(fs.access(target));
});

test("portable host installs the pinned module and skips only a genuinely absent optional module", async (t) => {
  const f = await fixture(t),
    project = path.join(f.directory, "project");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "ai-button-release.json"), JSON.stringify(pin));
  const output = path.join(f.directory, "host");
  assert.equal(await installAiButtonHost(project, output, { optional: true }), null);
  const moduleRoot = path.join(project, "native/bin/windows-x64/ai-button", pin.revision);
  await copyAiButtonModule(f.module, moduleRoot);
  await fs.mkdir(path.join(project, "windows"));
  await fs.copyFile(
    path.join(root, "windows/SC2EditorToolkit.ps1"),
    path.join(project, "windows/SC2EditorToolkit.ps1"),
  );
  assert.equal((await installAiButtonHost(project, output)).revision, pin.revision);
  assert.ok(
    (await fs.readFile(path.join(output, "SC2EditorToolkit.exe"))).includes(
      Buffer.from("SC2EditorToolkit.ps1"),
    ),
  );
  await fs.unlink(path.join(moduleRoot, "bridge/main.mjs"));
  await assert.rejects(
    installAiButtonHost(project, path.join(f.directory, "bad"), { optional: true }),
  );
});

test("portable host rejects a module with a different revision even if its file hashes are valid", async (t) => {
  const f = await fixture(t),
    project = path.join(f.directory, "project");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "ai-button-release.json"), JSON.stringify(pin));
  const moduleRoot = path.join(project, "native/bin/windows-x64/ai-button", pin.revision);
  await copyAiButtonModule(f.module, moduleRoot);
  f.manifest.revision = "0".repeat(40);
  await fs.writeFile(path.join(moduleRoot, "module.json"), JSON.stringify(f.manifest));
  await assert.rejects(
    installAiButtonHost(project, path.join(f.directory, "host")),
    /REVISION_MISMATCH/,
  );
});

test("manifest cannot substitute another loader or introduce traversal entries", async (t) => {
  const f = await fixture(t);
  f.manifest.loader = "other.exe";
  await fs.writeFile(path.join(f.module, "module.json"), JSON.stringify(f.manifest));
  await assert.rejects(inspectAiButtonModule(f.module), /MANIFEST_INVALID/);
  f.manifest.loader = "SC2AILoader.exe";
  f.manifest.files["../escape.exe"] = "0".repeat(64);
  await fs.writeFile(path.join(f.module, "module.json"), JSON.stringify(f.manifest));
  await assert.rejects(inspectAiButtonModule(f.module), /MANIFEST_INVALID/);
});

test("module refuses a bridge directory junction that escapes its root", async (t) => {
  const f = await fixture(t);
  const original = path.join(f.module, "bridge"),
    outside = path.join(f.directory, "outside");
  await fs.rename(original, outside);
  await fs.symlink(outside, original, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(inspectAiButtonModule(f.module), /FILE_UNSAFE/);
});

test("PE launcher keeps the existing Workbench entry and adds a separate AI module entry", async (t) => {
  const f = await fixture(t),
    original = path.join(f.directory, "Workbench.exe"),
    module = path.join(f.directory, "Toolkit.exe");
  await buildPeLauncher(original);
  await buildPeLauncher(module, "SC2EditorToolkit.ps1");
  for (const [file, script] of [
    [original, "SC2-UI-Workbench.ps1"],
    [module, "SC2EditorToolkit.ps1"],
  ]) {
    const bytes = await fs.readFile(file);
    assert.equal(bytes.toString("ascii", 0, 2), "MZ");
    assert.equal(bytes.readUInt16LE(0x84), 0x8664);
    assert.ok(bytes.includes(Buffer.from('-File "' + script + '"\0')));
  }
  await assert.rejects(buildPeLauncher(module, '../bad.ps1" -Command bad'), /SCRIPT_NAME_INVALID/);
});

test(
  "Windows host validates the module without loading a DLL and refuses changed files",
  { skip: process.platform !== "win32" },
  async (t) => {
    const f = await fixture(t);
    const installed = path.join(f.directory, "modules/ai-button");
    await copyAiButtonModule(f.module, installed);
    const script = path.join(f.directory, "SC2EditorToolkit.ps1");
    await fs.copyFile(path.join(root, "windows/SC2EditorToolkit.ps1"), script);
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ValidateOnly"];
    const result = JSON.parse(
      execFileSync("powershell.exe", args, { encoding: "utf8", windowsHide: true }),
    );
    assert.equal(result.valid, true);
    assert.equal(result.editorAttached, false);
    await fs.appendFile(path.join(installed, "SC2AIButton.dll"), "changed");
    assert.throws(() =>
      execFileSync("powershell.exe", args, { encoding: "utf8", windowsHide: true, stdio: "pipe" }),
    );
  },
);
