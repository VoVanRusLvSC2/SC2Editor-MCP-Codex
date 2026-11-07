/* global process */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw Error("LIVE_WINDOWS_REQUIRED");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compiler = path.join(
  process.env.WINDIR ?? "C:/Windows",
  "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
);
const output = path.join(root, "native/bin/windows-x64/sc2-mcp-live.exe");
mkdirSync(path.dirname(output), { recursive: true });
execFileSync(
  compiler,
  [
    "/nologo",
    "/target:exe",
    "/platform:x64",
    "/optimize+",
    "/reference:System.Web.Extensions.dll",
    "/out:" + output,
    path.join(root, "native/live-editor/Program.cs"),
    path.join(root, "native/live-editor/MemoryData.cs"),
  ],
  { stdio: "inherit", windowsHide: true },
);
process.stdout.write(
  JSON.stringify({
    built: output,
    scope:
      "Inventory/file-drop without DLL; explicit memory commands require the separately built visible Data adapter",
  }) + "\n",
);
