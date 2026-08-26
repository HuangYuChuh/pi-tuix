import assert from "node:assert/strict";
import test from "node:test";
import {
  createReadToolDefinition,
  createWriteToolDefinition,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type Component } from "@earendil-works/pi-tui";
import {
  createCompactEditDefinition,
  createCompactBashDefinition,
  createCompactReadDefinition,
  createCompactWriteDefinition,
  type ToolRendererMode,
} from "../extensions/tools/renderers.ts";

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as Theme;

function render(component: Component, width = 100): string {
  return component.render(width).map(stripTerminalSequences).join("\n");
}

function renderContext<
  T,
  TState = { startedAt: undefined; endedAt: undefined; interval: undefined },
>(args: T, overrides: Record<string, unknown> = {}, state?: TState) {
  return {
    args,
    toolCallId: "tool-1",
    invalidate: () => {},
    lastComponent: undefined,
    state: state ?? ({ startedAt: undefined, endedAt: undefined, interval: undefined } as TState),
    cwd: "C:\\workspace",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: true,
    isError: false,
    ...overrides,
  };
}

test("read renderer exposes running and successful states without color-only meaning", () => {
  const mode: ToolRendererMode = { enabled: true };
  const definition = createCompactReadDefinition("C:\\workspace", mode);
  const args = { path: "src/index.ts" };
  const context = renderContext(args);

  const call = definition.renderCall?.(args, theme, context);
  assert.ok(call);
  assert.match(render(call), /READ src\/index\.ts \[RUNNING\] CLEAR/);

  const result = definition.renderResult?.(
    { content: [{ type: "text", text: "one\ntwo" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    context,
  );
  assert.ok(result);
  assert.match(render(result), /READ src\/index\.ts \| 2 lines \[OK\] CLEAR/);
});

test("read call distinguishes queued from running", () => {
  const mode: ToolRendererMode = { enabled: true };
  const definition = createCompactReadDefinition("C:\\workspace", mode);
  const args = { path: "src/queued.ts" };
  const queued = definition.renderCall?.(args, theme, renderContext(args, { executionStarted: false }));

  assert.ok(queued);
  assert.match(render(queued), /\[QUEUED\] CLEAR/);
});

test("bash renderer distinguishes errors and cancellations", () => {
  const mode: ToolRendererMode = { enabled: true };
  const definition = createCompactBashDefinition("C:\\workspace", mode);
  const args = { command: "npm run check" };

  const failed = definition.renderResult?.(
    { content: [{ type: "text", text: "Type error\n\nCommand exited with code 2" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    renderContext(args, { isError: true }),
  );
  assert.ok(failed);
  assert.match(render(failed), /\[ERROR\] ATTENTION/);
  assert.match(render(failed), /Command exited with code 2/);
  assert.equal(failed.render(100).length, 1);

  const failedExpanded = definition.renderResult?.(
    { content: [{ type: "text", text: "Type error\n\nCommand exited with code 2" }], details: undefined },
    { expanded: true, isPartial: false },
    theme,
    renderContext(args, { expanded: true, isError: true }),
  );
  assert.ok(failedExpanded);
  assert.match(render(failedExpanded), /Type error/);

  const cancelled = definition.renderResult?.(
    { content: [{ type: "text", text: "Command aborted" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    renderContext(args, { isError: true }),
  );
  assert.ok(cancelled);
  assert.match(render(cancelled), /\[CANCELLED\] CLEAR/);

  const partial = definition.renderResult?.(
    { content: [{ type: "text", text: "still running" }], details: undefined },
    { expanded: false, isPartial: true },
    theme,
    renderContext(args, { isPartial: true }),
  );
  assert.ok(partial);
  assert.match(render(partial), /\[RUNNING\] CLEAR/);
});

test("edit renderer reports diff stats and expands the diff", () => {
  const mode: ToolRendererMode = { enabled: true };
  const definition = createCompactEditDefinition("C:\\workspace", mode);
  const args = { path: "src/app.ts", edits: [{ oldText: "old", newText: "new" }] };
  const result = definition.renderResult?.(
    {
      content: [{ type: "text", text: "Successfully replaced 1 block(s) in src/app.ts." }],
      details: { diff: "@@ -1 +1 @@\n-old\n+new", patch: "", firstChangedLine: 1 },
    },
    { expanded: true, isPartial: false },
    theme,
    renderContext(args, { expanded: true }, { callComponent: undefined }),
  );

  assert.ok(result);
  const output = render(result);
  assert.match(output, /EDIT src\/app\.ts \| \+1 -1 \[OK\] CLEAR/);
  assert.match(output, /-old/);
  assert.match(output, /\+new/);
});

test("write renderer summarizes the target and written line count", () => {
  const mode: ToolRendererMode = { enabled: true };
  const definition = createCompactWriteDefinition("C:\\workspace", mode);
  const args = { path: "src/new.ts", content: "one\ntwo\nthree" };
  const result = definition.renderResult?.(
    { content: [{ type: "text", text: "Successfully wrote 13 bytes to src/new.ts" }], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    renderContext(args),
  );

  assert.ok(result);
  assert.match(render(result), /WRITE src\/new\.ts \| 3 lines written \[OK\] CLEAR/);
});

test("disabled mode restores the original Pi renderer", () => {
  const mode: ToolRendererMode = { enabled: false };
  const original = createReadToolDefinition("C:\\workspace");
  const definition = createCompactReadDefinition("C:\\workspace", mode, original);
  const args = { path: "README.md" };
  const context = renderContext(args);

  const expected = original.renderCall?.(args, theme, context);
  const actual = definition.renderCall?.(args, theme, context);
  assert.ok(expected);
  assert.ok(actual);
  assert.equal(render(actual), render(expected));
});

test("switching to default rendering discards an incompatible compact component", () => {
  const mode: ToolRendererMode = { enabled: true };
  const original = createReadToolDefinition("C:\\workspace");
  const definition = createCompactReadDefinition("C:\\workspace", mode, original);
  const args = { path: "README.md" };
  const compact = definition.renderCall?.(args, theme, renderContext(args));
  assert.ok(compact);

  mode.enabled = false;
  const restored = definition.renderCall?.(args, theme, renderContext(args, { lastComponent: compact }));
  assert.ok(restored);
  assert.notEqual(restored, compact);
  assert.equal(render(restored), render(original.renderCall?.(args, theme, renderContext(args)) as Component));
});

test("compact definitions retain Pi's exact execution function", async () => {
  const mode: ToolRendererMode = { enabled: true };
  const calls: unknown[][] = [];
  const original = createWriteToolDefinition("C:\\workspace");
  const delegated = async (...args: Parameters<typeof original.execute>) => {
    calls.push(args);
    return { content: [{ type: "text" as const, text: "delegated" }], details: undefined };
  };
  original.execute = delegated;

  const definition = createCompactWriteDefinition("C:\\workspace", mode, original);
  assert.equal(definition.execute, delegated);

  const params = { path: "output.txt", content: "hello" };
  const signal = new AbortController().signal;
  const context = {} as Parameters<typeof definition.execute>[4];
  const result = await definition.execute("tool-1", params, signal, undefined, context);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["tool-1", params, signal, undefined, context]);
  assert.equal(result.content[0]?.type, "text");
});
