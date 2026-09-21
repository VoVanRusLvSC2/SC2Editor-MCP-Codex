import { promises as fs } from "node:fs";
import path from "node:path";
import { scanXml } from "../src/core/xmlScanner.js";

type Counts = Record<string, number>;

interface Evidence {
  generatedAt: string;
  sourceRoot: string;
  files: number;
  frameTypes: Counts;
  propertiesByFrameType: Record<string, Counts>;
  animationControllerTypes: Counts;
  stateActionTypes: Counts;
  stateConditionTypes: Counts;
  styleAttributes: Counts;
  templates: BlizzardTemplateEvidence[];
  restrictedFrameRoutes: RestrictedFrameRouteEvidence[];
}

interface BlizzardTemplateEvidence {
  reference: string;
  layout: string;
  name: string;
  frameType: string;
  template?: string;
}

interface RestrictedFrameRouteEvidence {
  frameType: string;
  containerTemplate: string;
  containerFrameType: string;
  targetPath: string;
  targetTemplate?: string;
  providedChildPaths: string[];
}

function increment(bag: Counts, key: string): void {
  bag[key] = (bag[key] ?? 0) + 1;
}

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (/\.(?:SC2Layout|StormLayout|SC2Style)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

const sourceRoot = path.resolve(process.argv[2] ?? "");
const output = path.resolve(process.argv[3] ?? "schema/core-observations.json");
if (!process.argv[2]) throw new Error("Usage: tsx scripts/generate-schema-evidence.ts <Blizzard UI directory> [output]");

const evidence: Evidence = {
  generatedAt: new Date().toISOString(),
  sourceRoot: path.basename(sourceRoot),
  files: 0,
  frameTypes: {},
  propertiesByFrameType: {},
  animationControllerTypes: {},
  stateActionTypes: {},
  stateConditionTypes: {},
  styleAttributes: {},
  templates: [],
  restrictedFrameRoutes: [],
};

const frameTypeSchemaPath = path.join(path.dirname(output), "upstream", "frame_type.xml");
const frameTypeSchema = scanXml(await fs.readFile(frameTypeSchemaPath, "utf8"));
const restrictedTypes = new Set(
  frameTypeSchema.nodes
    .filter((node) => node.tag === "frameType" && node.attrs.blizzOnly?.toLowerCase() === "true")
    .map((node) => node.attrs.name)
    .filter((name): name is string => Boolean(name)),
);
const routeKeys = new Set<string>();

for (const file of await walk(sourceRoot)) {
  const source = await fs.readFile(file, "utf8");
  const parsed = scanXml(source);
  const layout = path.basename(file).replace(/\.(?:SC2Layout|StormLayout)$/i, "");
  evidence.files++;
  for (const node of parsed.nodes) {
    if (node.tag === "Frame" && node.attrs.type) {
      const frameType = node.attrs.type;
      increment(evidence.frameTypes, frameType);
      const bag = evidence.propertiesByFrameType[frameType] ??= {};
      for (const id of node.childIds) {
        const child = parsed.nodes[id];
        if (!["Frame", "Anchor", "StateGroup", "Animation"].includes(child.tag)) increment(bag, child.tag);
      }
      const parent = node.parentId === null ? undefined : parsed.nodes[node.parentId];
      if (parent?.tag === "Desc" && node.attrs.name) {
        evidence.templates.push({
          reference: `${layout}/${node.attrs.name}`,
          layout,
          name: node.attrs.name,
          frameType,
          ...(node.attrs.template ? { template: node.attrs.template } : {}),
        });
      }
      if (restrictedTypes.has(frameType) && parent?.tag === "Frame") {
        let top = node;
        const segments: string[] = [];
        let cursor: typeof node | undefined = node;
        while (cursor?.parentId !== null && cursor?.parentId !== undefined) {
          const ancestor = parsed.nodes[cursor.parentId];
          if (ancestor.tag !== "Frame") break;
          if (cursor.attrs.name) segments.unshift(cursor.attrs.name);
          top = ancestor;
          cursor = ancestor;
        }
        if (top.attrs.name && top.attrs.type && segments.length) {
          const providedChildPaths: string[] = [];
          const collectChildren = (parentNode: typeof node, prefix = "") => {
            for (const childId of parentNode.childIds) {
              const child = parsed.nodes[childId];
              if (child.tag !== "Frame" || !child.attrs.name) continue;
              const childPath = prefix ? `${prefix}/${child.attrs.name}` : child.attrs.name;
              providedChildPaths.push(childPath);
              collectChildren(child, childPath);
            }
          };
          collectChildren(node);
          const route: RestrictedFrameRouteEvidence = {
            frameType,
            containerTemplate: `${layout}/${top.attrs.name}`,
            containerFrameType: top.attrs.type,
            targetPath: segments.join("/"),
            ...(node.attrs.template ? { targetTemplate: node.attrs.template } : {}),
            providedChildPaths: providedChildPaths.sort(),
          };
          const key = `${route.frameType}\0${route.containerTemplate}\0${route.targetPath}\0${route.targetTemplate ?? ""}`;
          if (!routeKeys.has(key)) {
            routeKeys.add(key);
            evidence.restrictedFrameRoutes.push(route);
          }
        }
      }
    } else if (node.tag === "Controller" && node.attrs.type) increment(evidence.animationControllerTypes, node.attrs.type);
    else if (node.tag === "Action" && node.attrs.type) increment(evidence.stateActionTypes, node.attrs.type);
    else if (node.tag === "When" && node.attrs.type) increment(evidence.stateConditionTypes, node.attrs.type);
    else if (node.tag === "Style") for (const name of Object.keys(node.attrs)) increment(evidence.styleAttributes, name);
  }
}

for (const bag of [evidence.frameTypes, evidence.animationControllerTypes, evidence.stateActionTypes, evidence.stateConditionTypes, evidence.styleAttributes]) {
  const sorted = Object.fromEntries(Object.entries(bag).sort(([a], [b]) => a.localeCompare(b)));
  for (const key of Object.keys(bag)) delete bag[key];
  Object.assign(bag, sorted);
}
for (const type of Object.keys(evidence.propertiesByFrameType)) {
  evidence.propertiesByFrameType[type] = Object.fromEntries(Object.entries(evidence.propertiesByFrameType[type]).sort(([a], [b]) => a.localeCompare(b)));
}
evidence.propertiesByFrameType = Object.fromEntries(Object.entries(evidence.propertiesByFrameType).sort(([a], [b]) => a.localeCompare(b)));
evidence.templates.sort((a, b) => a.reference.localeCompare(b.reference));
evidence.restrictedFrameRoutes.sort((a, b) =>
  a.frameType.localeCompare(b.frameType) ||
  a.containerTemplate.localeCompare(b.containerTemplate) ||
  a.targetPath.localeCompare(b.targetPath));

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Wrote ${output}: ${evidence.files} files, ${Object.keys(evidence.frameTypes).length} frame types`);
