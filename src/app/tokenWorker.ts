import { parentPort } from "node:worker_threads";
import { countTextTokens } from "./textTokens.js";
parentPort?.on("message", (m: { id: number; input: string; output: string }) => {
  try {
    parentPort!.postMessage({
      id: m.id,
      input: m.input.length > 262144 ? null : countTextTokens(m.input),
      output: m.output.length > 262144 ? null : countTextTokens(m.output),
    });
  } catch {
    parentPort!.postMessage({ id: m.id, input: null, output: null });
  }
});
