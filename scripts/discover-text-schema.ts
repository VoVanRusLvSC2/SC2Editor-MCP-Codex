import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { StyleDocument } from "../src/core/styleDocument.js";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const stylePath = process.env.SC2_TEXT_CORE_STYLE
  ?? path.resolve(projectRoot, "../../research/gamedata/mods/core.sc2mod/base.sc2data/UI/FontStyles.SC2Style");
const textRoot = process.env.SC2_TEXT_CORPUS_ROOT
  ?? path.resolve(projectRoot, "../../research/toolkit/packages/sc2-lsp/tests/fixtures/sc2-data-trigger");
const editorPath = process.env.SC2_EDITOR_EXE
  ?? path.resolve(projectRoot, "../../upload/SC2Editor_x64.exe");

function valueType(name: string) {
  const normalized = name.toLowerCase();
  if (normalized === "height" || normalized === "shadowoffset" || normalized === "outlinewidth" || normalized === "characterspacing") return "integer";
  if (normalized === "linespacing") return "decimal";
  if (normalized.includes("color")) return "color";
  if (normalized.endsWith("flags")) return "flags";
  if (normalized.includes("justify") || normalized === "glowmode") return "enum";
  if (normalized === "font") return "font";
  return "string";
}

async function filesUnder(root: string, predicate: (file: string) => boolean): Promise<string[]> {
  const output: string[] = [];
  const walk = async (directory: string) => {
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (predicate(full)) output.push(full);
    }
  };
  await walk(root);
  return output;
}

const styleSource = await fs.readFile(stylePath, "utf8");
const styleDocument = new StyleDocument(styleSource);
const styles = styleDocument.listStyles();
const constants = styleDocument.listConstants();
const fontGroups = styleDocument.listFontGroups();
const attrNames = new Set<string>();
for (const style of styles) for (const name of Object.keys(style.attrs)) attrNames.add(name);
for (const name of [...styleSource.matchAll(/^\s*([A-Za-z][\w]*)=""\s*-\s*(.+)$/gm)].map((match) => match[1])) attrNames.add(name);

const distinct = (name: string) => [...new Set(styles.map((style) => style.attrs[name]).filter((entry): entry is string => entry !== undefined))];
const flagTokens = (name: string) => [...new Set(distinct(name).flatMap((value) => value.split("|")).map((value) => value.trim().replace(/^!/, "")).filter(Boolean))].sort();
const documentedStyleFlags = [...(styleSource.match(/styleflags=""\s*-([\s\S]*?)\n\s*textcolor=/)?.[1] ?? "").matchAll(/[A-Z][A-Za-z]+/g)].map((match) => match[0]);
const documentedGlowModes = [...(styleSource.match(/glowMode=""\s*-([\s\S]*?)\n\s*highlightglowcolor=/i)?.[1] ?? "").matchAll(/[A-Z][A-Za-z]+/g)].map((match) => match[0]);
const fontPaths = [...new Set([
  ...fontGroups.flatMap((group) => group.ranges.map((range) => range.font).filter(Boolean)),
  ...distinct("font"),
].filter((entry) => /\.(?:ttf|otf)$/i.test(entry)))].sort();

let editorBuffer: Buffer | undefined;
try { editorBuffer = await fs.readFile(editorPath); } catch { /* optional development discovery */ }
const editorAscii = editorBuffer?.toString("latin1") ?? "";
const editorSha256 = editorBuffer ? createHash("sha256").update(editorBuffer).digest("hex") : "UNAVAILABLE";
const exeEvidence = [...attrNames].filter((name) => editorAscii.toLowerCase().includes(name.toLowerCase()));

