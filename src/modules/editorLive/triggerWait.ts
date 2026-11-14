import type { MemoryDesktop } from "./memoryDesktop.js";
import type { EditorWindow } from "./desktop.js";
import { editLiteralNumber } from "./triggerNumber.js";

export interface LiveTriggerTree {
  fingerprint: string;
  items: Array<{ handle: string; parent: string; depth: number; text: string }>;
}
interface WaitContext {
  desktop: MemoryDesktop;
  window: EditorWindow;
  triggerHandle: string;
  actionHandle: string;
  left: LiveTriggerTree;
  detail: LiveTriggerTree;
  seconds: number;
  tree: (window: EditorWindow, id: number) => Promise<LiveTriggerTree>;
  guardArchive: () => Promise<void>;
  pause: (ms: number) => Promise<void>;
}

/** Configure a literal Game Time duration through the original Real dialog. */
async function configureLiveDuration(c: WaitContext, kind: "wait" | "periodic") {
  const rootName = kind === "wait" ? "Wait" : "Periodic Event";
  const parameterName = kind === "wait" ? "Time" : "Duration";
  const valuePattern =
    kind === "wait"
      ? /^General\s*-\s*Wait\s+([0-9]+(?:\.[0-9]+)?)\s+Game Time seconds$/
      : /^Timer\s*-\s*Every\s+([0-9]+(?:\.[0-9]+)?)\s+seconds of Game Time$/;
  const parameterPattern = new RegExp(`^${parameterName}: (\\d+(?:\\.\\d+)?)$`);
  let submitted = false;
  try {
    let parameters: LiveTriggerTree | undefined;
    for (let i = 0; i < 30; i++) {
      try {
        parameters = await c.tree(c.window, 468);
      } catch (error) {
        if (!String(error).includes("TREE_UNREADABLE_OR_TOO_LARGE")) throw error;
      }
      if (parameters?.items.some((item) => item.parent === "0" && item.text === rootName)) break;
      await c.pause(100);
    }
    if (!parameters) throw Error("LIVE_TRIGGER_WAIT_PARAMETERS_UNAVAILABLE");
    const roots = parameters.items.filter((item) => item.parent === "0" && item.text === rootName);
    const times =
      roots.length === 1
        ? parameters.items.filter(
            (item) => item.parent === roots[0].handle && parameterPattern.test(item.text),
          )
        : [];
    const types =
      roots.length === 1
        ? parameters.items.filter(
            (item) => item.parent === roots[0].handle && item.text === "Time Type: Game Time",
          )
        : [];
    if (times.length !== 1 || types.length !== 1)
      throw Error("LIVE_TRIGGER_WAIT_PARAMETERS_UNAVAILABLE");
    const actionText = c.detail.items.find((item) => item.handle === c.actionHandle)?.text;
    const actionTime = actionText?.match(valuePattern),
      parameterTime = times[0].text.match(parameterPattern);
    if (
      !actionTime ||
      !parameterTime ||
      Math.abs(Number(actionTime[1]) - Number(parameterTime[1])) > 0.00001
    )
      throw Error("LIVE_TRIGGER_WAIT_PARAMETER_ACTION_MISMATCH");
    const edit = await editLiteralNumber({
      desktop: c.desktop,
      window: c.window,
      triggerHandle: c.triggerHandle,
      itemHandle: c.actionHandle,
      parameterHandle: times[0].handle,
      leftHash: c.left.fingerprint,
      detailHash: c.detail.fingerprint,
      parameterHash: parameters.fingerprint,
      field: "seconds",
      value: c.seconds,
      guardArchive: c.guardArchive,
      pause: c.pause,
    });
    if (edit.status !== "submitted") return { ...edit, parameterVerified: false };
    submitted = true;
    const detail = await c.tree(edit.window, 134),
      after = detail.items.find((item) => item.handle === c.actionHandle);
    const match = after?.text.match(valuePattern);
    const preserved =
      detail.items.length === c.detail.items.length &&
      c.detail.items.every((old) =>
        detail.items.some(
          (item) =>
            item.handle === old.handle &&
            item.parent === old.parent &&
            (item.handle === c.actionHandle || item.text === old.text),
        ),
      );
    if (!match || Math.abs(Number(match[1]) - c.seconds) > 0.00001 || !preserved)
      return {
        status: "verification_failed" as const,
        parameterVerified: false,
        retryMutation: false,
      };
    return { status: "applied" as const, parameterVerified: true, retryMutation: false };
  } catch (error) {
    return {
      status: submitted ? ("unknown" as const) : ("stopped" as const),
      error: String(error),
      parameterVerified: false,
      retryMutation: false,
    };
  }
}
export function configureLiveWait(c: WaitContext) {
  return configureLiveDuration(c, "wait");
}
export function configureLivePeriodic(c: WaitContext) {
  return configureLiveDuration(c, "periodic");
}
