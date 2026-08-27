import assert from "node:assert/strict";
import test from "node:test";
import {
  type AgentToolResult,
  createWriteToolDefinition,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  createThreeLayerBashDefinition,
  createThreeLayerEditDefinition,
  createThreeLayerReadDefinition,
  createThreeLayerWriteDefinition,
  type ToolRendererMode,
} from "../extensions/tools/renderers-v2.ts";
import {
  diffStats,
  extractErrorSummary,
  ThreeLayerToolView,
  truncateCommand,
  truncateOutput,
  truncatePath,
} from "../extensions/tools/three-layer-view.ts";

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as Theme;

function render(component: Component | undefined, width = 80): string[] {
  assert.ok(component);
  return component.render(width).map(stripTerminalSequences);
}

function context<T>(args: T, overrides: Record<string, unknown> = {}) {
  return {
    args,
    toolCallId: "tool-1",
    invalidate: () => {},
    lastComponent: undefined,
    state: { startedAt: undefined, endedAt: undefined, interval: undefined },
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

function result(text: string): AgentToolResult<undefined>;
function result<T>(text: string, details: T): AgentToolResult<T>;
function result<T>(text: string, details?: T): AgentToolResult<T | undefined> {
  return {
    content: [{ type: "text" as const, text }],
    details,
  } as AgentToolResult<T | undefined>;
}

function previewResult(
  definition: ReturnType<typeof createThreeLayerReadDefinition>,
  args: { path: string },
  text: string,
) {
  const component = definition.renderResult?.(
    result(text),
    { expanded: false, isPartial: false },
    theme,
    context(args),
  );
  assert.ok(component instanceof ThreeLayerToolView);
  return render(component);
}

test("three-layer view renders collapsed, preview, and expanded without duplicate preview lines", () => {
  const summary = {
    action: "read",
    target: "README.md",
    status: "OK" as const,
    meta: "6 lines",
    attention: false,
  };
  const details = ["one", "two", "three", "four", "five", "six"];

  const collapsed = render(new ThreeLayerToolView("collapsed", summary, details, theme));
  assert.equal(collapsed.length, 1);
  assert.match(collapsed[0] ?? "", /READ README\.md \[OK\] 6 lines/);

  const preview = render(new ThreeLayerToolView("preview", summary, details, theme));
  assert.deepEqual(preview, [
    "READ README.md [OK] 6 lines",
    "  one",
    "  two",
    "  ... 2 more lines hidden (press E to expand)",
    "  five",
    "  six",
  ]);

  const shortPreview = render(
    new ThreeLayerToolView("preview", summary, ["one", "two", "three"], theme),
  );
  assert.deepEqual(shortPreview, ["READ README.md [OK] 6 lines", "  one", "  two", "  three"]);

  const expanded = render(new ThreeLayerToolView("expanded", summary, details, theme));
  assert.equal(expanded.length, 7);
  assert.deepEqual(
    expanded.slice(1),
    details.map((line) => `  ${line}`),
  );
});

test("three-layer renderers expose tool-specific summaries and states", () => {
  const mode: ToolRendererMode = { enabled: true, defaultMode: "preview" };
  const read = createThreeLayerReadDefinition("C:\\workspace", mode);
  const readLines = previewResult(read, { path: "src/index.ts" }, "one\ntwo\nthree\nfour\nfive");
  assert.match(readLines[0] ?? "", /READ src\/index\.ts \[OK\] 5 lines/);
  assert.match(readLines[3] ?? "", /hidden/);

  const bash = createThreeLayerBashDefinition("C:\\workspace", mode);
  const bashLines = render(
    bash.renderResult?.(
      result("first\nsecond\nthird"),
      { expanded: false, isPartial: true },
      theme,
      context({ command: "npm test" }, { isPartial: true }),
    ),
  );
  assert.match(bashLines[0] ?? "", /BASH npm test \[RUNNING\] 3 output lines/);

  const edit = createThreeLayerEditDefinition("C:\\workspace", mode);
  const editLines = render(
    edit.renderResult?.(
      result("applied", { diff: "@@\n-old\n+new", patch: "", firstChangedLine: 1 }),
      { expanded: false, isPartial: false },
      theme,
      context(
        { path: "src/app.ts", edits: [] },
        { state: { callComponent: undefined } },
      ) as Parameters<NonNullable<typeof edit.renderResult>>[3] as Parameters<
        NonNullable<typeof edit.renderResult>
      >[3],
    ),
  );
  assert.match(editLines[0] ?? "", /EDIT src\/app\.ts \[OK\] \+1 -1/);
  assert.deepEqual(editLines.slice(1), ["  @@", "  -old", "  +new"]);

  const write = createThreeLayerWriteDefinition("C:\\workspace", mode);
  const writeLines = render(
    write.renderResult?.(
      result("written"),
      { expanded: false, isPartial: false },
      theme,
      context({ path: "out.txt", content: "one\ntwo" }),
    ),
  );
  assert.match(writeLines[0] ?? "", /WRITE out\.txt \[OK\] 2 lines written/);
  assert.equal(writeLines.length, 1);
});

test("three-layer renderers mark errors, cancellations, and empty output", () => {
  const mode: ToolRendererMode = { enabled: true, defaultMode: "preview" };
  const bash = createThreeLayerBashDefinition("C:\\workspace", mode);
  const error = render(
    bash.renderResult?.(
      result("/bin/sh: bad: not found\nCommand exited with code 127"),
      { expanded: false, isPartial: false },
      theme,
      context({ command: "bad" }, { isError: true }),
    ),
  );
  assert.match(error[0] ?? "", /BASH bad \[ERROR\].*ATTENTION/);
  assert.match(error[0] ?? "", /Command exited with code 127/);
  assert.match(error[1] ?? "", /not found/);

  const cancelled = render(
    bash.renderResult?.(
      result("Command aborted"),
      { expanded: false, isPartial: false },
      theme,
      context({ command: "sleep 10" }, { isError: true }),
    ),
  );
  assert.match(cancelled[0] ?? "", /\[CANCELLED\].*ATTENTION/);

  const empty = render(
    bash.renderResult?.(
      result(""),
      { expanded: false, isPartial: false },
      theme,
      context({ command: "true" }),
    ),
  );
  assert.match(empty[0] ?? "", /BASH true \[OK\] 0 output lines/);
  assert.equal(empty.length, 1);
});

test("three-layer helpers preserve narrow-width and long-input invariants", () => {
  const summary = {
    action: "bash",
    target: "a-command-with-a-very-long-name",
    status: "ERROR" as const,
    attention: true,
  };
  const lines = render(new ThreeLayerToolView("collapsed", summary, [], theme), 80);
  assert.ok(lines[0]?.length !== undefined && lines[0].length <= 80);

  const longPath = `src/${"nested/".repeat(20)}file.ts`;
  assert.ok(truncatePath(longPath).length <= 56);
  assert.equal(truncateCommand("one\ntwo\nthree\nfour", 3).length, 3);
  assert.deepEqual(truncateOutput("1\n2\n3\n4\n5", "preview"), {
    lines: ["1", "2", "4", "5"],
    truncated: true,
    hiddenCount: 1,
  });
  assert.deepEqual(diffStats("--- old\n+++ new\n-a\n+b"), { additions: 1, removals: 1 });
  assert.equal(
    extractErrorSummary("first\nCommand exited with code 2"),
    "Command exited with code 2",
  );
});

test("three-layer definitions retain Pi execution functions and disabled fallback", async () => {
  const mode: ToolRendererMode = { enabled: true, defaultMode: "preview" };
  const original = createWriteToolDefinition("C:\\workspace");
  const calls: unknown[][] = [];
  const execute = async (...args: Parameters<typeof original.execute>) => {
    calls.push(args);
    return result("delegated");
  };
  original.execute = execute;

  const definition = createThreeLayerWriteDefinition("C:\\workspace", mode, original);
  assert.equal(definition.execute, execute);
  const params = { path: "out.txt", content: "hello" };
  const signal = new AbortController().signal;
  const executionContext = {} as Parameters<typeof definition.execute>[4];
  await definition.execute("tool-1", params, signal, undefined, executionContext);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["tool-1", params, signal, undefined, executionContext]);

  mode.enabled = false;
  assert.ok(definition.renderCall);
  assert.ok(original.renderCall);
  const fallback = definition.renderCall(params, theme, context(params));
  const expected = original.renderCall(params, theme, context(params));
  assert.deepEqual(render(fallback), render(expected));
});
