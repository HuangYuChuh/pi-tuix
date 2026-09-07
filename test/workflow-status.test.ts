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
  workflowWorkingLabel,
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
  startTool(runtime, "bash-1", "Bash");
  finishTool(runtime, "bash-1", true);
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
  startTool(runtime, "bash-1", "Bash");
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

test("concurrent tools retain the active phase until every distinct call completes", () => {
  const runtime = createWorkflowRuntime();
  beginAgentRun(runtime);
  startTool(runtime, "read-1", "Read");
  startTool(runtime, "read-2", "Read");
  startTool(runtime, "bash-1", "Bash");
  assert.equal(workflowWorkingLabel(runtime), "Running 3 tools");
  setStreamActivity(runtime, "RESPONDING");
  assert.equal(runtime.activity, "TOOL");
  finishTool(runtime, "bash-1", true);
  assert.equal(workflowWorkingLabel(runtime), "Running 2 tools");
  assert.match(formatWorkflowStatus(runtime, theme), /TOOL \(2 active\)/);
  finishTool(runtime, "read-1", false);
  assert.equal(workflowWorkingLabel(runtime), "Running Read");
  assert.equal(runtime.activity, "TOOL");
  startTurn(runtime, 2);
  assert.equal(runtime.activity, "TOOL");
  finishTool(runtime, "read-2", false);
  assert.equal(workflowWorkingLabel(runtime), "Working");
  assert.equal(runtime.completedTools, 3);
  assert.equal(runtime.failedTools, 1);
  for (const width of [0, 1, 2, 12, 24, 40, 100]) {
    assert.ok(visibleWidth(formatWorkflowStatus(runtime, theme, width)) <= width);
  }
});

test("duplicate, unknown and cancelled-run tool completions cannot double count or clear active calls", () => {
  const runtime = createWorkflowRuntime();
  beginAgentRun(runtime);
  startTool(runtime, "first", "Read");
  startTool(runtime, "first", "Read");
  startTool(runtime, "second", "Read");
  finishTool(runtime, "first", false);
  finishTool(runtime, "first", true);
  finishTool(runtime, "unknown", true);
  startTool(runtime, "first", "Read");
  assert.equal(runtime.completedTools, 1);
  assert.equal(runtime.failedTools, 0);
  assert.deepEqual([...runtime.activeTools.keys()], ["second"]);
  finishAgentRun(runtime);
  finishTool(runtime, "second", true);
  assert.equal(runtime.completedTools, 1);
  assert.equal(runtime.activity, "IDLE");
  beginAgentRun(runtime);
  assert.equal(runtime.finishedToolIds.size, 0);
  assert.equal(runtime.completedTools, 0);
  startTool(runtime, "new", "Write");
  finishTool(runtime, "second", true);
  assert.equal(workflowWorkingLabel(runtime), "Running Write");
  settleAgent(runtime);
  assert.equal(runtime.activeTools.size, 0);
});