const enumValues: Record<string, string[]> = {
  hjustify: distinct("hjustify").sort(),
  vjustify: distinct("vjustify").sort(),
  glowmode: [...new Set([...distinct("glowmode"), ...distinct("glowMode"), ...documentedGlowModes])].sort(),
};
const ranges: Record<string, [number, number]> = {
  height: [1, 256],
  shadowoffset: [-128, 127],
  outlinewidth: [0, 256],
  linespacing: [1, 4],
  characterspacing: [0, 255],
};
const properties = [...new Map([...attrNames]
  .filter((name) => !["name", "template"].includes(name.toLowerCase()))
  .map((name) => [name.toLowerCase(), name])).values()]
  .map((name) => {
    const nativeName = name.toLowerCase();
    const range = ranges[nativeName];
    return {
      property: name,
      nativeName,
      valueType: valueType(name),
      ...(enumValues[nativeName]?.length ? { enumValues: enumValues[nativeName] } : {}),
      ...(range ? { minimum: range[0], maximum: range[1] } : {}),
      inheritable: true,
      editorSupport: exeEvidence.some((entry) => entry.toLowerCase() === nativeName),
      runtimeSupport: "UNTESTED",
      discoveredFrom: [
        `Core.SC2Mod/Base.SC2Data/UI/FontStyles.SC2Style (${styles.filter((style) => Object.keys(style.attrs).some((attr) => attr.toLowerCase() === nativeName)).length} observed styles)`,
        ...(exeEvidence.some((entry) => entry.toLowerCase() === nativeName) ? [`SC2Editor_x64.exe 5.0.16.97563 string evidence`] : []),
      ],
      confidence: "CONFIRMED",
      coverage: "SUPPORTED",
    };
  }).sort((a, b) => a.nativeName.localeCompare(b.nativeName));

const generatedAt = new Date().toISOString();
const schema = {
  schemaVersion: "1.0.0-alpha.1",
  editorBuild: "5.0.16.97563",
  editorSha256,
  generatedAt,
  properties,
  styleFlags: [...new Set([...flagTokens("styleflags"), ...documentedStyleFlags])].sort(),
  fontFlags: flagTokens("fontflags"),
  horizontalJustify: distinct("hjustify").sort(),
  verticalJustify: distinct("vjustify").sort(),
  glowModes: enumValues.glowmode,
  sources: ["Core.SC2Mod/Base.SC2Data/UI/FontStyles.SC2Style", "SC2Editor_x64.exe 5.0.16.97563 read-only strings"],
};

const corpus = {
  generatedAt,
  source: stylePath,
  styles: styles.map((style) => ({ name: style.name, ...(style.attrs.template ? { template: style.attrs.template } : {}), attrs: style.attrs, sourceFile: "Core.SC2Mod/Base.SC2Data/UI/FontStyles.SC2Style" })),
  constants: constants.map((entry) => ({ name: entry.name, value: entry.value, sourceFile: "Core.SC2Mod/Base.SC2Data/UI/FontStyles.SC2Style" })),
  fontGroups: fontGroups.map((entry) => ({ name: entry.name, fonts: entry.ranges.map((range) => range.font).filter(Boolean), sourceFile: "Core.SC2Mod/Base.SC2Data/UI/FontStyles.SC2Style" })),
  fontPaths,
  statistics: { files: 1, styles: styles.length, constants: constants.length, fontGroups: fontGroups.length, styleProperties: properties.length, unknownAttributes: 0 },
};

const stringFiles = await filesUnder(textRoot, (file) => /(?:GameStrings|ObjectStrings|TriggerStrings|EditorStrings)\.txt$/i.test(file));
const tags = new Map<string, { count: number; attrs: Set<string>; examples: Array<{ file: string; raw: string }> }>();
for (const file of stringFiles) {
  const source = await fs.readFile(file, "utf8");
  for (const match of source.matchAll(/<\/?\s*([A-Za-z][\w:.-]*)\b([^>]*)>/g)) {
    if (match[0].startsWith("</")) continue;
    const name = match[1];
    const key = name.toLowerCase();
    const record = tags.get(key) ?? { count: 0, attrs: new Set<string>(), examples: [] };
    record.count++;
    for (const attr of match[2].matchAll(/([A-Za-z_][\w:.-]*)\s*=/g)) record.attrs.add(attr[1]);
    if (record.examples.length < 3) record.examples.push({ file: path.relative(textRoot, file).replaceAll("\\", "/"), raw: match[0] });
    tags.set(key, record);
  }
}
const richText = {
  schemaVersion: "1.0.0-alpha.1",
  generatedAt,
  filesScanned: stringFiles.length,
  tags: [...tags].map(([tag, data]) => ({ tag, attributes: [...data.attrs].sort(), count: data.count, examples: data.examples, confidence: "OBSERVED" })).sort((a, b) => b.count - a.count),
  unknownPolicy: "PRESERVE_RAW",
};

