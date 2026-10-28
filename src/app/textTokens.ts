import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { projectPath } from "./paths.js";
let ranks: Map<string, number> | undefined;
const contractions = "'(?:[sStT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])";
const pieces = new RegExp(
  `[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+(?:${contractions})?|[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*(?:${contractions})?|\\p{N}{1,3}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+`,
  "gu",
);
function vocabulary() {
  if (ranks) return ranks;
  const bytes = readFileSync(projectPath("generated/o200k_base.tiktoken"));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== readFileSync(projectPath("generated/o200k_base.sha256"), "utf8").trim())
    throw new Error("TOKEN_VOCABULARY_SHA");
  ranks = new Map(
    bytes
      .toString("ascii")
      .trim()
      .split("\n")
      .map((line) => {
        const [b64, rank] = line.split(" ");
        return [Buffer.from(b64, "base64").toString("hex"), Number(rank)];
      }),
  );
  if (ranks.size !== 199998) throw new Error("TOKEN_VOCABULARY_COUNT");
  return ranks;
}
/** Exact ordinary-text o200k_base count. Never a claim about model billing/reasoning tokens. */
export function countTextTokens(text: string): number {
  const r = vocabulary();
  let count = 0;
  for (const m of text.matchAll(pieces)) {
    const b = Buffer.from(m[0]);
    if (r.has(b.toString("hex"))) {
      count++;
      continue;
    }
    const spans = Array.from({ length: b.length }, (_, i) => [i, i + 1]);
    while (spans.length > 1) {
      let best = -1,
        rank = Infinity;
      for (let i = 0; i < spans.length - 1; i++) {
        const candidate = r.get(b.subarray(spans[i][0], spans[i + 1][1]).toString("hex"));
        if (candidate !== undefined && candidate < rank) {
          rank = candidate;
          best = i;
        }
      }
      if (best < 0) break;
      spans.splice(best, 2, [spans[best][0], spans[best + 1][1]]);
    }
    count += spans.length;
  }
  return count;
}
