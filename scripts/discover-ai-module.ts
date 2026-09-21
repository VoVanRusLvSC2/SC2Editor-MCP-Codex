import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const expectedSha256 = "9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164";
const exactTokens = ["AIData", "Active", "ConfigData", "ConfigTrigger", "CustomScript", "CustomInit", "Definition", "DiffLevel", "Duration", "GatherDefault", "CreateUnits", "NoWait", "OnceOnly", "Create", "Gather", "TargetPoint", "Transport", "Waypoint", "RepeatShow", "RepeatWaves", "SkipInEditor", "SourcePlayer", "Step", "TargetPlayer", "Time", "Arrival", "EditorDelay", "FinalWait", "GatherTime", "TurnedOff", "Trigger", "TriggerRunAtEnd", "TriggerWait", "Wave", "aidef", "aidefwave", "FlagCustomAI", "InitCustomAI"];
const executable = process.argv.find((entry, index) => index > 1 && !entry.startsWith("--")) ?? process.env.SC2_EDITOR_EXE;
if (!executable) throw new Error("Usage: npm run ai:discover -- <SC2Editor_x64.exe> [--write]");
const buffer = await fs.readFile(path.resolve(executable));
const sha256 = createHash("sha256").update(buffer).digest("hex");
if (sha256 !== expectedSha256) throw new Error(`Editor SHA-256 mismatch. expected=${expectedSha256}, actual=${sha256}`);
const tokens = exactTokens.map((token) => ({ token, offsets: offsetsOf(buffer, Buffer.from(`${token}\0`, "ascii")).map(hex) }));
const missing = tokens.filter((entry) => !entry.offsets.length).map((entry) => entry.token);
const result = {
  mode: "READ_ONLY_STATIC_DISCOVERY", executable: path.resolve(executable), bytes: buffer.length, sha256,
  editorBuild: "5.0.16.97563", tokens, missing,
  contiguousSerializationVocabulary: { start: "0x35ac4b8", end: "0x35ac674", count: 30 },
  limitations: ["Static tokens prove vocabulary, not every nesting/default/enum.", "Populated Editor-produced CustomAI fixture is still required for differential XML proof.", "No executable bytes were modified or executed."],
};
if (process.argv.includes("--write")) await fs.writeFile("generated/ai-editor-evidence.json", `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function offsetsOf(haystack: Buffer, needle: Buffer): number[] {
  const output: number[] = [];
  for (let offset = haystack.indexOf(needle); offset >= 0; offset = haystack.indexOf(needle, offset + 1)) output.push(offset);
  return output;
}
function hex(value: number): string { return `0x${value.toString(16)}`; }
