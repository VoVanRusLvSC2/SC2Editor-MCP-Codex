/* global process */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireLiveRuntimeBuild } from "./live-runtime-lease.mjs";
import { cachedLiveRuntime, liveBinaryNames, liveDigest } from "./live-runtime-cache.mjs";
if (process.platform !== "win32") throw Error("LIVE_WINDOWS_REQUIRED");
const release = acquireLiveRuntimeBuild();
try {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sources = [
    "memory.cpp",
    "document.inc",
    "placement.inc",
    "palette.inc",
    "terrain_brush.inc",
    "xml_buffer.inc",
    "transfer_paths.inc",
    "ui_xml.inc",
    "file_dialog.inc",
    "import_dialog.inc",
    "module_inspection.inc",
    "trigger_graph.inc",
    "data_xml.inc",
    "catalog.inc",
    "memory_protocol.h",
    "memory_loader.cpp",
    "desktop_context.h",
    "CMakeLists.txt",
  ];
  const hash = createHash("sha256");
  const sourceBytes = new Map(
    sources.map((f) => [f, readFileSync(path.join(root, "native/live-editor", f))]),
  );
  for (const [f, bytes] of sourceBytes) hash.update(f + "\0").update(bytes);
  const sourceSha256 = hash.digest("hex"),
    base = path.join(root, "native/bin/windows-x64");
  const cached = process.argv.includes("--force")
    ? undefined
    : cachedLiveRuntime(base, sourceSha256);
  if (cached) {
    process.stdout.write(JSON.stringify({ built: cached.home, reused: true, sourceSha256 }) + "\n");
  } else {
    // Source equality does not make an existing DLL writable on Windows. A fresh
    // version also prevents concurrently edited sources changing a tagged binary.
    const tag = sourceSha256.slice(0, 16) + "-" + randomBytes(4).toString("hex"),
      relative = "live-memory/" + tag,
      home = path.join(base, relative),
      build = path.join(root, "work/live-memory-build", tag),
      snapshot = path.join(build, "source");
    let cmake = process.env.SC2_LIVE_CMAKE;
    if (!cmake) {
      const probe = path.join(
        process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
        "Microsoft Visual Studio/Installer/vswhere.exe",
      );
      cmake = execFileSync(probe, ["-products", "*", "-find", "**/cmake.exe"], {
        encoding: "utf8",
        windowsHide: true,
      })
        .trim()
        .split(/\r?\n/)
        .at(-1);
    }
    if (!cmake) throw Error("LIVE_MEMORY_CMAKE_REQUIRED");
    mkdirSync(home, { recursive: true });
    mkdirSync(snapshot, { recursive: true });
    for (const [f, bytes] of sourceBytes)
      writeFileSync(path.join(snapshot, f), bytes, { flag: "wx" });
    execFileSync(
      cmake,
      [
        "-S",
        snapshot,
        "-B",
        build,
        "-G",
        "Visual Studio 17 2022",
        "-A",
        "x64",
        "-DSC2_LIVE_BUILD_TAG=" + tag,
        "-DCMAKE_RUNTIME_OUTPUT_DIRECTORY_RELEASE=" + home,
      ],
      { stdio: "inherit", windowsHide: true },
    );
    execFileSync(cmake, ["--build", build, "--config", "Release"], {
      stdio: "inherit",
      windowsHide: true,
    });
    const digest = (file) =>
      createHash("sha256")
        .update(readFileSync(path.join(home, file)))
        .digest("hex");
    const record = {
      protocol: 1,
      sourceSha256,
      sourceFiles: Object.fromEntries(
        [...sourceBytes].map(([file, bytes]) => [file, liveDigest(bytes)]),
      ),
      home: relative,
      message: "SC2EditorToolkit.LiveData.v1." + tag,
      files: Object.fromEntries(liveBinaryNames.map((f) => [f, digest(f)])),
    };
    writeFileSync(path.join(home, "BUILD.json"), JSON.stringify(record, null, 2) + "\n");
    const manifest = path.join(base, "sc2-mcp-live-memory.json"),
      temporary = manifest + "." + tag + ".tmp";
    writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
    renameSync(temporary, manifest);
    process.stdout.write(
      JSON.stringify({
        built: home,
        protocol: 1,
        scope:
          "Explicit visible Editor Data control adapter; separate from hidden validation workers",
      }) + "\n",
    );
  }
} finally {
  release();
}
