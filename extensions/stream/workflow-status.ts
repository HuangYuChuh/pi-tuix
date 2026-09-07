import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export type WorkflowPhase = "READY" | "WORKING" | "DONE" | "ERROR";
export type WorkflowActivity = "IDLE" | "WORKING" | "THINKING" | "RESPONDING" | "TOOL";

export interface WorkflowRuntime {
  phase: WorkflowPhase;
  activity: WorkflowActivity;
  turn: number;
  currentTool: string | undefined;
  activeTools: Map<string, string>;
  finishedToolIds: Set<string>;
  completedTools: number;
  failedTools: number;
  queuedMessages: number;
  requestRender?: () => void;
}

function redraw(runtime: WorkflowRuntime): void {
  runtime.requestRender?.();
}

export function refreshWorkflow(runtime: WorkflowRuntime): void {
  redraw(runtime);
}

export function createWorkflowRuntime(): WorkflowRuntime {
  return {
    phase: "READY",
    activity: "IDLE",
    turn: 0,
    currentTool: undefined,
    activeTools: new Map(),
    finishedToolIds: new Set(),
    completedTools: 0,
    failedTools: 0,
    queuedMessages: 0,
  };
}

export function beginAgentRun(runtime: WorkflowRuntime): void {
  runtime.phase = "WORKING";
  runtime.activity = "WORKING";
  runtime.turn = 0;
  runtime.currentTool = undefined;
  runtime.activeTools.clear();
  runtime.finishedToolIds.clear();
  runtime.completedTools = 0;
  runtime.failedTools = 0;
  if (runtime.queuedMessages > 0) runtime.queuedMessages -= 1;
  redraw(runtime);
}

export function startTurn(runtime: WorkflowRuntime, turnIndex: number): void {
  runtime.turn = turnIndex + 1;
  runtime.activity = runtime.activeTools.size ? "TOOL" : "WORKING";
  redraw(runtime);
}

export function setStreamActivity(runtime: WorkflowRuntime, activity: WorkflowActivity): void {
  if (runtime.phase !== "WORKING") return;
  runtime.activity = runtime.activeTools.size ? "TOOL" : activity;
  redraw(runtime);
}

export function queueMessage(runtime: WorkflowRuntime): void {
  runtime.queuedMessages += 1;
  redraw(runtime);
}

export function startTool(runtime: WorkflowRuntime, toolCallId: string, toolName: string): void {
  if (runtime.finishedToolIds.has(toolCallId)) return;
  runtime.activeTools.set(toolCallId, toolName);
  runtime.phase = "WORKING";
  runtime.activity = "TOOL";
  runtime.currentTool = toolName;
  redraw(runtime);
}

export function finishTool(runtime: WorkflowRuntime, toolCallId: string, isError: boolean): void {
  if (!runtime.activeTools.delete(toolCallId)) return;
  runtime.finishedToolIds.add(toolCallId);
  runtime.completedTools += 1;
  if (isError) runtime.failedTools += 1;
  runtime.currentTool = [...runtime.activeTools.values()].at(-1);
  runtime.activity = runtime.activeTools.size ? "TOOL" : "WORKING";
  redraw(runtime);
}

export function finishAgentRun(runtime: WorkflowRuntime): void {
  runtime.phase = runtime.failedTools > 0 ? "ERROR" : "DONE";
  runtime.activity = "IDLE";
  runtime.currentTool = undefined;
  runtime.activeTools.clear();
  redraw(runtime);
}

export function workflowWorkingLabel(runtime: WorkflowRuntime): string {
  if (runtime.activeTools.size > 1) return `Running ${runtime.activeTools.size} tools`;
  if (runtime.currentTool) return `Running ${runtime.currentTool}`;
  if (runtime.activity === "THINKING") return "Thinking";
  if (runtime.activity === "RESPONDING") return "Responding";
  return "Working";
}

export function settleAgent(runtime: WorkflowRuntime): void {
  runtime.queuedMessages = 0;
  finishAgentRun(runtime);
}

function phaseText(theme: Theme, phase: WorkflowPhase): string {
  if (phase === "WORKING") return theme.fg("accent", "WORKING");
  if (phase === "ERROR") return theme.fg("error", "ERROR");
  if (phase === "DONE") return theme.fg("success", "DONE");
  return theme.fg("dim", "READY");
}

export function formatWorkflowStatus(runtime: WorkflowRuntime, theme: Theme, width = 120): string {
  const tool =
    runtime.activeTools.size > 1
      ? ` (${runtime.activeTools.size} active)`
      : runtime.currentTool
        ? ` ${runtime.currentTool}`
        : "";
  const activity = runtime.phase === "WORKING" ? ` | ${runtime.activity}${tool}` : tool;
  const turn = runtime.turn > 0 ? ` | TURN ${runtime.turn}` : "";
  const queue = runtime.queuedMessages > 0 ? ` | QUEUED ${runtime.queuedMessages}` : "";
  const failed = runtime.failedTools > 0 ? ` | FAILED ${runtime.failedTools}` : "";
  return truncateToWidth(
    `${phaseText(theme, runtime.phase)}${activity}${turn} | TOOLS ${runtime.completedTools}${failed}${queue}`,
    Math.max(0, width),
  );
}

export function formatContextPressure(percent: number | null, theme: Theme): string {
  if (percent === null) return theme.fg("dim", "ctx ?");
  const rounded = Math.round(percent);
  if (rounded >= 95) return theme.fg("error", `ctx ${rounded}% CRITICAL`);
  if (rounded >= 80) return theme.fg("warning", `ctx ${rounded}% HIGH`);
  return theme.fg("muted", `ctx ${rounded}%`);
}
