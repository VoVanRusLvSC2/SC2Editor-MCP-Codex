import type { Workspace } from "../../core/workspace.js";

export interface LiveRuntime {
  workspace: Workspace;
  call(tool: string, args: Record<string, unknown>, context?: unknown): Promise<unknown>;
  export(archive: string): Promise<unknown>;
  close(): Promise<void>;
  authorData?(script: string, file: string): Promise<unknown>;
  authorUi?(script: string, file: string): Promise<unknown>;
  authorText?(script: string, locale: string): Promise<unknown>;
  author?(script: string): Promise<unknown>;
}
export type LiveRuntimeFactory = (root: string) => Promise<LiveRuntime>;
