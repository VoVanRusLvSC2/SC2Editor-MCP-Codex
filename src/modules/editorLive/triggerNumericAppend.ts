import * as z from "zod/v4";
import { triggerTargetSchema } from "./triggers.js";
import type { LiveTriggers } from "./triggers.js";

export const triggerNumericAppendSchema = triggerTargetSchema
  .extend({
    path: z.string().min(1).max(1024),
    kind: z.enum(["action", "event"]),
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((name) => name.toLowerCase() !== "custom script"),
    category: z.string().trim().max(100).optional(),
    parameter: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((name) => !/[\r\n:]/.test(name)),
    numberType: z.enum(["real", "integer"]),
    value: z.number().finite(),
  })
  .strict()
  .superRefine((args, ctx) => {
    const valid =
      args.numberType === "integer"
        ? Number.isInteger(args.value) && args.value >= -2147483648 && args.value <= 2147483647
        : args.value >= -3600 &&
          args.value <= 3600 &&
          Math.abs(args.value * 100 - Math.round(args.value * 100)) < 0.000001;
    if (!valid)
      ctx.addIssue({ code: "custom", message: "Invalid value for the specified numeric type" });
  });

type TriggerMethods = Pick<
  LiveTriggers,
  "appendAction" | "appendEvent" | "parameters" | "setReal" | "setInteger"
>;

/** Compose original-editor operations with guarded fingerprints; never re-insert after a partial result. */
export async function appendNumericTrigger(
  triggers: TriggerMethods,
  input: z.input<typeof triggerNumericAppendSchema>,
) {
  const args = triggerNumericAppendSchema.parse(input),
    target = {
      archive: args.archive,
      windowId: args.windowId,
      path: args.path,
    };
  const inserted =
    args.kind === "event"
      ? await triggers.appendEvent({
          ...target,
          eventName: args.name,
          category: args.category,
          useDefaults: true,
        })
      : await triggers.appendAction({
          ...target,
          action: "builtin_default",
          actionName: args.name,
          category: args.category,
          useDefaults: true,
        });
  if (
    inserted.status !== "needs_parameters" ||
    !("itemIndex" in inserted) ||
    typeof inserted.itemIndex !== "number" ||
    !("detailFingerprint" in inserted) ||
    typeof inserted.detailFingerprint !== "string"
  )
    return inserted;

  const receipt = {
    path: args.path,
    kind: args.kind,
    name: args.name,
    ...(args.kind === "action" ? { createdAction: true } : { createdEvent: true }),
    itemIndex: inserted.itemIndex,
    saved: false,
    copiesCreated: 0,
    reopensMap: false,
    retryMutation: false,
  };
  try {
    const selection = {
      ...target,
      section: args.kind === "action" ? ("actions" as const) : ("events" as const),
      itemIndex: inserted.itemIndex,
      expectedDetailHash: inserted.detailFingerprint,
    };
    let offset = 0,
      fingerprint = "",
      total = -1;
    const matches: number[] = [];
    do {
      const page = await triggers.parameters({ ...selection, offset, limit: 32 });
      if (
        page.parameterRoot !== args.name ||
        (fingerprint && page.parameterFingerprint !== fingerprint) ||
        (total >= 0 && page.totalParameters !== total)
      )
        throw Error("LIVE_TRIGGER_PARAMETER_CHANGED");
      fingerprint = page.parameterFingerprint;
      total = page.totalParameters;
      for (const param of page.parameters)
        if (param.text.startsWith(args.parameter + ":")) matches.push(param.index);
      if (page.nextOffset !== null && page.nextOffset <= offset)
        throw Error("LIVE_TRIGGER_PARAMETER_PAGE_INVALID");
      offset = page.nextOffset ?? total;
    } while (offset < total);
    if (matches.length !== 1) throw Error("LIVE_TRIGGER_NUMERIC_PARAMETER_NOT_UNIQUE");
    const change = {
      ...selection,
      parameterIndex: matches[0],
      expectedParameterHash: fingerprint,
      value: args.value,
    };
    const edited =
      args.numberType === "real"
        ? await triggers.setReal(change)
        : await triggers.setInteger(change);
    if (edited.status !== "applied" || !edited.parameterVerified)
      return {
        ...receipt,
        status: edited.status === "unknown" ? "unknown" : "partial",
        parameterVerified: false,
        parameterResult: edited,
        recovery:
          "The item was inserted. Inspect its parameter and native dialog; do not append it again.",
      };
    return {
      ...receipt,
      status: total === 1 ? "applied" : "needs_parameters",
      parameter: args.parameter,
      value: args.value,
      parameterVerified: true,
      parametersVerified: total === 1,
      remainingParameters: Math.max(0, total - 1),
      ...(total > 1
        ? {
            recovery:
              "Inspect the existing item and configure its remaining parameters before saving.",
          }
        : {}),
    };
  } catch (error) {
    return {
      ...receipt,
      status: "partial",
      parameterVerified: false,
      error: String(error),
      recovery:
        "The item was inserted. Inspect its parameters and native dialog; do not append it again.",
    };
  }
}
