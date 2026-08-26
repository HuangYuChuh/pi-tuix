import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { createPlanRuntime, extractPlan, PlanWidget, updatePlan } from "../extensions/control/plan.ts";

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as Theme;

test("extractPlan recognizes English and Chinese numbered plans", () => {
  assert.deepEqual(extractPlan("Plan:\n1. Inspect API\n2. Add tests"), [
    { text: "Inspect API", completed: false },
    { text: "Add tests", completed: false },
  ]);
  assert.deepEqual(extractPlan("\u8ba1\u5212\uff1a\n1. \u68c0\u67e5 API\n2. \u589e\u52a0\u6d4b\u8bd5"), [
    { text: "\u68c0\u67e5 API", completed: false },
    { text: "\u589e\u52a0\u6d4b\u8bd5", completed: false },
  ]);
});

test("plan updates completion tags without replacing existing steps", () => {
  const runtime = createPlanRuntime();
  updatePlan(runtime, { content: [{ type: "text", text: "Plan:\n1. Inspect API\n2. Add tests" }] });
  updatePlan(runtime, { content: [{ type: "text", text: "Finished inspection [DONE:1]" }] });
  assert.equal(runtime.items[0]?.completed, true);
  assert.equal(runtime.items[1]?.completed, false);
});

test("plan widget is width constrained and communicates completion without color", () => {
  const runtime = createPlanRuntime();
  runtime.items = [
    { text: "A completed step", completed: true },
    { text: "A very long pending step that needs terminal truncation", completed: false },
  ];
  const widget = new PlanWidget(runtime, theme, { requestRender: () => {} } as TUI);
  const lines = widget.render(28);
  assert.ok(lines.every((line) => visibleWidth(line) <= 28));
  assert.match(stripTerminalSequences(lines[0] ?? ""), /PLAN 1\/2/);
  assert.match(stripTerminalSequences(lines[1] ?? ""), /\[x\]/);
  assert.match(stripTerminalSequences(lines[2] ?? ""), /\[ \]/);
});
