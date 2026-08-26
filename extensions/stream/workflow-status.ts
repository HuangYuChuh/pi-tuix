import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export type WorkflowPhase = "READY" | "WORKING" | "DONE" | "ERROR";

export interface WorkflowRuntime {
  phase: WorkflowPhase;
  currentTool: string | undefined;
  completedTools: number;
  failedTools: number;
  queuedMessages: number;
  requestRender?: () => void;
}

function redraw(runtime: WorkflowRuntime): void {
  runtime.requestRender?.();
}

export function createWorkflowRuntime(): WorkflowRuntime {
  return { phase: "READY", currentTool: undefined, completedTools: 0, failedTools: 0, queuedMessages: 0 };
}

export function beginAgentRun(runtime: WorkflowRuntime): void {
  runtime.phase = "WORKING";
  runtime.currentTool = undefined;
  runtime.completedTools = 0;
  runtime.failedTools = 0;
  if (runtime.queuedMessages > 0) runtime.queuedMessages -= 1;
  redraw(runtime);
}

export function queueMessage(runtime: WorkflowRuntime): void {
  runtime.queuedMessages += 1;
  redraw(runtime);
}

export function startTool(runtime: WorkflowRuntime, toolName: string): void {
  runtime.phase = "WORKING";
  runtime.currentTool = toolName;
  redraw(runtime);
}

export function finishTool(runtime: WorkflowRuntime, isError: boolean): void {
  runtime.completedTools += 1;
  if (isError) runtime.failedTools += 1;
  runtime.currentTool = undefined;
  redraw(runtime);
}

export function finishAgentRun(runtime: WorkflowRuntime): void {
  runtime.phase = runtime.failedTools > 0 ? "ERROR" : "DONE";
  runtime.currentTool = undefined;
  redraw(runtime);
}

export function settleAgent(runtime: WorkflowRuntime): void {
  finishAgentRun(runtime);
};

function phaseText(theme: Theme, phase: WorkflowPhase): string {
  if (phase === "WORKING") return theme.fg("accent", "WORKING");
  if (phase === "ERROR") return theme.fg("error", "ERROR");
  if (phase === "DONE") return theme.fg("success", "DONE");
  return theme.fg("dim", "READY");
}

export function formatWorkflowStatus(runtime: WorkflowRuntime, theme: Theme, width = 120): string {
  const tool = runtime.currentTool ? ` ${runtime.currentTool}` : "";
  const queue = runtime.queuedMessages > 0 ? ` | QUEUED ${runtime.queuedMessages}` : "";
  const failed = runtime.failedTools > 0 ? ` | FAILED ${runtime.failedTools}` : "";
  return truncateToWidth(`${phaseText(theme, runtime.phase)}${tool} | TOOLS ${runtime.completedTools}${failed}${queue}`, Math.max(1, width));
}
