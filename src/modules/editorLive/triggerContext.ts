import { currentDocumentMatches } from "./documentIdentity.js";
import type { EditorWindow } from "./desktop.js";
import type { MemoryDesktop } from "./memoryDesktop.js";
import { withEditorLease } from "./editorLease.js";

/** Bind a chat/module window to the same document's native Trigger Editor. */
export async function resolveTriggerContext(
  desktop: MemoryDesktop,
  target: { archive: string; windowId: string },
  pause: (ms: number) => Promise<void>,
) {
  return resolveEditorModuleContext(desktop, target, pause, "Triggers");
}
export async function resolveEditorModuleContext(
  desktop: MemoryDesktop,
  target: { archive: string; windowId: string },
  pause: (ms: number) => Promise<void>,
  module: "Triggers" | "Data",
) {
  let windows = await desktop.windows();
  const source = windows.find((w) => w.windowId === target.windowId);
  if (
    !source ||
    !/^(AI Assistant|Terrain|Data|Triggers|UI|Text|Import) - \[/.test(source.title) ||
    !(await currentDocumentMatches(desktop, source, target.archive))
  )
    throw Error("LIVE_TRIGGER_SOURCE_DOCUMENT_CHANGED");
  const sameProcess = (w: EditorWindow) =>
    w.processId === source.processId && w.processStart === source.processStart;
  const related = async (module: string) => {
    const found: EditorWindow[] = [];
    for (const w of windows)
      if (
        sameProcess(w) &&
        w.title.startsWith(module + " - [") &&
        (await currentDocumentMatches(desktop, w, target.archive))
      )
        found.push(w);
    if (found.length > 1) throw Error("LIVE_TRIGGER_MODULE_AMBIGUOUS");
    return found[0];
  };
  let trigger = await related(module);
  if (trigger) {
    if (!trigger.enabled) throw Error("LIVE_TRIGGER_USER_DIALOG_PRESENT");
    return trigger;
  }
  const terrain = await related("Terrain");
  if (!source.enabled || !terrain?.enabled)
    throw Error("LIVE_TRIGGER_USER_DIALOG_OR_TERRAIN_UNAVAILABLE");
  await withEditorLease(terrain, async () => {
    const current = desktop.window
      ? await desktop.window(terrain.windowId)
      : (await desktop.windows()).find((w) => w.windowId === terrain.windowId);
    if (
      !current?.enabled ||
      !sameProcess(current) ||
      !(await currentDocumentMatches(desktop, current, target.archive))
    )
      throw Error("LIVE_TRIGGER_SOURCE_DOCUMENT_CHANGED");
    const result = (await desktop.command(current, 31, { field: "module", unit: module })) as {
      moduleRequested?: string;
      error?: string;
    };
    if (result.error || result.moduleRequested !== module)
      throw Error(result.error ?? "LIVE_TRIGGER_MODULE_OPEN_UNCONFIRMED");
  });
  for (let i = 0; i < 50; i++) {
    windows = await desktop.windows();
    trigger = await related(module);
    if (trigger) {
      if (!trigger.enabled) throw Error("LIVE_TRIGGER_USER_DIALOG_PRESENT");
      return trigger;
    }
    await pause(100);
  }
  throw Error("LIVE_TRIGGER_MODULE_OPEN_UNCONFIRMED");
}
