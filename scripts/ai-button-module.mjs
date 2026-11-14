import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildPeLauncher } from "./build-pe-launcher.mjs";

// Only the upstream runtime, notices and setup scripts belong in this module.
// Never copy an upstream checkout, account state, node_modules or test artifacts.
export const aiButtonFiles = [
  "SC2AIButton.dll",
  "SC2AILoader.exe",
  "LICENSE",
  "README.md",
  "README.ru.md",
  "Setup Claude.cmd",
  "Login Claude.cmd",
  "bridge/main.mjs",
  "bridge/chat_titles.mjs",
  "bridge/file_changes.mjs",
  "bridge/workspace_snapshot.mjs",
  "bridge/locales.json",
  "bridge/mcp_spawn.mjs",
  "bridge/mcp_refresh.mjs",
  "bridge/package.json",
  "bridge/package-lock.json",
];

export const aiButtonDigest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Verify the entire declared runtime before copying it or invoking its loader. */
export async function inspectAiButtonModule(directory) {
  const root = path.resolve(directory);
  if ((await fs.lstat(root)).isSymbolicLink()) throw Error("AI_BUTTON_MODULE_SYMLINK");
  const realRoot = await fs.realpath(root);
  const manifestFile = path.join(root, "module.json");
  const stat = await fs.lstat(manifestFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
    throw Error("AI_BUTTON_MANIFEST_INVALID");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.id !== "editor-ai-button" ||
    manifest.loader !== "SC2AILoader.exe" ||
    manifest.editorExecutable !== "SC2Editor_x64.exe" ||
    manifest.editorVersion !== "5.0.17.98310" ||
    !/^[a-f0-9]{40}$/.test(manifest.revision ?? "") ||
    !manifest.files ||
    Array.isArray(manifest.files) ||
    Object.keys(manifest.files).sort().join("\n") !== [...aiButtonFiles].sort().join("\n")
  )
    throw Error("AI_BUTTON_MANIFEST_INVALID");
  let bytes = 0;
  for (const file of aiButtonFiles) {
    const target = path.join(root, file);
    const info = await fs.lstat(target);
    const relative = path.relative(realRoot, await fs.realpath(target));
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    )
      throw Error("AI_BUTTON_MODULE_FILE_UNSAFE: " + file);
    bytes += info.size;
    if (bytes > 32 * 1024 * 1024) throw Error("AI_BUTTON_MODULE_SIZE_LIMIT");
    if (aiButtonDigest(await fs.readFile(target)) !== manifest.files[file])
      throw Error("AI_BUTTON_MODULE_HASH_MISMATCH: " + file);
  }
  return manifest;
}

export async function copyAiButtonModule(source, destination) {
  const manifest = await inspectAiButtonModule(source);
  await fs.mkdir(destination, { recursive: true });
  for (const file of [...aiButtonFiles, "module.json"]) {
    const target = path.join(destination, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // A fresh output directory avoids overwriting a DLL in an active Editor.
    await fs.copyFile(path.join(source, file), target, fs.constants.COPYFILE_EXCL);
  }
  await inspectAiButtonModule(destination);
  return { id: manifest.id, version: manifest.version, revision: manifest.revision };
}

/** Shared by the full portable builder and the small standalone module package. */
export async function installAiButtonHost(projectRoot, output, { optional = false } = {}) {
  const pin = JSON.parse(
    await fs.readFile(path.join(projectRoot, "ai-button-release.json"), "utf8"),
  );
  const source = path.join(projectRoot, "native/bin/windows-x64/ai-button", pin.revision);
  try {
    await fs.lstat(source);
  } catch (error) {
    if (optional && error.code === "ENOENT") return null;
    throw error;
  }
  // Only an absent optional module may be skipped. An installed but corrupt
  // module must fail the build rather than silently omitting the AI launcher.
  const manifest = await inspectAiButtonModule(source);
  if (manifest.revision !== pin.revision) throw Error("AI_BUTTON_MODULE_REVISION_MISMATCH");
  const module = await copyAiButtonModule(source, path.join(output, "modules/ai-button"));
  await fs.copyFile(
    path.join(projectRoot, "windows/SC2EditorToolkit.ps1"),
    path.join(output, "SC2EditorToolkit.ps1"),
  );
  await buildPeLauncher(path.join(output, "SC2EditorToolkit.exe"), "SC2EditorToolkit.ps1");
  return module;
}