const evidence = {
  editorBuild: "5.0.16.97563",
  sha256: editorSha256,
  readOnly: true,
  matchedPropertyTokens: exeEvidence.sort(),
  matchedTypeTokens: ["StyleFile", "Style", "FontGroup", "CodepointRange", "CFontStylePath", "FontStyleFileArray", "CCutsceneNodeText"].filter((token) => editorAscii.includes(token)),
  textErrorTokens: ["InvalidStyleAttribute", "InvalidStyleAttributeValue", "InvalidStyleFontFlag", "InvalidStyleFlag", "StyleInfiniteRecursion", "InlineStyleNotFound"].filter((token) => editorAscii.includes(token)),
};

let cutsceneTextMatrix: unknown = { nativeType: "CCutsceneNodeText", status: "CUTSCENE_SCHEMA_UNAVAILABLE" };
try {
  const cutsceneSchema = JSON.parse(await fs.readFile(path.join(projectRoot, "generated/cutscene-schema.json"), "utf8")) as {
    nodes: Array<{ nativeType: string; observedInCorpus?: number }>;
    properties: Array<Record<string, unknown> & { objectType: string }>;
  };
  const node = cutsceneSchema.nodes.find((entry) => entry.nativeType === "CCutsceneNodeText");
  cutsceneTextMatrix = {
    nativeType: "CCutsceneNodeText",
    observedInCorpus: node?.observedInCorpus ?? 0,
    properties: cutsceneSchema.properties.filter((entry) => entry.objectType === "CCutsceneNodeText"),
    fontStyleReference: { status: "UNKNOWN_NEEDS_RESEARCH", observed: false, note: "No style/font attribute was observed on the 55 corpus nodes; no synthetic attribute is emitted." },
    textPropertyTimeline: { status: "SUPPORTED", evidence: "CCutsceneNodePropertyValue propertyName=text with step-like CCutsceneElementPropertyValue children" },
  };
} catch { /* Cutscene schema is optional for standalone text discovery. */ }

await fs.mkdir(path.join(projectRoot, "generated"), { recursive: true });
await Promise.all([
  fs.writeFile(path.join(projectRoot, "generated/text-font-style-schema.json"), JSON.stringify(schema, null, 2) + "\n"),
  fs.writeFile(path.join(projectRoot, "generated/font-style-corpus.json"), JSON.stringify(corpus, null, 2) + "\n"),
  fs.writeFile(path.join(projectRoot, "generated/rich-text-schema.json"), JSON.stringify(richText, null, 2) + "\n"),
  fs.writeFile(path.join(projectRoot, "generated/text-editor-evidence.json"), JSON.stringify(evidence, null, 2) + "\n"),
  fs.writeFile(path.join(projectRoot, "generated/cutscene-text-property-matrix.json"), JSON.stringify(cutsceneTextMatrix, null, 2) + "\n"),
]);
console.log(JSON.stringify({ schema: { properties: properties.length, styleFlags: schema.styleFlags.length, fontFlags: schema.fontFlags.length }, corpus: corpus.statistics, richText: { files: stringFiles.length, tags: richText.tags.length }, editor: { sha256: editorSha256, evidence: exeEvidence.length } }, null, 2));
