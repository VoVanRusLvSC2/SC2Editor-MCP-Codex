import { promises as fs } from "node:fs";
import path from "node:path";
import { CutsceneDocument } from "../src/modules/cutscene/document.js";
import { semanticCutsceneDiff } from "../src/modules/cutscene/diff.js";

const [beforeFile, afterFile] = process.argv.slice(2);
if (!beforeFile || !afterFile) throw new Error("Usage: npm run cutscene:diff-experiment -- before.SC2Cutscene after.SC2Cutscene");
const before = new CutsceneDocument(await fs.readFile(path.resolve(beforeFile), "utf8"), beforeFile);
const after = new CutsceneDocument(await fs.readFile(path.resolve(afterFile), "utf8"), afterFile);
const diff = semanticCutsceneDiff(before, after);
console.log(JSON.stringify({
  before: { file: path.resolve(beforeFile), sha256: before.sha256, diagnostics: before.diagnostics },
  after: { file: path.resolve(afterFile), sha256: after.sha256, diagnostics: after.diagnostics },
  ...diff,
  instruction: "Accept a native mapping only when the Editor changed exactly the intended property and the semantic diff isolates that field.",
}, null, 2));

