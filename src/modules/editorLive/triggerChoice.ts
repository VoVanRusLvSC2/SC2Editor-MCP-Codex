import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import type { MemoryDesktop } from "./memoryDesktop.js";
import type { EditorWindow } from "./desktop.js";

export interface ChoiceDialogRequest {
  desktop: MemoryDesktop;
  window: EditorWindow;
  triggerHandle: string;
  itemHandle: string;
  parameterHandle: string;
  leftHash: string;
  detailHash: string;
  parameterHash: string;
  kind: "unit" | "point";
  name: string;
  guardArchive: () => Promise<void>;
  pause: (ms: number) => Promise<void>;
}

/** Select a unique displayed literal through the original Editor dialog. */
export async function editLiteralChoice(c: ChoiceDialogRequest) {
  let committed = false,
    opened = false;
  const token = randomUUID();
  const read = async () =>
    z
      .object({
        title: z.string(),
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
        field: "trigger.choice",
        token,
        expected: `${c.leftHash}:${c.detailHash}:${c.parameterHash}`,
        value: `${c.triggerHandle}:${c.itemHandle}:${c.parameterHandle}`,
      }),
    );
    opened = true;
    let dialog: Awaited<ReturnType<typeof read>> | undefined;
    for (let i = 0; i < 100; i++) {
      try {
        dialog = await read();
        break;
      } catch (error) {
        if (!String(error).includes("DIALOG_NOT_READY")) throw error;
      }
      await c.pause(100);
    }
    const check = () => {
      const expectedTitle = c.kind === "unit" ? "Game Link - Unit" : "Point";
      if (
        !dialog ||
        dialog.title !== expectedTitle ||
        dialog.manualInput ||
        dialog.fingerprint !== dialog.initial
      )
        throw Error("LIVE_TRIGGER_CHOICE_DIALOG_CHANGED");
    };
    check();
    if (c.kind === "unit") {
      z.object({ optionsSet: z.literal(true) }).parse(
        await c.desktop.command(c.window, 59, {
          token,
          expected: dialog!.fingerprint,
          field: "list",
        }),
      );
      dialog = await read();
      check();
    }
    z.object({ optionsSet: z.literal(true) }).parse(
      await c.desktop.command(c.window, 59, {
        token,
        expected: dialog!.fingerprint,
        field: c.kind,
        value: c.name,
      }),
    );
    dialog = await read();
    check();
    await c.guardArchive();
    committed = true;
    z.object({ submitted: z.literal(true) }).parse(
      await c.desktop.command(c.window, 58, {
        token,
        expected: dialog!.fingerprint,
        field: c.kind,
        value: c.name,
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
    if (!current?.enabled) throw Error("LIVE_TRIGGER_CHOICE_COMPLETION_UNKNOWN");
    return { status: "submitted" as const, window: current };
  } catch (error) {
    if (opened && !committed) {
      try {
        const dialog = await read();
        if (!dialog.manualInput && dialog.fingerprint === dialog.initial)
          await c.desktop.command(c.window, 54, { token, expected: dialog.fingerprint });
      } catch {
        /* Preserve unknown or manually edited dialogs. */
      }
    }
    return {
      status: committed ? ("unknown" as const) : ("stopped" as const),
      error: String(error),
      retryMutation: false,
    };
  }
}
