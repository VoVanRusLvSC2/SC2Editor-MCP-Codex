import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { installAiButtonHost } from "./ai-button-module.mjs";
import { checkDistributionPrivacy } from "./check-distribution-privacy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.argv[2] ?? path.join(root, "output/SC2EditorToolkit-AI"));
// Never overwrite a deployed folder: its DLL may be loaded in an active Editor.
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output, { recursive: false });
const module = await installAiButtonHost(root, output);
await fs.copyFile(path.join(root, "docs/AI_BUTTON_MODULE.md"), path.join(output, "README.md"));
const privacy = await checkDistributionPrivacy(output);
if (!privacy.passed) throw Error("AI_BUTTON_PACKAGE_PRIVACY_FAILED");
await fs.writeFile(
  path.join(output, "BUILD-INFO.json"),
  JSON.stringify(
    {
      module,
      privacy,
      scope:
        "AI Button module; uses existing configured MCP and installed Node; not a full MCP distribution",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ output, module, privacy }, null, 2));
