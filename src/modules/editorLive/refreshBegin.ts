import * as z from "zod/v4";
import { documentTargetSchema, type LiveDocument } from "./document.js";
import type { LiveRefresh } from "./refresh.js";

export const refreshBeginSchema = documentTargetSchema
  .extend({ mode: z.literal("same_file_refresh"), saveIfDirty: z.boolean().default(false) })
  .strict();

/** Compose existing Save and refresh boundaries; never replay an uncertain Save. */
export async function beginRefresh(
  document: Pick<LiveDocument, "status" | "save">,
  refresh: Pick<LiveRefresh, "prepare">,
  input: z.infer<typeof refreshBeginSchema>,
) {
  const args = refreshBeginSchema.parse(input),
    target = { archive: args.archive, windowId: args.windowId },
    before = await document.status(target);
  if (before.dialogPresent || before.pendingInput)
    return {
      status: "attention_required" as const,
      reason: before.dialogPresent ? "native_dialog_present" : "pending_inline_input",
      document: before,
      saveAttempted: false,
      editorChanged: false,
    };
  if (before.documentDirty && !args.saveIfDirty)
    return {
      status: "save_required" as const,
      document: before,
      saveAttempted: false,
      editorChanged: false,
    };
  let saved: Awaited<ReturnType<LiveDocument["save"]>> | undefined;
  let ready = before;
  if (before.documentDirty) {
    try {
      saved = await document.save({ ...target, expectedSha256: before.sha256 });
    } catch (error) {
      return {
        status: "save_unconfirmed" as const,
        error: String(error),
        saveAttempted: true,
        retryMutation: false,
        recovery: "Inspect the same document and native dialogs; never repeat Save automatically",
      };
    }
    if (!["saved", "already_clean"].includes(saved.status) || !("sha256" in saved))
      return {
        status: "save_unconfirmed" as const,
        save: saved,
        saveAttempted: true,
        retryMutation: false,
        recovery: "Inspect the same document and native dialogs; never repeat Save automatically",
      };
    if ("savedUiBufferError" in saved && saved.savedUiBufferError)
      return {
        status: "save_confirmed_prepare_blocked" as const,
        reason: "saved_ui_buffer_reconciliation_failed",
        save: saved,
        retryMutation: false,
      };
    try {
      ready = await document.status(target);
    } catch (error) {
      return {
        status: "save_confirmed_prepare_blocked" as const,
        save: saved,
        error: String(error),
        retryMutation: false,
      };
    }
    if (
      ready.processId !== before.processId ||
      ready.processStart !== before.processStart ||
      ready.windowId !== before.windowId ||
      ready.archive !== before.archive ||
      ready.sha256 !== saved.sha256 ||
      ready.documentDirty ||
      ready.dialogPresent ||
      ready.pendingInput
    )
      return {
        status: "save_confirmed_prepare_blocked" as const,
        save: saved,
        document: ready,
        reason: "document_changed_or_not_clean",
        retryMutation: false,
      };
  }
  try {
    const prepared = await refresh.prepare(
      { ...target, mode: args.mode },
      { processId: ready.processId, processStart: ready.processStart, sha256: ready.sha256 },
    );
    return {
      status: "prepared" as const,
      ...prepared,
      saveAttempted: !!saved,
      ...(saved && { save: saved }),
    };
  } catch (error) {
    return {
      status: "prepare_failed" as const,
      error: String(error),
      saveAttempted: !!saved,
      ...(saved && { save: saved }),
      retryMutation: false,
    };
  }
}
