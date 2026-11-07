/* global process */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform !== "win32") throw Error("LIVE_WINDOWS_REQUIRED");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = ["memory.cpp", "document.inc", "memory_protocol.h", "memory_loader.cpp", "CMakeLists.txt"];
const hash = createHash("sha256");
for (const f of sources)
  hash.update(f + "\0").update(readFileSync(path.join(root, "native/live-editor", f)));
const tag = hash.digest("hex").slice(0, 16),
  relative = "live-memory/" + tag,
  home = path.join(root, "native/bin/windows-x64", relative),
  build = path.join(root, "work/live-memory-build", tag);
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
execFileSync(
  cmake,
  [
    "-S",
    path.join(root, "native/live-editor"),
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
  home: relative,
  message: "SC2EditorToolkit.LiveData.v1." + tag,
  files: Object.fromEntries(
    ["sc2-mcp-live-data.dll", "sc2-mcp-live-loader.exe"].map((f) => [f, digest(f)]),
  ),
};
writeFileSync(
  path.join(root, "native/bin/windows-x64/sc2-mcp-live-memory.json"),
  JSON.stringify(record, null, 2) + "\n",
);
process.stdout.write(
  JSON.stringify({
    built: home,
    protocol: 1,
    scope: "Explicit visible Editor Data control adapter; separate from hidden validation workers",
  }) + "\n",
);
