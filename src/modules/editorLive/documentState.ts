import * as z from "zod/v4";
import { documentDirty, type EditorWindow } from "./desktop.js";
import type { MemoryDesktop } from "./memoryDesktop.js";
import { currentDocumentMatches } from "./documentIdentity.js";

const nativeState = z.object({
  documentDirty: z.boolean(),
  pendingXmlBuffers: z.number().int().nonnegative(),
  pendingInput: z.boolean(),
  dialogs: z.array(z.unknown()),
});
export interface DocumentState {
  documentDirty: boolean;
  pendingXmlBuffers: number;
  pendingInput: boolean;
  dialogPresent: boolean;
  needsSave: boolean;
  scope: "native_related_modules" | "adapter_related_captions";
}

/** One observation boundary for status, Save decisions and post-Save verification. */
export async function readDocumentState(
  desktop: MemoryDesktop,
  terrain: EditorWindow,
  archive: string,
): Promise<DocumentState> {
  if (desktop.documentState) {
    const value = nativeState.parse(await desktop.documentState(terrain));
    return {
      documentDirty: value.documentDirty,
      pendingXmlBuffers: value.pendingXmlBuffers,
      pendingInput: value.pendingInput,
      dialogPresent: !terrain.enabled || value.dialogs.length > 0,
      needsSave: value.documentDirty || value.pendingXmlBuffers > 0,
      scope: "native_related_modules",
    };
  }
  // In-process/non-Windows adapters expose their related frames instead.
  let dirty = documentDirty(terrain),
    dialog = !terrain.enabled;
  for (const frame of await desktop.windows()) {
    if (
      frame.processId !== terrain.processId ||
      frame.processStart !== terrain.processStart ||
      !frame.title.includes(" - [") ||
      !(await currentDocumentMatches(desktop, frame, archive))
    )
      continue;
    dirty ||= documentDirty(frame);
    dialog ||= !frame.enabled;
  }
  return {
    documentDirty: dirty,
    pendingXmlBuffers: 0,
    pendingInput: false,
    dialogPresent: dialog,
    needsSave: dirty,
    scope: "adapter_related_captions",
  };
}
