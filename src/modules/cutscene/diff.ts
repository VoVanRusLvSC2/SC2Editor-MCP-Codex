import { CutsceneDocument } from "./document.js";

export interface SemanticCutsceneChange {
  kind: "node-added" | "node-removed" | "property-changed";
  object: string;
  property?: string;
  before?: string;
  after?: string;
}

function identity(node: { id: number; tag: string; attrs: Record<string, string> }): string {
  return node.attrs.guid ? `guid:${node.attrs.guid}` : `${node.tag}#${node.id}`;
}

export function semanticCutsceneDiff(before: CutsceneDocument, after: CutsceneDocument): { changes: SemanticCutsceneChange[]; unknownPreserved: boolean } {
  const left = new Map(before.nodes.map((node) => [identity(node), node]));
  const right = new Map(after.nodes.map((node) => [identity(node), node]));
  const changes: SemanticCutsceneChange[] = [];
  for (const [id, node] of left) {
    const next = right.get(id);
    if (!next) {
      changes.push({ kind: "node-removed", object: id, before: node.tag });
      continue;
    }
    const attrs = new Set([...Object.keys(node.attrs), ...Object.keys(next.attrs)]);
    for (const name of attrs) if (node.attrs[name] !== next.attrs[name]) changes.push({ kind: "property-changed", object: id, property: name, before: node.attrs[name], after: next.attrs[name] });
  }
  for (const [id, node] of right) if (!left.has(id)) changes.push({ kind: "node-added", object: id, after: node.tag });
  return { changes, unknownPreserved: true };
}

