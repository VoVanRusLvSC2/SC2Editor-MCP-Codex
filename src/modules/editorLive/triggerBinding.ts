import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import type { MemoryDesktop } from "./memoryDesktop.js";
import type { EditorWindow } from "./desktop.js";

export interface BindingRequest {
  desktop: MemoryDesktop;
  window: EditorWindow;
  triggerHandle: string;
  itemHandle: string;
  parameterHandle: string;
  leftHash: string;
  detailHash: string;
  parameterHash: string;
  source: "variable" | "function" | "preset" | "value";
  name?: string;
  origin?: string;
  value?: number;
  type?: string;
  listOnly?: boolean;
  offset?: number;
  guardArchive: () => Promise<void>;
  pause: (ms: number) => Promise<void>;
}
const dialogSchema = z.object({
  title: z.string(),
  fingerprint: z.string(),
  initial: z.string(),
  manualInput: z.boolean(),
  controls: z
    .array(z.object({ id: z.number(), type: z.string(), text: z.string(), enabled: z.boolean() }))
    .optional(),
});

/** Original source/type chooser; changes remain uncommitted until the last native OK. */
export async function editParameterBinding(c: BindingRequest) {
  const token = randomUUID();
  let opened = false,
    committed = false;
  const read = async () => dialogSchema.parse(await c.desktop.command(c.window, 52, { token }));
  const check = (dialog: z.infer<typeof dialogSchema>) => {
    if (dialog.manualInput || dialog.fingerprint !== dialog.initial)
      throw Error("LIVE_TRIGGER_BINDING_DIALOG_CHANGED");
    return dialog;
  };
  try {
    await c.guardArchive();
    z.object({ selectionRequested: z.literal(true) }).parse(
      await c.desktop.command(c.window, 55, {
        unit: "468",
        field: c.parameterHandle,
        expected: c.parameterHash,
      }),
    );
    z.object({ status: z.literal("pending") }).parse(
      await c.desktop.command(c.window, 51, {
        unit: randomUUID(),
        field: "trigger.choice",
        token,
        expected: [c.leftHash, c.detailHash, c.parameterHash].join(":"),
        value: [c.triggerHandle, c.itemHandle, c.parameterHandle].join(":"),
      }),
    );
    opened = true;
    let dialog: z.infer<typeof dialogSchema> | undefined;
    for (let i = 0; i < 50; i++) {
      try {
        dialog = check(await read());
        break;
      } catch (error) {
        if (!String(error).includes("DIALOG_NOT_READY")) throw error;
      }
      await c.pause(100);
    }
    if (!dialog) throw Error("LIVE_TRIGGER_BINDING_DIALOG_NOT_READY");
    const set = async (field: string, value: string, unit?: string) => {
      const result = z
        .object({
          optionsSet: z.literal(true),
          name: z.string().optional(),
          origin: z.string().optional(),
        })
        .parse(
          await c.desktop.command(c.window, 59, {
            token,
            expected: dialog!.fingerprint,
            field,
            value,
            ...(unit ? { unit } : {}),
          }),
        );
      dialog = check(await read());
      return result;
    };
    if (c.type) await set("type", c.type);
    await set("source", c.source);
    const nativeType = dialog.controls?.find((x) => x.id === 15 && x.type === "ComboBox")?.text;
    if (c.listOnly) {
      if (c.source === "value") throw Error("LIVE_TRIGGER_BINDING_CATALOG_SOURCE_REQUIRED");
      const choices = z
        .object({
          total: z.number().int().nonnegative(),
          items: z.array(z.object({ name: z.string(), category: z.string(), origin: z.string() })),
        })
        .parse(
          await c.desktop.command(c.window, 59, {
            token,
            expected: dialog.fingerprint,
            field: "choices",
            value: c.source,
            unit: String(c.offset ?? 0),
          }),
        );
      await c.desktop.command(c.window, 54, { token, expected: dialog.fingerprint });
      opened = false;
      const offset = c.offset ?? 0;
      return {
        status: "inspected" as const,
        nativeType,
        ...choices,
        offset,
        nextOffset:
          offset + choices.items.length < choices.total ? offset + choices.items.length : null,
        mapMutation: false,
      };
    }
    const field = c.source === "value" ? "binding_value" : c.source;
    const value = c.source === "value" ? String(c.value) : c.name!;
    const selection = await set(field, value, c.origin);
    await c.guardArchive();
    committed = true;
    z.object({ submitted: z.literal(true) }).parse(
      await c.desktop.command(c.window, 58, {
        token,
        expected: dialog.fingerprint,
        field,
        value,
        ...(c.origin ? { unit: c.origin } : {}),
      }),
    );
    let current: EditorWindow | undefined;
    for (let i = 0; i < 50; i++) {
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
    if (!current?.enabled) throw Error("LIVE_TRIGGER_BINDING_COMPLETION_UNKNOWN");
    return {
      status: "submitted" as const,
      window: current,
      nativeType,
      selectedName: selection.name,
      selectedOrigin: selection.origin,
    };
  } catch (error) {
    if (opened && !committed)
      try {
        const dialog = check(await read());
        await c.desktop.command(c.window, 54, { token, expected: dialog.fingerprint });
      } catch {
        /* Preserve a manually edited or unrecognised native dialog. */
      }
    return {
      status: committed ? ("unknown" as const) : ("stopped" as const),
      error: String(error),
      retryMutation: false,
    };
  }
}
