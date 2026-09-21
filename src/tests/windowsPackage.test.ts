import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

test("builds a structurally valid native x64 Windows GUI launcher", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-ui-pe-"));
  const output = path.join(root, "SC2-UI-Workbench.exe");
  try {
    await execFileAsync(process.execPath, [path.resolve("scripts/build-pe-launcher.mjs"), output]);
    const pe = await fs.readFile(output);
    assert.equal(pe.subarray(0, 2).toString("ascii"), "MZ");
    const peOffset = pe.readUInt32LE(0x3c);
    assert.equal(pe.subarray(peOffset, peOffset + 4).toString("binary"), "PE\0\0");
    assert.equal(pe.readUInt16LE(peOffset + 4), 0x8664);
    const optional = peOffset + 24;
    assert.equal(pe.readUInt16LE(optional), 0x20b);
    assert.equal(pe.readUInt16LE(optional + 68), 2);
    const ascii = pe.toString("ascii");
    assert.match(ascii, /KERNEL32\.dll/);
    assert.match(ascii, /GetModuleFileNameW/);
    assert.match(ascii, /SC2-UI-Workbench\.ps1/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Windows launcher selects a component directory and enforces Node 20+", async () => {
  const source = await fs.readFile(path.resolve("windows/SC2-UI-Workbench.ps1"), "utf8");
  assert.match(source, /FolderBrowserDialog/);
  assert.match(source, /Node\.js 20\+/);
  assert.match(source, /SC2_UI_ROOT/);
  assert.match(source, /Save changes in the browser/);
});

test("portable build script bundles generated Cutscene, Text, and Data registries", async () => {
  const source = await fs.readFile(path.resolve("scripts/build-windows-portable.mjs"), "utf8");
  assert.match(source, /"generated"/);
  assert.equal((await fs.stat(path.resolve("generated/cutscene-schema.json"))).isFile(), true);
  assert.equal((await fs.stat(path.resolve("generated/cutscene-property-matrix.json"))).isFile(), true);
  assert.equal((await fs.stat(path.resolve("generated/editor-build.json"))).isFile(), true);
  assert.equal((await fs.stat(path.resolve("generated/camera-property-matrix.json"))).isFile(), true);
  assert.equal((await fs.stat(path.resolve("generated/text-font-style-schema.json"))).isFile(), true);
  assert.equal((await fs.stat(path.resolve("generated/font-style-corpus.json"))).isFile(), true);
  assert.equal((await fs.stat(path.resolve("generated/rich-text-schema.json"))).isFile(), true);
  assert.equal((await fs.stat(path.resolve("generated/data-editor-schema.json"))).isFile(), true);
  assert.equal((await fs.stat(path.resolve("generated/data-observed-schema.json"))).isFile(), true);
});
