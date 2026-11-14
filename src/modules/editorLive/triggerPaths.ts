import * as z from "zod/v4";

/** One-based child indexes, always relative to a fingerprinted native snapshot. */
const indexes = z.array(z.number().int().min(1).max(8192)).max(16);
export const triggerChildPath = z
  .union([
    indexes,
    z
      .number()
      .int()
      .min(1)
      .max(8192)
      .transform((value) => [value]),
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
export function structuralTree(items: readonly TriggerTreeItem[]) {
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

export function subtreeRange(items: readonly TriggerTreeItem[], index: number) {
  if (!items[index]) throw Error("LIVE_TRIGGER_ITEM_INDEX_OUT_OF_RANGE");
  let end = index + 1;
  while (end < items.length && items[end].depth > items[index].depth) end++;
  return { start: index, end };
}
export function itemChildPath(items: readonly TriggerTreeItem[], handle: string) {
  triggerAncestors(items, handle);
  const result: number[] = [];
  let item = items.find((item) => item.handle === handle)!;
  while (item.parent !== "0") {
    result.unshift(
      items
        .filter((row) => row.parent === item.parent)
        .findIndex((row) => row.handle === item.handle) + 1,
    );
    item = items.find((row) => row.handle === item.parent)!;
  }
  return result;
}
const sameStructure = (a: readonly TriggerTreeItem[], b: readonly TriggerTreeItem[]) =>
  JSON.stringify(structuralTree(a)) === JSON.stringify(structuralTree(b));
const detached = (items: readonly TriggerTreeItem[]) =>
  items.map((item, index) => ({
    ...item,
    parent: index === 0 ? "0" : item.parent,
    depth: item.depth - items[0].depth,
  }));

/** Accept only the requested complete subtree edit; all other branches are identical. */
export function verifyGraphEdit(
  before: readonly TriggerTreeItem[],
  after: readonly TriggerTreeItem[],
  handle: string,
  operation: "delete" | "up" | "down" | "in" | "out",
) {
  structuralTree(before);
  structuralTree(after);
  const index = before.findIndex((row) => row.handle === handle);
  const range = subtreeRange(before, index),
    source = before[index];
  const removed = [...before.slice(0, range.start), ...before.slice(range.end)];
  if (operation === "delete") return { verified: sameStructure(removed, after) };
  const subtree = before.slice(range.start, range.end);
  if (operation === "up" || operation === "down") {
    const siblings = before.filter((row) => row.parent === source.parent);
    const position = siblings.findIndex((row) => row.handle === handle);
    const neighbor = siblings[position + (operation === "up" ? -1 : 1)];
    if (!neighbor) throw Error("LIVE_TRIGGER_MOVE_BOUNDARY");
    const neighborRange = subtreeRange(before, before.indexOf(neighbor));
    const expected =
      operation === "up"
        ? [
            ...before.slice(0, neighborRange.start),
            ...subtree,
            ...before.slice(neighborRange.start, neighborRange.end),
            ...before.slice(range.end),
          ]
        : [
            ...before.slice(0, range.start),
            ...before.slice(neighborRange.start, neighborRange.end),
            ...subtree,
            ...before.slice(neighborRange.end),
          ];
    return { verified: sameStructure(expected, after) };
  }
  const candidates = after.flatMap((item, index) => {
    if (operation === "in" ? item.depth <= source.depth : item.depth >= source.depth) return [];
    const candidate = subtreeRange(after, index);
    if (!sameStructure(detached(subtree), detached(after.slice(index, candidate.end)))) return [];
    if (!sameStructure(removed, [...after.slice(0, index), ...after.slice(candidate.end)]))
      return [];
    return [item];
  });
  return {
    verified: candidates.length === 1,
    ...(candidates.length === 1 ? { movedPath: itemChildPath(after, candidates[0].handle) } : {}),
  };
}

/** Permit one parameter source/subtree replacement and its rendered ancestor labels. */
export function verifyParameterRebind(
  before: readonly TriggerTreeItem[],
  after: readonly TriggerTreeItem[],
  handle: string,
  allowTypeReset = false,
) {
  structuralTree(before);
  structuralTree(after);
  const oldIndex = before.findIndex((row) => row.handle === handle);
  const oldRange = subtreeRange(before, oldIndex),
    path = itemChildPath(before, handle);
  const roots = after.filter((row) => row.parent === "0");
  if (roots.length !== 1) return { verified: false };
  const bound = triggerItemAtPath(after, roots[0], path);
  if (allowTypeReset) return { verified: true, bound, dependentParametersUnverified: true };
  const newIndex = after.indexOf(bound),
    newRange = subtreeRange(after, newIndex);
  const ancestors = triggerAncestors(before, handle);
  const oldRest = [...before.slice(0, oldRange.start), ...before.slice(oldRange.end)];
  const newRest = [...after.slice(0, newRange.start), ...after.slice(newRange.end)];
  if (oldRest.length !== newRest.length) return { verified: false };
  const oldShape = structuralTree(oldRest),
    newShape = structuralTree(newRest);
  return {
    verified: oldShape.every(
      (row, index) =>
        row.parent === newShape[index].parent &&
        row.depth === newShape[index].depth &&
        ((row.parent !== -1 && ancestors.has(oldRest[index].handle)) ||
          row.text === newShape[index].text),
    ),
    bound,
  };
}

export function expectedGraphTransfer(
  items: readonly TriggerTreeItem[],
  sourceHandle: string,
  destinationHandle: string,
  insertionHandle: string,
) {
  structuralTree(items);
  const start = items.findIndex((row) => row.handle === sourceHandle),
    range = subtreeRange(items, start);
  const destination = items.find((row) => row.handle === destinationHandle);
  if (!destination || triggerAncestors(items, destinationHandle).has(sourceHandle))
    throw Error("LIVE_TRIGGER_MOVE_CYCLIC");
  const rest = [...items.slice(0, range.start), ...items.slice(range.end)];
  const targetIndex = rest.findIndex((row) => row.handle === insertionHandle);
  if (targetIndex < 0) throw Error("LIVE_TRIGGER_MOVE_TARGET_REMOVED");
  const insertAt =
    insertionHandle === destinationHandle ? targetIndex + 1 : subtreeRange(rest, targetIndex).end;
  const shift = destination.depth + 1 - items[start].depth;
  const moved = items.slice(range.start, range.end).map((row, index) => ({
    ...row,
    parent: index === 0 ? destinationHandle : row.parent,
    depth: row.depth + shift,
  }));
  return [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)];
}
