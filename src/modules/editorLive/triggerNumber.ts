import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import type { MemoryDesktop } from "./memoryDesktop.js";
import type { EditorWindow } from "./desktop.js";

export interface NumberDialogRequest {
  desktop: MemoryDesktop;
  window: EditorWindow;
  triggerHandle: string;
  itemHandle: string;
  parameterHandle: string;
  leftHash: string;
  detailHash: string;
  parameterHash: string;
  field: "seconds" | "real" | "integer";
  value: number;
  guardArchive: () => Promise<void>;
  pause: (ms: number) => Promise<void>;
}

/** Open and submit one literal numeric parameter. Never replay an uncertain commit. */
export async function editLiteralNumber(c: NumberDialogRequest) {
  let committed = false,
    opened = false;
  const token = randomUUID();
  const readDialog = async () =>
    z
      .object({
        title: z.enum(["Real", "Integer"]),
        fingerprint: z.string(),
        initial: z.string(),
        manualInput: z.boolean(),
      })
      .parse(await c.desktop.command(c.window, 52, { token }));
  try {
    z.object({ selectionRequested: z.literal(true) }).parse(
      await c.desktop.command(c.window, 55, {
        unit: "468",
        field: c.parameterHandle,
        expected: c.parameterHash,
      }),
    );
    await c.guardArchive();
    z.object({ status: z.literal("pending") }).parse(
      await c.desktop.command(c.window, 51, {
        unit: randomUUID(),
        field: "trigger.real",
        token,
        expected: `${c.leftHash}:${c.detailHash}:${c.parameterHash}`,
        value: `${c.triggerHandle}:${c.itemHandle}:${c.parameterHandle}`,
      }),
    );
    opened = true;
    let dialog: Awaited<ReturnType<typeof readDialog>> | undefined;
    for (let i = 0; i < 100; i++) {
      try {
        dialog = await readDialog();
        break;
      } catch (error) {
        if (!String(error).includes("DIALOG_NOT_READY")) throw error;
      }
      await c.pause(100);
    }
    if (!dialog || dialog.manualInput || dialog.fingerprint !== dialog.initial)
      throw Error("LIVE_TRIGGER_REAL_DIALOG_CHANGED");
    const expectedTitle = c.field === "integer" ? "Integer" : "Real";
    if (dialog.title !== expectedTitle) throw Error("LIVE_TRIGGER_PARAMETER_TYPE_MISMATCH");
    z.object({ optionsSet: z.literal(true) }).parse(
      await c.desktop.command(c.window, 59, {
        token,
        expected: dialog.fingerprint,
        field: c.field,
        value: String(c.value),
      }),
    );
    dialog = await readDialog();
    if (
      dialog.title !== expectedTitle ||
      dialog.manualInput ||
      dialog.fingerprint !== dialog.initial
    )
      throw Error("LIVE_TRIGGER_REAL_DIALOG_CHANGED");
    await c.guardArchive();
    committed = true;
    z.object({ submitted: z.literal(true) }).parse(
      await c.desktop.command(c.window, 58, {
        token,
        expected: dialog.fingerprint,
        field: c.field,
        value: String(c.value),
      }),
    );
    let current: EditorWindow | undefined;
    for (let i = 0; i < 100; i++) {
      current = c.desktop.window
        ? await c.desktop.window(c.window.windowId)
        : (await c.desktop.windows()).find((w) => w.windowId === c.window.windowId);
      if (
        !current ||
        current.processId !== c.window.processId ||
        current.processStart !== c.window.processStart
      )
        throw Error("LIVE_TRIGGER_WINDOW_CHANGED");
      if (current.enabled) break;
      await c.pause(100);
    }
    if (!current?.enabled) throw Error("LIVE_TRIGGER_REAL_COMPLETION_UNKNOWN");
    return { status: "submitted" as const, window: current };
  } catch (error) {
    if (opened && !committed) {
      try {
        const dialog = await readDialog();
        if (!dialog.manualInput && dialog.fingerprint === dialog.initial)
          await c.desktop.command(c.window, 54, { token, expected: dialog.fingerprint });
      } catch {
        /* Preserve unrecognised or manually changed dialogs. */
      }
    }
    return {
      status: committed ? ("unknown" as const) : ("stopped" as const),
      error: String(error),
      retryMutation: false,
    };
  }
}
