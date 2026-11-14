import * as z from "zod/v4";

/** One-based child indexes, always relative to a fingerprinted native snapshot. */
const indexes = z.array(z.number().int().min(1).max(8192)).max(16);
export const triggerChildPath = z
  .union([
    indexes,
    z
      .string()
      .max(100)
      .regex(/^[1-9]\d*(?:\/[1-9]\d*)*$/)
      .transform((value) => value.split("/").map(Number)),
  ])
  .pipe(indexes);
export const triggerSection = z.enum(["actions", "events", "conditions"]);
export const triggerSectionLabel = {
  actions: "Actions",
  events: "Events",
  conditions: "Conditions",
} as const;

export interface TriggerTreeItem {
  handle: string;
  parent: string;
  depth: number;
  text: string;
}

export function triggerItemAtPath<T extends TriggerTreeItem>(
  items: readonly T[],
  root: T,
  indexes: readonly number[] = [],
): T {
  triggerChildPath.parse(indexes);
  let item = root;
  const seen = new Set([root.handle]);
  for (const index of indexes) {
    const next = items.filter((candidate) => candidate.parent === item.handle)[index - 1];
    if (!next || seen.has(next.handle) || next.depth !== item.depth + 1)
      throw Error("LIVE_TRIGGER_CHILD_PATH_INVALID");
    item = next;
    seen.add(item.handle);
  }
  return item;
}

/** Return the exact ancestor chain; never allow changes on an unrelated branch. */
export function triggerAncestors(items: readonly TriggerTreeItem[], handle: string): Set<string> {
  const byHandle = new Map(items.map((item) => [item.handle, item]));
  if (byHandle.size !== items.length) throw Error("LIVE_TRIGGER_TREE_DUPLICATE_HANDLE");
  const result = new Set<string>();
  let item = byHandle.get(handle);
  if (!item) throw Error("LIVE_TRIGGER_CHILD_PATH_INVALID");
  while (item) {
    if (result.has(item.handle) || result.size > 8192)
      throw Error("LIVE_TRIGGER_TREE_INVALID_ANCESTRY");
    result.add(item.handle);
    if (item.parent === "0") break;
    const parent = byHandle.get(item.parent);
    if (!parent || parent.depth + 1 !== item.depth)
      throw Error("LIVE_TRIGGER_TREE_INVALID_ANCESTRY");
    item = parent;
  }
  return result;
}

export function triggerChildren<T extends TriggerTreeItem>(items: readonly T[], parent: T) {
  return items
    .filter((item) => item.parent === parent.handle)
    .map((item, index) => ({
      index: index + 1,
      text: item.text,
      hasChildren: items.some((child) => child.parent === item.handle),
    }));
}

/** Native condition commits can rebuild every tree handle. Compare structure,
 * labels and sibling order instead of mistaking recycled HWND item IDs for data.
 */
function structuralTree(items: readonly TriggerTreeItem[]) {
  if (items.length > 8192) throw Error("LIVE_TRIGGER_TREE_BOUND");
  const seen = new Set<string>();
  const stack: Array<{ handle: string; index: number }> = [];
  return items.map((item, index) => {
    if (
      seen.has(item.handle) ||
      !Number.isInteger(item.depth) ||
      item.depth < 0 ||
      item.depth > stack.length
    )
      throw Error("LIVE_TRIGGER_TREE_INVALID_ANCESTRY");
    seen.add(item.handle);
    stack.length = item.depth;
    const parent = stack.at(-1);
    if (item.parent !== (parent?.handle ?? "0")) throw Error("LIVE_TRIGGER_TREE_INVALID_ANCESTRY");
    stack.push({ handle: item.handle, index });
    return { parent: parent?.index ?? -1, depth: item.depth, text: item.text };
  });
}

/** Verify exactly one appended subtree at the original structural parent path. */
export function verifyTriggerInsertion<T extends TriggerTreeItem>(
  before: readonly T[],
  after: readonly T[],
  parent: string,
) {
  const original = structuralTree(before);
  structuralTree(after);
  let old = before.find((item) => item.handle === parent);
  if (!old) return undefined;
  const childPath: number[] = [];
  while (old.parent !== "0") {
    childPath.unshift(
      before
        .filter((item) => item.parent === old!.parent)
        .findIndex((item) => item.handle === old!.handle) + 1,
    );
    old = before.find((item) => item.handle === old!.parent);
    if (!old) return undefined;
  }
  const roots = before.filter((item) => item.parent === "0");
  const rootIndex = roots.findIndex((item) => item.handle === old!.handle);
  const freshRoot = after.filter((item) => item.parent === "0")[rootIndex];
  if (!freshRoot) return undefined;
  // The ancestry path can exceed the user selector bound by the section/root.
  let freshParent = freshRoot;
  for (const index of childPath) {
    const child = after.filter((item) => item.parent === freshParent.handle)[index - 1];
    if (!child) return undefined;
    freshParent = child;
  }
  const oldChildren = before.filter((item) => item.parent === parent);
  const children = after.filter((item) => item.parent === freshParent.handle);
  if (children.length !== oldChildren.length + 1) return undefined;
  const added = children.at(-1)!;
  const start = after.indexOf(added);
  let end = start + 1;
  while (end < after.length && after[end].depth > added.depth) end++;
  const retained = structuralTree([...after.slice(0, start), ...after.slice(end)]);
  if (
    retained.length !== original.length ||
    retained.some((item, index) => {
      const old = original[index];
      return item.parent !== old.parent || item.depth !== old.depth || item.text !== old.text;
    })
  )
    return undefined;
  return added;
}

export function assertTriggerContainer(item: TriggerTreeItem, nested: boolean) {
  if (
    nested &&
    !["Actions", "Conditions", "If", "Then", "Else", "Do", "Body", "Sub-Actions"].includes(
      item.text,
    )
  )
    throw Error("LIVE_TRIGGER_CHILD_NOT_SUPPORTED_CONTAINER");
}

export function triggerNestedFields(args: { groupPath?: number[]; parameterPath?: number[] }) {
  return {
    ...(args.groupPath?.length ? { groupPath: args.groupPath } : {}),
    ...(args.parameterPath?.length ? { parameterPath: args.parameterPath } : {}),
  };
}
