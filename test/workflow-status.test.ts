import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  beginAgentRun,
  createWorkflowRuntime,
  finishAgentRun,
  finishTool,
  formatContextPressure,
  formatWorkflowStatus,
  queueMessage,
  setStreamActivity,
  settleAgent,
  startTool,
  startTurn,
} from "../extensions/stream/workflow-status.ts";

// biome-ignore lint/suspicious/noExplicitAny: Test mock type
const theme = { fg: (_color: string, text: string) => text } as any;

test("workflow runtime tracks a run and failed tools", () => {
  const runtime = createWorkflowRuntime();
  let renders = 0;
  runtime.requestRender = () => {
    renders += 1;
  };
  queueMessage(runtime);
  beginAgentRun(runtime);
  startTool(runtime, "Bash");
  finishTool(runtime, true);
  finishAgentRun(runtime);

  assert.equal(runtime.phase, "ERROR");
  assert.equal(runtime.completedTools, 1);
  assert.equal(runtime.failedTools, 1);
  assert.equal(runtime.queuedMessages, 0);
  assert.ok(renders >= 4);
  assert.match(
    stripTerminalSequences(formatWorkflowStatus(runtime, theme)),
    /ERROR.*TOOLS 1.*FAILED 1/,
  );
});

test("workflow status exposes current tool and queue within a narrow width", () => {
  const runtime = createWorkflowRuntime();
  beginAgentRun(runtime);
  startTool(runtime, "Bash");
  queueMessage(runtime);
  const status = formatWorkflowStatus(runtime, theme, 28);
  assert.ok(visibleWidth(status) <= 28);
  assert.match(stripTerminalSequences(status), /WORKING/);
});

test("settled agent clears stale follow-up count", () => {
  const runtime = createWorkflowRuntime();
  queueMessage(runtime);
  settleAgent(runtime);
  assert.equal(runtime.queuedMessages, 0);
  assert.equal(runtime.phase, "DONE");
});

test("workflow status distinguishes thinking and responding by turn", () => {
  const runtime = createWorkflowRuntime();
  beginAgentRun(runtime);
  startTurn(runtime, 1);
  setStreamActivity(runtime, "THINKING");
  assert.match(stripTerminalSequences(formatWorkflowStatus(runtime, theme)), /THINKING.*TURN 2/);
  setStreamActivity(runtime, "RESPONDING");
  assert.match(stripTerminalSequences(formatWorkflowStatus(runtime, theme)), /RESPONDING.*TURN 2/);
});

test("context pressure adds explicit high and critical labels", () => {
  assert.equal(stripTerminalSequences(formatContextPressure(79, theme)), "ctx 79%");
  assert.equal(stripTerminalSequences(formatContextPressure(80, theme)), "ctx 80% HIGH");
  assert.equal(stripTerminalSequences(formatContextPressure(95, theme)), "ctx 95% CRITICAL");
});
