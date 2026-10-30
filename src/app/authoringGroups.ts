import type { BatchStep, BatchTool } from "./mcpBatch.js";

type Args = Record<string, any>;
type Mode = "plan" | "stage" | "save";
interface Candidate {
  first: BatchStep;
  tail: BatchStep[];
  width: number;
  tool: string;
  array: "operations" | "objects";
  values: unknown[];
  args: Args;
  key: string;
  limit: number;
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
const references = (step: BatchStep): string[] =>
  [...JSON.stringify(step.args).matchAll(/"\$from":"([^"\\]*)"/g)].map((m) => m[1].split(".")[0]);

/** Preserve original schemas and lifecycle boundaries; only adjacent compatible
 * changes become one candidate/validation/save group. Public batch stays serial.
 */
export function coalesceAuthoringSteps(
  steps: BatchStep[],
  mode: Mode,
  tools?: ReadonlyMap<string, BatchTool>,
): BatchStep[] {
  if (!tools) return steps;
  const consumers = new Map<string, Set<string>>();
  for (const step of steps)
    for (const id of references(step)) {
      const names = consumers.get(id) ?? new Set<string>();
      names.add(step.id);
      consumers.set(id, names);
    }
  const candidate = (index: number): Candidate | undefined => {
    const first = steps[index];
    if (
      first.select ||
      references(first).length ||
      /"(?:__proto__|constructor|prototype)"\s*:/.test(JSON.stringify(first.args))
    )
      return;
    let parsed: Args;
    try {
      parsed = tools.get(first.tool)!.schema.parse(first.args) as Args;
    } catch {
      return;
    }
    if (Object.keys(first.args).some((k) => !Object.hasOwn(parsed, k))) return;
    let tool = first.tool,
      array: Candidate["array"] = "operations",
      limit: number;
    let args: Args,
      values: unknown[],
      apply: string | undefined,
      planField = "planId";
    if (tool === "text.apply") {
      if (parsed.operations.some((o: Args) => o.op === "font.import") || parsed.expectedSha256)
        return;
      ({ operations: values, ...args } = parsed);
      limit = 250;
    } else if (tool === "settings.plan") {
      ({ operations: values, ...args } = parsed);
      limit = 100;
      apply = "settings.apply";
      planField = "id";
    } else if (["terrain.plan", "terrain.paint", "terrain.blend"].includes(tool)) {
      if (tool === "terrain.plan") ({ operations: values, ...args } = parsed);
      else {
        const { directory, ...brush } = parsed;
        args = { directory };
        values = [{ op: tool === "terrain.paint" ? "texture.paint" : "texture.blend", ...brush }];
      }
      if ((values as Args[]).some((o) => ["load.repair", "stamp.apply"].includes(o.op))) return;
      tool = "terrain.plan";
      limit = 100;
      apply = "terrain.apply";
      planField = "id";
    } else if (["placement.addUnit", "placement.addDoodad", "placement.addBatch"].includes(tool)) {
      array = "objects";
      limit = 5000;
      apply = "placement.apply";
      planField = "id";
      if (tool === "placement.addBatch") ({ objects: values, ...args } = parsed);
      else {
        const {
          count,
          layout,
          snapToTerrain,
          terrainDirectory,
          maxSlope,
          objectFile,
          componentListFile,
          bounds,
          outsidePlayableReason,
          ...object
        } = parsed;
        if (count !== 1 || (layout && layout.type !== "single")) return;
        args = { objectFile, componentListFile, bounds, outsidePlayableReason };
        values = [
          {
            kind: tool === "placement.addUnit" ? "Unit" : "Doodad",
            ...object,
            snapToTerrain,
            terrainDirectory,
            maxSlope,
          },
        ];
      }
      tool = "placement.addBatch";
    } else return;
    if (!Array.isArray(values) || !values.length || !tools.has(tool)) return;
    const tail: BatchStep[] = [];
    if (mode !== "plan" && apply) {
      const step = steps[index + 1];
      const expected = {
        planId: { $from: `${first.id}.${planField}` },
        dryRun: false,
        stage: true,
      };
      if (
        !step ||
        step.tool !== apply ||
        step.select ||
        canonical(step.args) !== canonical(expected)
      )
        return;
      tail.push(step);
    }
    if (mode === "save") {
      const save = steps[index + 1 + tail.length];
      const expectedTool =
        apply === "settings.apply"
          ? "settings.save"
          : apply === "terrain.apply"
            ? "terrain.save"
            : "modkit.save";
      if (!save || save.tool !== expectedTool || save.select) return;
      if (!apply || apply === "placement.apply") {
        if (Object.keys(save.args).some((k) => k !== "file")) return;
        const files =
          tool === "text.apply" ? Object.values(args.stringFiles ?? {}) : [args.objectFile];
        if (typeof save.args.file !== "string" || !files.includes(save.args.file)) return;
      } else {
        const expected =
          apply === "settings.apply"
            ? { transactionId: { $from: `${tail[0].id}.transactionId` }, dryRun: false }
            : { planId: { $from: `${first.id}.id` }, dryRun: false };
        if (canonical(save.args) !== canonical(expected)) return;
      }
      tail.push(save);
    }
    const ids = new Set([first, ...tail].map((s) => s.id));
    if ([...ids].some((id) => [...(consumers.get(id) ?? [])].some((name) => !ids.has(name))))
      return;
    // Save references are internal lifecycle edges; other refs are boundaries.
    if (tail.some((step) => references(step).some((id) => !ids.has(id)))) return;
    if (tail.some((step) => !tools.has(step.tool))) return;
    // Lifecycle placeholders keep their original structure and are validated
    // when resolved by the normal batch executor.
    let normalized: Args;
    try {
      normalized = tools.get(tool)!.schema.parse({ ...args, [array]: values }) as Args;
    } catch {
      return;
    }
    const { [array]: _values, ...base } = normalized;
    void _values;
    const saveKey = mode === "save" && !apply ? tail.at(-1)?.args : undefined;
    return {
      first,
      tail,
      width: 1 + tail.length,
      tool,
      array,
      values,
      args: base,
      key: canonical([tool, base, saveKey]),
      limit,
    };
  };
  const out: BatchStep[] = [];
  for (let index = 0; index < steps.length;) {
    const first = candidate(index);
    if (!first) {
      out.push(steps[index++]);
      continue;
    }
    const values = [...first.values];
    let end = index + first.width,
      count = 1;
    while (end < steps.length) {
      const next = candidate(end);
      if (!next || next.key !== first.key || values.length + next.values.length > first.limit)
        break;
      values.push(...next.values);
      end += next.width;
      count++;
    }
    const args = { ...first.args, [first.array]: values };
    let compatible = true;
    try {
      tools.get(first.tool)!.schema.parse(args);
    } catch {
      compatible = false;
    }
    if (count === 1 || !compatible) out.push(...steps.slice(index, end));
    else out.push({ id: first.first.id, tool: first.tool, args }, ...first.tail);
    index = end;
  }
  return out;
}
