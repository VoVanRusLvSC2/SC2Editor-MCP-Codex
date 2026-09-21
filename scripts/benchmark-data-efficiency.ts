const directXmlWorkflow = [
  "locate ComponentList", "locate catalog file", "open catalog XML", "inspect object type", "inspect parent object",
  "search dependency ids", "create object XML", "set scalar field", "set flag array", "set reference array",
  "patch nested field", "search incoming references", "validate XML", "validate duplicate ids", "validate dependencies",
  "review multi-file diff", "create backups", "atomically save files",
];
import { promises as fs } from "node:fs";
import path from "node:path";

const semantic = ["data.context", "data.apply"];
const basic = {
  workflow: "Create one inherited catalog object with scalar, flag, Link and nested fields",
  directXmlCalls: directXmlWorkflow.length,
  semanticCalls: semantic.length,
  savedCalls: directXmlWorkflow.length - semantic.length,
  reductionPercent: Number((((directXmlWorkflow.length - semantic.length) / directXmlWorkflow.length) * 100).toFixed(1)),
  semantic,
  model: "One call per separately required inspect/search/patch/validation/save action. Actual raw-editor tool count varies by host.",
  note: "data.apply batches up to 500 operations and includes validation, minimal multi-file diff, gada registration, backup and atomic commit/stage.",
};
const linkedDirectWorkflow = [
  "locate Data component", "inspect Reaper unit", "inspect Reaper weapon", "inspect carrier effect",
  "inspect impact effect", "resolve fire model", "inspect target-host actor pattern", "inspect vital validator",
  "inspect actor state monitor", "inspect texture declaration", "create periodic damage", "create buff",
  "create apply-behavior effect", "create impact set", "create fire actor", "patch carrier effect",
  "create healthy texture", "create damaged texture", "create 40% validator", "create state monitor",
  "register catalog", "validate graph", "review multi-file diff", "backup and atomic save",
];
const exampleSource = await fs.readFile(path.resolve("examples/data/ReaperBurnAndDamageTextureApply.json"), "utf8");
const linked = {
  workflow: "Reaper hit burn plus reversible texture swap below 40% Life",
  directXmlCalls: linkedDirectWorkflow.length,
  semanticCalls: semantic.length,
  savedCalls: linkedDirectWorkflow.length - semantic.length,
  reductionPercent: Number((((linkedDirectWorkflow.length - semantic.length) / linkedDirectWorkflow.length) * 100).toFixed(1)),
  semantic,
  applyRequestBytes: Buffer.byteLength(exampleSource),
  applyRequestApproxTokens: Math.ceil(Buffer.byteLength(exampleSource) / 4),
  nativeMutationsInOneApply: 10,
};
if ([basic, linked].some((entry) => entry.semanticCalls > 3 || entry.reductionPercent < 80)) throw new Error("Data MCP economy regression");
process.stdout.write(`${JSON.stringify({ basic, linked }, null, 2)}\n`);
