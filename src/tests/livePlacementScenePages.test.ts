import test from "node:test";
import assert from "node:assert/strict";
import { readPlacementScenePages } from "../modules/editorLive/placementScene.js";

const objects = Array.from({ length: 300 }, (_, row) => ({
  row,
  key: String(row + 1),
  type: "Tree",
  name: `Tree ${row}`,
}));
function reader(mode: "stable" | "changed" | "duplicate" | "incomplete") {
  return async (offset: number, expected: string) => {
    assert.equal(expected, offset ? "12345" : "");
    let items = objects.slice(offset, offset + 128);
    if (mode === "duplicate" && offset)
      items = [{ ...items[0], key: objects[0].key }, ...items.slice(1)];
    if (mode === "incomplete" && offset) items = [];
    return {
      layer: "Doodads",
      count: objects.length,
      selectedKey: "",
      preview: "",
      sceneHash: mode === "changed" && offset ? "54321" : "12345",
      offset,
      objects: items,
    };
  };
}
test("large scene inventory preserves all rows and guards each page", async () => {
  const scene = await readPlacementScenePages(reader("stable"));
  assert.deepEqual(scene.objects, objects);
});
test("changed, duplicated and incomplete scene pages refuse", async () => {
  for (const mode of ["changed", "duplicate", "incomplete"] as const)
    await assert.rejects(readPlacementScenePages(reader(mode)), /LIVE_PLACEMENT_SCENE_PAGE_/);
});
