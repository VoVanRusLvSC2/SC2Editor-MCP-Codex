import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { BrowseWorkspace } from "../modules/browse/workspace.js";

test("first retained browse snapshot prepares lazy native roots before files and dependency availability", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-first-browse-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const map = path.join(root, "Map"),
    dependency = path.join(root, "Liberty.SC2Mod");
  await fs.mkdir(map);
  await fs.mkdir(path.join(dependency, "Base.SC2Data/GameData"), { recursive: true });
  await fs.writeFile(
    path.join(map, "DocumentInfo"),
    "<DocInfo><Dependencies><Value>file:Mods/Liberty.SC2Mod</Value></Dependencies></DocInfo>",
  );
  await fs.writeFile(path.join(dependency, "DocumentInfo"), "<DocInfo/>");
  await fs.writeFile(
    path.join(dependency, "Base.SC2Data/GameData.xml"),
    '<Includes><Catalog path="GameData/ActorData.xml"/></Includes>',
  );
  await fs.writeFile(
    path.join(dependency, "Base.SC2Data/GameData/ActorData.xml"),
    '<Catalog><CActorDoodad id="ReadyFence"/></Catalog>',
  );
  const workspace = new Workspace(map),
    data = new DataWorkspace(workspace),
    browse = new BrowseWorkspace(workspace, data);
  let registered = false;
  data.dependencyRefresh = async () => {
    if (!registered) {
      registered = true;
      data.addDependencyRoot(dependency);
      browse.addDependencyRoot(dependency);
    }
  };
  browse.setDependencyRefresh(data.dependencyRefresh);
  const first = await browse.withSnapshot(() =>
    browse.search({ catalogType: "Actor", ids: ["ReadyFence"] }),
  );
  assert.equal(first.results.length, 1);
  assert.equal(first.results[0].availability, "AVAILABLE_THROUGH_DEPENDENCY");
  assert.equal(first.results[0].sourceLayer, "dependency");
  assert.equal(first.results[0].placeable, true);
});
