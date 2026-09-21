import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CutsceneAssetIndex, readM3Metadata } from "../modules/cutscene/assets.js";

function writeTag(buffer: Buffer, offset: number, tag: string): void {
  buffer.write([...tag].reverse().join(""), offset, 4, "ascii");
}

function syntheticM3(): Buffer {
  const indexOffset = 24;
  const indexCount = 4;
  const standOffset = indexOffset + indexCount * 16;
  const attachNameOffset = standOffset + 6;
  const sequenceOffset = attachNameOffset + 9;
  const attachmentOffset = sequenceOffset + 92;
  const buffer = Buffer.alloc(attachmentOffset + 20);
  writeTag(buffer, 0, "MD34");
  buffer.writeUInt32LE(indexOffset, 4);
  buffer.writeUInt32LE(indexCount, 8);

  const section = (index: number, tag: string, offset: number, repetitions: number, version: number): void => {
    const start = indexOffset + index * 16;
    writeTag(buffer, start, tag);
    buffer.writeUInt32LE(offset, start + 4);
    buffer.writeUInt32LE(repetitions, start + 8);
    buffer.writeUInt32LE(version, start + 12);
  };
  section(0, "CHAR", standOffset, 6, 0);
  section(1, "CHAR", attachNameOffset, 9, 0);
  section(2, "SEQS", sequenceOffset, 1, 2);
  section(3, "ATT_", attachmentOffset, 1, 1);
  buffer.write("Stand\0", standOffset, "utf8");
  buffer.write("Ref_Head\0", attachNameOffset, "utf8");
  buffer.writeInt32LE(-1, sequenceOffset);
  buffer.writeInt32LE(-1, sequenceOffset + 4);
  buffer.writeUInt32LE(6, sequenceOffset + 8);
  buffer.writeUInt32LE(0, sequenceOffset + 12);
  buffer.writeInt32LE(-1, attachmentOffset);
  buffer.writeUInt32LE(9, attachmentOffset + 4);
  buffer.writeUInt32LE(1, attachmentOffset + 8);
  return buffer;
}

test("native M3 metadata reader lists SEQS animations and ATT_ attachment points", () => {
  const metadata = readM3Metadata(syntheticM3());
  assert.equal(metadata.valid, true);
  assert.deepEqual(metadata.animations, ["Stand"]);
  assert.deepEqual(metadata.attachmentPoints, ["Ref_Head"]);
});

test("asset index searches catalog, custom files and resolves Actor to exact M3 animations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-cutscene-assets-"));
  await fs.mkdir(path.join(root, "Assets", "Models"), { recursive: true });
  await fs.mkdir(path.join(root, "Base.SC2Data", "GameData"), { recursive: true });
  await fs.writeFile(path.join(root, "Assets", "Models", "ZerusTree.m3"), syntheticM3());
  await fs.writeFile(path.join(root, "Assets", "Models", "KaldirIceCliff.m3"), syntheticM3());
  await fs.writeFile(path.join(root, "Base.SC2Data", "GameData", "ModelData.xml"), `<?xml version="1.0"?>
<Catalog>
  <CModel id="ZerusTree"><Model value="Assets/Models/ZerusTree.m3"/></CModel>
  <CModel id="KaldirIceCliff"><Model value="Assets/Models/KaldirIceCliff.m3"/></CModel>
  <CActorModel id="ZerusTreeActor"><Model value="ZerusTree"/></CActorModel>
</Catalog>`, "utf8");

  const assets = new CutsceneAssetIndex(root, []);
  const zerus = await assets.search("Zerus", ["Model", "Actor"]);
  assert.equal(zerus.some((entry) => entry.id === "ZerusTree" && entry.cutsceneUse?.property === "modelLink"), true);
  assert.equal(zerus.some((entry) => entry.id === "ZerusTreeActor" && entry.references?.some((ref) => ref.catalog === "Model" && ref.id === "ZerusTree")), true);
  const kaldir = await assets.search("Kaldir", ["Model"]);
  assert.equal(kaldir.some((entry) => entry.id === "KaldirIceCliff"), true);

  const inventory = await assets.animations({ catalog: "Actor", id: "ZerusTreeActor" });
  assert.equal(inventory.complete, true);
  assert.deepEqual(inventory.animations, ["Stand"]);
  assert.deepEqual(inventory.attachmentPoints, ["Ref_Head"]);
  const resolution = await assets.resolve("Actor", "ZerusTreeActor");
  assert.equal(resolution.edges.some((edge) => edge.to === "Model:ZerusTree"), true);
  assert.equal(resolution.placementCandidates.some((entry) => entry.cutsceneUse.value === "ZerusTree"), true);
});

test("asset refresh discovers a newly copied custom map model", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-custom-assets-"));
  const assets = new CutsceneAssetIndex(root, []);
  assert.equal((await assets.search("MyCreature", ["Model"])).length, 0);
  await fs.mkdir(path.join(root, "Assets"), { recursive: true });
  await fs.writeFile(path.join(root, "Assets", "MyCreature.m3"), syntheticM3());
  await assets.refresh();
  const result = await assets.search("MyCreature", ["Model"]);
  assert.equal(result[0].confidence, "binary-exact");
  assert.equal(result[0].cutsceneUse?.property, "modelPath");
});
