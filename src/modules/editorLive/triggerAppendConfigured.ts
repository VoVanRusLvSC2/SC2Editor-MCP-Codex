import * as z from "zod/v4";
import {
  triggerTargetSchema,
  triggerRenameSchema,
  triggerAppendActionSchema,
  triggerAppendEventSchema,
} from "./triggers.js";
import type { LiveTriggers } from "./triggers.js";
import { configureTrigger, parseTriggerEdits, triggerConfigureSchema } from "./triggerConfigure.js";
import { triggerChildPath, triggerNestedFields } from "./triggerPaths.js";

export const triggerAppendConfiguredSchema = triggerTargetSchema
  .extend({
    path: triggerRenameSchema.shape.path,
    kind: z.enum(["action", "event"]),
    groupPath: triggerChildPath.optional(),
    expectedDetailHash: z.string().regex(/^\d+$/).optional(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((name) => name.toLowerCase() !== "custom script"),
    category: z.string().trim().max(100).optional(),
    edits: z.string().min(1).max(2048),
  })
  .strict()
  .superRefine((args, ctx) => {
    if (args.groupPath?.length && (args.kind !== "action" || !args.expectedDetailHash))
      ctx.addIssue({
        code: "custom",
        message: "Nested insertion requires kind=action and expectedDetailHash",
      });
  });
type Methods = Pick<
  LiveTriggers,
  "appendAction" | "appendEvent" | "parameters" | "setInteger" | "setReal" | "setUnit" | "setPoint"
>;

/** Append once and configure the resulting native item; partial outcomes are not replayable. */
export async function appendConfiguredTrigger(
  triggers: Methods,
  input: z.input<typeof triggerAppendConfiguredSchema>,
) {
  const args = triggerAppendConfiguredSchema.parse(input);
  const target = {
    archive: args.archive,
    windowId: args.windowId,
    path: args.path,
    ...triggerNestedFields(args),
  };
  // Validate the entire request before inserting anything, including all literal types.
  const placeholder = triggerConfigureSchema.parse({
    ...target,
    section: args.kind === "action" ? "actions" : "events",
    itemIndex: 1,
    expectedDetailHash: "1",
    edits: args.edits,
  });
  parseTriggerEdits(args.edits, placeholder);
  if (args.kind === "action")
    triggerAppendActionSchema.parse({
      ...target,
      action: "builtin_default",
      expectedDetailHash: args.expectedDetailHash,
      actionName: args.name,
      category: args.category,
      useDefaults: true,
    });
  else
    triggerAppendEventSchema.parse({
      ...target,
      eventName: args.name,
      category: args.category,
      useDefaults: true,
    });
  const inserted =
    args.kind === "action"
      ? await triggers.appendAction({
          ...target,
          action: "builtin_default",
          expectedDetailHash: args.expectedDetailHash,
          actionName: args.name,
          category: args.category,
          useDefaults: true,
        })
      : await triggers.appendEvent({
          ...target,
          eventName: args.name,
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
    ...triggerNestedFields(args),
    itemIndex: inserted.itemIndex,
    ...(args.kind === "action" ? { createdAction: true } : { createdEvent: true }),
    copiesCreated: 0,
    reopensMap: false,
    saved: false,
    retryMutation: false,
  };
  try {
    const result = await configureTrigger(triggers, {
      ...target,
      section: args.kind === "action" ? "actions" : "events",
      itemIndex: inserted.itemIndex,
      expectedDetailHash: inserted.detailFingerprint,
      edits: args.edits,
    });
    return {
      ...receipt,
      ...result,
      status: result.status === "stopped" ? "partial" : result.status,
      ...(result.status === "stopped" || result.status === "partial" || result.status === "unknown"
        ? {
            recovery:
              "The item was inserted. Inspect its parameters and native dialog; do not append it again.",
          }
        : {}),
    };
  } catch (error) {
    return {
      ...receipt,
      status: "unknown",
      error: String(error),
      recovery:
        "The item was inserted. Inspect its parameters and native dialog; do not append it again.",
    };
  }
}
