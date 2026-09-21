import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Workspace } from "../src/core/workspace.js";
import { TerrainWorkspace } from "../src/modules/terrain/workspace.js";
import { parseTerrainRecipe } from "../src/modules/terrain/xmlRecipe.js";

// Always operate on a disposable native component fixture, never the supplied map archive.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-terrain-demo-"));
try {
  for (const name of await fs.readdir(
    "src/tests/fixtures/terrain-native/nydus",
  ))
    await fs.writeFile(
      path.join(root, name.slice(0, -3)),
      gunzipSync(
        await fs.readFile(
          path.join("src/tests/fixtures/terrain-native/nydus", name),
        ),
      ),
    );
  const terrain = new TerrainWorkspace(new Workspace(root));
  const recipe = parseTerrainRecipe(
    await fs.readFile("examples/terrain/forest-road.xml", "utf8"),
  );
  const inspection = await terrain.inspect();
  const plan = await terrain.plan(recipe);
  const preview = await terrain.preview(plan.id, "", "height", 256);
  const dryRun = await terrain.apply(plan.id);
  const staged = await terrain.apply(plan.id, { dryRun: false, stage: true });
  const transactionId = staged.transaction!.transactionId!;
  const saved = await terrain.save(transactionId, { dryRun: false });
  const restored = await terrain.rollback(transactionId, false);
  await fs.mkdir("examples/terrain", { recursive: true });
  await fs.writeFile(
    "examples/terrain/forest-road-height.png",
    Buffer.from(preview.imageBase64, "base64"),
  );
  await fs.writeFile(
    "generated/terrain-demo-report.json",
    JSON.stringify(
      {
        version: "1.1.0-alpha.11",
        evidence:
          "native component fixture copy; not a playable map or Editor/runtime round-trip",
        inspection,
        plan,
        dryRun,
        staged,
        saved,
        restored,
        sourceRestored: (await terrain.inspect()).components.every(
          (c, i) => c.sha256 === inspection.components[i].sha256,
        ),
        editor: "NOT_EXECUTED",
        runtime: "NOT_EXECUTED",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      report: "generated/terrain-demo-report.json",
      preview: "examples/terrain/forest-road-height.png",
    }),
  );
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
