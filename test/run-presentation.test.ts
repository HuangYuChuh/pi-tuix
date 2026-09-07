import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { RunPresentation, renderRunCompletion } from "../extensions/stream/run-presentation.ts";

const message = (timestamp: number, output: number, stopReason = "stop") => ({
  role: "assistant",
  provider: "fixture",
  model: "fixture",
  timestamp,
  usage: { output },
  stopReason,
});
const theme = {
  fg: (_token: string, text: string) => `\u001b[38;2;153;153;153m${text}\u001b[39m`,
} as Theme;

test("working feedback uses elapsed time and reported output counts without duplicating stream updates", () => {
  const run = new RunPresentation();
  assert.equal(run.workingMessage("Working...", 0), "Working...");
  run.begin(1000);
  assert.equal(run.workingMessage("Working...", 1200), "Working...");
  assert.equal(run.workingMessage("Thinking...", 7000), "Thinking... (6s)");
  run.observeMessage(message(1000, 8));
  run.observeMessage(message(1000, 12));
  run.observeMessage(message(1000, 12));
  run.observeMessage(message(3000, 23));
  run.observeMessage({ role: "user", timestamp: 4000, usage: { output: 999 } });
  run.observeMessage(message(5000, Number.NaN));
  run.observeMessage(message(6000, -1));
  assert.equal(run.workingMessage("Responding...", 7000), "Responding... (6s · ↓ 35 tokens)");
  assert.equal(
    run.workingMessage("Responding...", 7000, true),
    "Responding... (6s | out 35 tokens)",
  );
});

test("completion waits for settlement, retains retry duration and clears before a new request", () => {
  const run = new RunPresentation();
  const completion = () => run.completion;
  run.begin(1000);
  run.end([message(1000, 0, "error")], 2000);
  assert.equal(completion(), undefined);
  run.begin(4000);
  run.end([message(4000, 12)], 6000);
  run.settle(7000);
  assert.deepEqual(completion(), {
    durationMs: 5000,
    finishedAt: 6000,
    outcome: "done",
    failedTools: 0,
  });
  run.settle(8000);
  assert.equal(completion()?.finishedAt, 6000);
  run.begin(9000);
  assert.equal(completion(), undefined);
  assert.equal(run.workingMessage("Working...", 9001), "Working...");
  run.end([], 8990);
  run.settle(9100);
  assert.equal(completion()?.outcome, "stopped");
  assert.equal(completion()?.durationMs, 0);
  run.reset();
  run.settle();
  assert.equal(completion(), undefined);
});

test("failed and cancelled runs stay distinct from a successful response that recovered from a tool error", () => {
  for (const [reason, expected] of [
    ["error", "error"],
    ["aborted", "cancelled"],
    ["stop", "done"],
  ] as const) {
    const run = new RunPresentation();
    run.begin(0);
    run.observeTool("a", { content: [{ type: "text", text: "Operation cancelled" }] }, true);
    run.observeTool("a", { content: [{ type: "text", text: "Operation cancelled" }] }, true);
    run.end([message(0, 1, reason)], 3000);
    run.settle(3000);
    assert.equal(run.completion?.outcome, expected);
    assert.equal(run.completion?.failedTools, 1);
  }
  const run = new RunPresentation();
  run.begin(0);
  run.observeTool("a", { content: [{ type: "text", text: "Command aborted" }] }, true);
  run.end([message(0, 0, "toolUse")], 2000);
  run.settle(2000);
  assert.equal(run.completion?.outcome, "cancelled");
});

test("completion feedback has a clock, explicit outcomes and ANSI-aware narrow/ASCII layouts", () => {
  for (const outcome of ["done", "error", "cancelled", "stopped"] as const) {
    const completion = { durationMs: 65000, finishedAt: 1700000000000, outcome, failedTools: 2 };
    const text = stripTerminalSequences(renderRunCompletion(completion, theme, 120)[0]);
    if (outcome === "cancelled") {
      assert.match(text, /Interrupted.*What should Pi do instead/);
      assert.doesNotMatch(text, /Worked|done|tools failed/);
    } else {
      assert.match(text, /1m 5s/);
      assert.match(text, /\d+:\d{2} [AP]M/);
      assert.match(text, /2 tools failed/);
    }
    assert.match(
      text,
      new RegExp(
        { done: "Worked", error: "Failed", cancelled: "Interrupted", stopped: "Stopped" }[outcome],
      ),
    );
    const ascii = stripTerminalSequences(renderRunCompletion(completion, theme, 120, true)[0]);
    assert.ok([...ascii].every((char) => char.charCodeAt(0) <= 127));
    for (const width of [0, 1, 2, 4, 12, 40, 80, 120]) {
      assert.ok(
        renderRunCompletion(completion, theme, width).every((line) => visibleWidth(line) <= width),
      );
    }
  }
});

test("Pi's AbortError assistant message is presented as interruption rather than failure", () => {
  const run = new RunPresentation();
  run.begin(0);
  run.observeTool("a", { content: [{ type: "text", text: "Command aborted" }] }, true);
  run.end([{ ...message(0, 0, "error"), errorMessage: "This operation was aborted" }], 1500);
  run.settle(1600);
  assert.equal(run.completion?.outcome, "cancelled");
  assert.ok(run.completion);
  const lines = renderRunCompletion(run.completion, theme, 100).map(stripTerminalSequences);
  assert.match(lines[0], /Interrupted/);
  assert.doesNotMatch(lines[0], /Failed|Worked/);
});
