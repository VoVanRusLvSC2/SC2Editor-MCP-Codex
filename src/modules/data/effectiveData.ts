import { parentClassCompatibility } from "./parentClasses.js";
import type { DataObject } from "./types.js";
export function flattenDataFields(objects: DataObject[]) {
  const output: Array<{
    path: string;
    ordinal?: number;
    value?: string;
    link?: string;
    attrs: Record<string, string>;
  }> = [];
  const visit = (fields: DataObject["fields"]) => {
    for (const field of fields) {
      output.push({
        path: field.path,
        ordinal: field.ordinal,
        value: field.value,
        link: field.link,
        attrs: field.attrs,
      });
      visit(field.children);
    }
  };
  for (const object of objects) visit(object.fields);
  return output;
}
export function resolveEffectiveData(
  object: DataObject & { engineActive?: boolean },
  all: Array<DataObject & { file: string; layer: string; engineActive?: boolean }>,
  parentIndex?: Map<string, DataObject & { file: string; layer: string; engineActive?: boolean }>,
  indexes?: { defaults: Map<string, typeof all>; layers: Map<string, typeof all> },
) {
  const chain: Array<DataObject & { file: string; layer: string }> = [];
  const visited = new Set<string>();
  const unresolvedParents: Array<{ id: string; reason: string }> = [];
  let current: (DataObject & { file: string; layer: string }) | undefined = object as DataObject & {
    file: string;
    layer: string;
  };
  while (current) {
    const key = `${current.domain ?? current.ctype}\0${current.id ?? ""}`;
    if (visited.has(key)) {
      unresolvedParents.push({ id: current.id ?? "", reason: "PARENT_CYCLE" });
      break;
    }
    visited.add(key);
    chain.unshift(current);
    const parent: string | undefined = current.parent;
    const next: (DataObject & { file: string; layer: string; engineActive?: boolean }) | undefined =
      parent
        ? parentIndex
          ? parentIndex.get(`${current.domain ?? current.ctype}\0${parent}`)
          : all.find(
              (candidate) =>
                candidate.engineActive !== false &&
                (object.engineActive !== true || candidate.engineActive === true) &&
                candidate.id === parent &&
                (candidate.domain ?? candidate.ctype) === (current!.domain ?? current!.ctype),
            )
        : undefined;
    if (parent && !next)
      unresolvedParents.push({
        id: parent,
        reason: object.engineActive === true ? "ACTIVE_PARENT_UNRESOLVED" : "PARENT_UNRESOLVED",
      });
    if (next && parentClassCompatibility(current.ctype, next.ctype) === "incompatible") {
      unresolvedParents.push({ id: parent!, reason: "PARENT_CLASS_INCOMPATIBLE" });
      break;
    }
    current = next;
  }
  const defaults =
    indexes?.defaults.get(object.ctype) ??
    (indexes
      ? []
      : all.filter(
          (entry) =>
            entry.ctype === object.ctype &&
            entry.isDefault &&
            !entry.id &&
            entry.engineActive !== false,
        ));
  if (defaults.length === 1) chain.unshift(defaults[0]);
  const layerConflicts = new Set<string>(),
    layerTokenConflicts = new Set<string>();
  const expanded: typeof chain = [];
  for (const entry of chain) {
    const layers = entry.id
      ? (indexes?.layers.get(entry.domain + "\0" + entry.id) ??
        (indexes
          ? []
          : all.filter(
              (o) => o.id === entry.id && o.domain === entry.domain && o.engineActive !== false,
            )))
      : [];
    for (const layer of layers.filter((o) => o !== entry)) {
      if (
        !expanded.some(
          (e) =>
            e.declarationKey?.file === layer.declarationKey?.file &&
            e.declarationKey?.start === layer.declarationKey?.start &&
            e.id === layer.id,
        )
      )
        expanded.push(layer);
    }
    expanded.push(entry);
  }
  for (const entry of expanded) {
    const layers = expanded.filter((o) => o.id === entry.id && o.domain === entry.domain);
    if (layers.length > 1) {
      const declarations = new Map<string, Set<string>>();
      for (const layer of layers)
        for (const field of flattenDataFields([layer])) {
          const values = declarations.get(field.path) ?? new Set<string>();
          values.add(
            JSON.stringify([field.value, field.link, field.attrs.removed, field.attrs.reset]),
          );
          declarations.set(field.path, values);
        }
      for (const [field, values] of declarations) if (values.size > 1) layerConflicts.add(field);
    }
  }
  for (const entry of expanded) {
    const layers = expanded.filter((o) => o.id === entry.id && o.domain === entry.domain);
    if (layers.length > 1) {
      const declarations = new Map<string, Set<string>>();
      for (const layer of layers)
        for (const [id, raw] of Object.entries(layer.tokens ?? {})) {
          const values = declarations.get(id) ?? new Set<string>();
          values.add(layer.attrs[id] ?? raw);
          declarations.set(id, values);
        }
      for (const [id, values] of declarations) if (values.size > 1) layerTokenConflicts.add(id);
    }
  }
  chain.splice(0, chain.length, ...expanded);
  const tokens: Record<string, string> = {};
  const tokenNames = new Set(
    chain.flatMap((entry) => [
      ...Object.keys(entry.tokens ?? {}),
      ...Object.keys(entry.tokenTypes ?? {}),
    ]),
  );
  for (const entry of chain) {
    Object.assign(tokens, entry.tokens ?? {});
    for (const id of tokenNames) if (entry.attrs[id] !== undefined) tokens[id] = entry.attrs[id];
  }
  if (object.id !== undefined) tokens.id = object.id;
  type Value = {
    path: string;
    value?: string;
    link?: string;
    attrs: Record<string, string>;
    declaredBy?: string;
    file?: string;
    declarationKey?: DataObject["declarationKey"];
    status: "resolved" | "unknown" | "removed";
    reason?: string;
    rawValue?: string;
  };
  const fields = new Map<string, Value>();
  const issues: Array<{ path: string; reason: string }> = [];
  const substitute = (raw: string | undefined): { value?: string; unknown: boolean } => {
    if (raw === undefined) return { unknown: false };
    let value = raw,
      unknown = false;
    for (let iteration = 0; iteration < 16 && value.includes("##"); iteration++) {
      const next = value.replace(/##([^#]+)##/g, (whole, id: string) => {
        if (tokens[id] === undefined) {
          unknown = true;
          return whole;
        }
        return tokens[id];
      });
      if (next === value) break;
      value = next;
    }
    if (value.includes("##")) unknown = true;
    return { value: unknown ? undefined : value, unknown };
  };
  for (const entry of chain) {
    const flat = flattenDataFields([entry]),
      counts = new Map<string, number>(),
      ordinals = new Map<string, number>();
    for (const field of flat) counts.set(field.path, (counts.get(field.path) ?? 0) + 1);
    for (const field of flat) {
      const ordinal = ordinals.get(field.path) ?? 0;
      ordinals.set(field.path, ordinal + 1);
      const repeated = field.ordinal !== undefined || (counts.get(field.path) ?? 0) > 1;
      const path =
        field.ordinal !== undefined
          ? field.path
          : repeated
            ? field.path + "[#" + ordinal + "]"
            : field.path;
      const value = substitute(field.value),
        link = substitute(field.link);
      const removed = field.attrs.removed === "1";
      const reason = [...(field.value ?? field.link ?? "").matchAll(/##([^#]+)##/g)].some((match) =>
        layerTokenConflicts.has(match[1]),
      )
        ? "RUNTIME_LAYER_TOKEN_OVERRIDE_UNVERIFIED"
        : layerConflicts.has(field.path)
          ? "RUNTIME_LAYER_OVERRIDE_UNVERIFIED"
          : repeated
            ? "UNINDEXED_ARRAY_MERGE_UNKNOWN"
            : field.attrs.reset !== undefined
              ? "RESET_RULE_UNKNOWN"
              : value.unknown || link.unknown
                ? "TOKEN_UNRESOLVED"
                : undefined;
      if (reason) issues.push({ path, reason });
      fields.set(path, {
        ...field,
        path,
        value: removed || reason ? undefined : value.value,
        link: removed || reason ? undefined : link.value,
        rawValue: field.value,
        declaredBy: entry.id,
        file: entry.file,
        declarationKey: entry.declarationKey,
        status: reason ? "unknown" : removed ? "removed" : "resolved",
        reason,
      });
    }
  }
  if (defaults.length > 1)
    issues.push({ path: "<defaults>", reason: "DEFAULT_LAYER_ORDER_UNKNOWN" });
  return {
    unindexedArrayDeclarations: chain.flatMap((entry) =>
      flattenDataFields([entry])
        .filter((field) => field.ordinal !== undefined)
        .map((field) => ({
          ...field,
          declaredBy: entry.id,
          file: entry.file,
          status: "unknown",
          reason: "UNINDEXED_ARRAY_MERGE_UNKNOWN",
        })),
    ),
    semanticCoverage: "PARTIAL" as const,
    resolutionScope:
      "Available parent chain, one unambiguous class default and object token substitution; runtime layer/array rules remain explicit",
    issues,
    unresolvedParents,
    templateChain: chain.map((entry) => ({
      id: entry.id,
      ctype: entry.ctype,
      file: entry.file,
      layer: entry.layer,
    })),
    fields: Object.fromEntries(fields),
  };
}
