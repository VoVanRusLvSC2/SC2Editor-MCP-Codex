import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../src/core/workspace.js";
import { DataWorkspace } from "../src/modules/data/workspace.js";
import type { DataOperation } from "../src/modules/data/types.js";
import { DataSchemaRegistry } from "../src/modules/data/schemaRegistry.js";
import { SchemaRegistry } from "../src/schema/schemaRegistry.js";

const projectRoot = process.cwd();
const requestFile = path.join(projectRoot, "examples/data/ReaperBurnAndDamageTextureApply.json");
const outputFile = path.join(projectRoot, "examples/data/ReaperBurnAndDamageTextureData.xml");
const reportFile = path.join(projectRoot, "examples/data/ReaperBurnAndDamageTextureValidation.json");
const request = JSON.parse(await fs.readFile(requestFile, "utf8")) as {
  file: string;
  operations: DataOperation[];
  dryRun: boolean;
  stage: boolean;
  backup: boolean;
  validate: boolean;
};
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-data-recipes-"));

try {
  await fs.writeFile(path.join(temporaryRoot, "ComponentList.SC2Components"), `<?xml version="1.0" encoding="utf-8"?>\r\n<Components>\r\n</Components>`);
  const workspace = new Workspace(temporaryRoot, await SchemaRegistry.loadBundled());
  const data = new DataWorkspace(workspace, await DataSchemaRegistry.load());
  const result = await data.apply({ ...request, backup: false });
  const generated = await fs.readFile(path.join(temporaryRoot, request.file), "utf8");
  await fs.writeFile(outputFile, generated);
  await fs.writeFile(reportFile, `${JSON.stringify({
    accepted: result.accepted,
    aliases: result.aliases,
    efficiency: result.efficiency,
    validation: result.validation,
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputFile, reportFile, objects: result.efficiency.nativeMutations, validation: result.validation?.levels }, null, 2)}\n`);
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
