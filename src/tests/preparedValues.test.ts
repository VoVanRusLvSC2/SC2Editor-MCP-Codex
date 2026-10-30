import test from "node:test";
import assert from "node:assert/strict";
import { PreparedValueCache } from "../core/preparedValues.js";

test("prepared metadata retains bounds and isolates caller mutations on insertion and read", () => {
  const cache = new PreparedValueCache<{ names: string[] }>(2, 10),
    value = { names: ["first"] };
  cache.set("a", value, 4);
  value.names.push("poison");
  const read = cache.get("a")!;
  read.names.length = 0;
  assert.deepEqual(cache.get("a"), { names: ["first"] });
  cache.set("b", { names: ["second"] }, 4);
  cache.get("a");
  cache.set("c", { names: ["third"] }, 4);
  assert.equal(cache.get("b"), undefined);
  assert.deepEqual(cache.stats(), { entries: 2, weight: 8, maxEntries: 2, maxWeight: 10 });
  cache.set("a", { names: ["oversized"] }, 11);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.stats().weight, 4);
  assert.throws(() => cache.set("x", value, NaN), /WEIGHT_INVALID/);
});
