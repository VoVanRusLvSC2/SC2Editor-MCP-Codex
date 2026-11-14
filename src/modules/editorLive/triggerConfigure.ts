import * as z from "zod/v4";
import {
  triggerParametersSchema,
  triggerSetIntegerSchema,
  triggerSetRealSchema,
  triggerSetUnitSchema,
  triggerSetPointSchema,
} from "./triggers.js";
import type { LiveTriggers } from "./triggers.js";
import { triggerNestedFields } from "./triggerPaths.js";

export const triggerConfigureSchema = triggerParametersSchema
  .omit({ offset: true, limit: true })
  .extend({
    edits: z.string().min(1).max(2048),
  })
  .strict();
type Kind = "integer" | "real" | "unit" | "point";
type Edit = { kind: Kind; name: string; value: string | number };
type TriggerMethods = Pick<
  LiveTriggers,
  "parameters" | "setInteger" | "setReal" | "setUnit" | "setPoint"
>;

/** Parse all edits and reuse native setter schemas before touching the editor. */
export function parseTriggerEdits(
  text: string,
  target: z.infer<typeof triggerConfigureSchema>,
): Edit[] {
  const items = text.split(";");
  if (items.length < 1 || items.length > 8) throw Error("LIVE_TRIGGER_CONFIGURE_EDIT_BOUND");
  const names = new Set<string>();
  return items.map((item) => {
    const match = item.trim().match(/^(integer|real|unit|point):([^:=;]+)=(.+)$/);
    if (!match) throw Error("LIVE_TRIGGER_CONFIGURE_SYNTAX");
    const kind = match[1] as Kind,
      name = match[2].trim(),
      raw = match[3].trim();
    if (!name || name.length > 100 || /[\r\n]/.test(name) || names.has(name))
      throw Error("LIVE_TRIGGER_CONFIGURE_PARAMETER_NAME");
    names.add(name);
    const base = { ...target, parameterIndex: 1, expectedParameterHash: "1" };
    delete (base as { edits?: string }).edits;
    if (kind === "integer" || kind === "real") {
      if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw Error("LIVE_TRIGGER_CONFIGURE_NUMBER");
      const value = Number(raw);
      (kind === "integer" ? triggerSetIntegerSchema : triggerSetRealSchema).parse({
        ...base,
        value,
      });
      return { kind, name, value };
    }
    (kind === "unit" ? triggerSetUnitSchema : triggerSetPointSchema).parse({
      ...base,
      ...(kind === "unit" ? { unitName: raw } : { pointName: raw }),
    });
    return { kind, name, value: raw };
  });
}

/** Configure existing literal leaves in the selected native parameter container without repeating an uncertain mutation. */
export async function configureTrigger(
  triggers: TriggerMethods,
  input: z.input<typeof triggerConfigureSchema>,
) {
  const args = triggerConfigureSchema.parse(input),
    edits = parseTriggerEdits(args.edits, args);
  const target = {
    archive: args.archive,
    windowId: args.windowId,
    path: args.path,
    section: args.section,
    itemIndex: args.itemIndex,
    expectedDetailHash: args.expectedDetailHash,
    ...triggerNestedFields(args),
  };
  const completed: Array<{ parameter: string; kind: Kind }> = [];
  let phase = "inspect",
    detailHash = args.expectedDetailHash,
    parameterHash = "",
    root = "",
    total = -1,
    offset = 0;
  const matches = new Map<string, number[]>();
  try {
    // Finish discovery and reject ambiguous names before the first setter runs.
    do {
      const page = await triggers.parameters({ ...target, offset, limit: 32 });
      if (
        (parameterHash && page.parameterFingerprint !== parameterHash) ||
        (root && page.parameterRoot !== root) ||
        (total >= 0 && page.totalParameters !== total)
      )
        throw Error("LIVE_TRIGGER_PARAMETER_CHANGED");
      parameterHash = page.parameterFingerprint;
      root = page.parameterRoot;
      total = page.totalParameters;
      for (const parameter of page.parameters) {
        const colon = parameter.text.indexOf(":");
        if (colon < 0) continue;
        const name = parameter.text.slice(0, colon);
        const indexes = matches.get(name) ?? [];
        indexes.push(parameter.index);
        matches.set(name, indexes);
      }
      if (page.nextOffset !== null && page.nextOffset <= offset)
        throw Error("LIVE_TRIGGER_PARAMETER_PAGE_INVALID");
      offset = page.nextOffset ?? total;
    } while (offset < total);
    for (const edit of edits)
      if (matches.get(edit.name)?.length !== 1)
        throw Error("LIVE_TRIGGER_CONFIGURE_PARAMETER_NOT_UNIQUE");
    for (const edit of edits) {
      phase = "configure";
      const next = {
        ...target,
        expectedDetailHash: detailHash,
        expectedParameterHash: parameterHash,
        parameterIndex: matches.get(edit.name)![0],
      };
      const outcome =
        edit.kind === "integer"
          ? await triggers.setInteger({ ...next, value: edit.value as number })
          : edit.kind === "real"
            ? await triggers.setReal({ ...next, value: edit.value as number })
            : edit.kind === "unit"
              ? await triggers.setUnit({ ...next, unitName: edit.value as string })
              : await triggers.setPoint({ ...next, pointName: edit.value as string });
      if (
        outcome.status !== "applied" ||
        !outcome.parameterVerified ||
        !("detailFingerprint" in outcome) ||
        typeof outcome.detailFingerprint !== "string" ||
        !("parameterFingerprint" in outcome) ||
        typeof outcome.parameterFingerprint !== "string"
      )
        return {
          status: outcome.status === "unknown" ? "unknown" : "partial",
          phase,
          completed,
          result: outcome,
          retryMutation: false,
          saved: false,
          recovery:
            "Inspect the current item and its native dialog before continuing; do not replay the batch.",
        };
      completed.push({ parameter: edit.name, kind: edit.kind });
      // Each successful setter changes the snapshot. Chain its returned hashes
      // so the next edit detects any intervening manual change.
      detailHash = outcome.detailFingerprint;
      parameterHash = outcome.parameterFingerprint;
    }
    return {
      status: completed.length === total ? "applied" : "needs_parameters",
      phase,
      completed,
      remainingParameters: Math.max(0, total - completed.length),
      detailFingerprint: detailHash,
      parameterFingerprint: parameterHash,
      retryMutation: false,
      saved: false,
      copiesCreated: 0,
      reopensMap: false,
      ...(completed.length !== total
        ? { recovery: "Inspect and configure remaining parameters before saving." }
        : {}),
    };
  } catch (error) {
    return {
      status: phase === "configure" ? "unknown" : "stopped",
      phase,
      completed,
      error: String(error),
      retryMutation: false,
      saved: false,
      recovery: "Inspect the current item before continuing; do not replay uncertain changes.",
    };
  }
}
