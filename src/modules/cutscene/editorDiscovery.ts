import { promises as fs } from "node:fs";
import path from "node:path";
import type { CutsceneSchemaData, CutsceneSchemaNode } from "./types.js";
import { classifyNativeType } from "./schemaRegistry.js";

const KEYWORDS = [
  "Cutscene", "Cinematic", "SceneObject", "Timeline", "Track", "Keyframe", "Block", "Interpolation", "Tangent",
  "Camera", "Director", "Shot", "Model", "Actor", "Animation", "Attachment", "Sound", "Conversation", "Light",
  "Bookmark", "Filter", "Transform", "Position", "Rotation", "Scale", "Visibility", "Opacity", "Color", "Texture",
  "Material", "DepthOfField", "FocalDepth", "FieldOfView", "Clip", "LookAt", "Target", "Roll", "Pitch", "Yaw",
];

function looksTextual(buffer: Buffer): boolean {
  if (!buffer.length) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 64 * 1024));
  let printable = 0;
  for (const byte of sample) if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127) || byte >= 0xc0) printable++;
  return printable / sample.length > 0.82;
}

export async function scanEditorArtifacts(inputs: string[]): Promise<{
  evidence: NonNullable<CutsceneSchemaData["editorEvidence"]>;
  nodeCandidates: CutsceneSchemaNode[];
}> {
  const files: string[] = [];
  const visit = async (candidate: string): Promise<void> => {
    let stat;
    try { stat = await fs.stat(candidate); } catch { return; }
    if (stat.isDirectory()) {
      for (const entry of await fs.readdir(candidate)) await visit(path.join(candidate, entry));
    } else if (stat.size <= 256 * 1024 * 1024) files.push(path.resolve(candidate));
  };
  for (const input of inputs) await visit(path.resolve(input));

  const keywordCounts = Object.fromEntries(KEYWORDS.map((keyword) => [keyword, 0]));
  const identifiers = new Map<string, { count: number; files: Set<string> }>();
  let scannedFiles = 0;
  let skippedBinaryFiles = 0;
  for (const file of files) {
    const buffer = await fs.readFile(file);
    if (!looksTextual(buffer)) { skippedBinaryFiles++; continue; }
    scannedFiles++;
    const source = buffer.toString("utf8");
    for (const keyword of KEYWORDS) keywordCounts[keyword] += source.match(new RegExp(`\\b${keyword}\\b`, "gi"))?.length ?? 0;
    for (const match of source.matchAll(/\b(?:CCutscene(?:Node|Element|Block|Track)?[A-Za-z0-9_]+|CutsceneState|c_camera[A-Za-z0-9_]+)\b/g)) {
      const record = identifiers.get(match[0]) ?? { count: 0, files: new Set<string>() };
      record.count++;
      record.files.add(file);
      identifiers.set(match[0], record);
    }
  }
  const identifierList = [...identifiers.entries()].map(([name, entry]) => ({ name, count: entry.count, files: [...entry.files].sort() })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const nodeCandidates = identifierList
    .filter((entry) => entry.name === "CutsceneState" || /^CCutscene/.test(entry.name))
    .map<CutsceneSchemaNode>((entry) => ({
      nativeType: entry.name,
      category: classifyNativeType(entry.name),
      parentTypes: [],
      childTypes: [],
      observedInCorpus: 0,
      discoveredFrom: entry.files,
      confidence: "unknown",
      coverage: "UNKNOWN_NEEDS_RESEARCH",
    }));
  return {
    evidence: { scannedFiles, skippedBinaryFiles, keywords: keywordCounts, identifiers: identifierList },
    nodeCandidates,
  };
}

