import type { LayoutOperation } from "../core/types.js";
import { Workspace } from "../core/workspace.js";

export interface CodexEfficiencyBenchmark {
  scenario: string;
  operations: number;
  legacyWorkflow: { toolCalls: number; sequence: string[] };
  transactionWorkflow: { toolCalls: number; sequence: string[] };
  reductionPercent: number;
  validationIncludedInApply: boolean;
  diffIncludedInApply: boolean;
}

export const BUTTON_WINDOW_OPERATIONS: LayoutOperation[] = [
  { op: "create_frame", as: "gameui", type: "Frame", name: "GameUI/UIContainer", frameFile: "GameUI" },
  { op: "create_frame", as: "window", parentPath: "@gameui", type: "Frame", name: "CodexWindow" },
  { op: "set_property", framePath: "@window", property: "Width", value: 480 },
  { op: "set_property", framePath: "@window", property: "Height", value: 240 },
  { op: "create_frame", as: "primary", parentPath: "@window", type: "Button", name: "Primary", template: "StandardTemplates/StandardButtonTemplate" },
  { op: "set_property", framePath: "@primary", property: "Text", value: "Primary" },
  { op: "create_frame", as: "secondary", parentPath: "@window", type: "Button", name: "Secondary", template: "StandardTemplates/StandardButtonTemplate" },
  { op: "set_property", framePath: "@secondary", property: "Text", value: "Secondary" },
  {
    op: "upsert_state_group",
    framePath: "@primary",
    stateGroup: {
      name: "EnabledState",
      defaultState: "Enabled",
      states: [
        { name: "Enabled", actions: [{ type: "SetProperty", frame: "$parent/Secondary", attrs: { Enabled: true } }] },
        { name: "Disabled", actions: [{ type: "SetProperty", frame: "$parent/Secondary", attrs: { Enabled: false } }] },
      ],
    },
  },
  {
    op: "upsert_animation",
    framePath: "@primary",
    animation: {
      name: "Show",
      controllers: [{
        type: "Fade",
        frame: "$this",
        keys: [{ type: "Curve", time: 0, attrs: { value: 0 } }, { type: "Curve", time: 0.2, attrs: { value: 1 } }],
      }],
    },
  },
];

export async function benchmarkCodexWorkflow(workspace: Workspace, file: string): Promise<CodexEfficiencyBenchmark> {
  const transaction = await workspace.apply(file, BUTTON_WINDOW_OPERATIONS, { dryRun: true, validate: true });
  const legacySequence = [
    "ui.query_frames",
    "ui.describe_type",
    ...BUTTON_WINDOW_OPERATIONS.map((operation) => `ui.${operation.op}`),
    "ui.validate",
    "ui.diff",
  ];
  const transactionSequence = ["ui.query_frames", "ui.describe_type", "ui.apply (validation + diff included)"];
  return {
    scenario: "window + two buttons + enabled state + fade animation",
    operations: BUTTON_WINDOW_OPERATIONS.length,
    legacyWorkflow: { toolCalls: legacySequence.length, sequence: legacySequence },
    transactionWorkflow: { toolCalls: transactionSequence.length, sequence: transactionSequence },
    reductionPercent: Math.round((1 - transactionSequence.length / legacySequence.length) * 1000) / 10,
    validationIncludedInApply: Boolean(transaction.validation),
    diffIncludedInApply: Boolean(transaction.mutation.preview),
  };
}
