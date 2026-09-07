import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type AgentToolResult,
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  initTheme,
  renderDiff,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Box, type Component, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
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

initTheme("dark", false);

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as Theme;

function render(component: Component | undefined, width = 80): string[] {
  assert.ok(component);
  return component
    .render(width)
    .map(stripTerminalSequences)
    .map((line) => line.replace(/^⏺/, "*").replace("  ⎿  ", "  L  "));
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
  assert.match(collapsed[0] ?? "", /Read\(README\.md\) \[OK\] 6 lines/);

  const preview = render(new ThreeLayerToolView("preview", summary, details, theme));
  assert.deepEqual(preview, [
    "* Read(README.md) [OK] 6 lines",
    "  L  one",
    "     two",
    "     ... 2 more lines hidden (/pituix-mode expanded to expand)",
    "     five",
    "     six",
  ]);

  const shortPreview = render(
    new ThreeLayerToolView("preview", summary, ["one", "two", "three"], theme),
  );
  assert.deepEqual(shortPreview, [
    "* Read(README.md) [OK] 6 lines",
    "  L  one",
    "     two",
    "     three",
  ]);

  const expanded = render(new ThreeLayerToolView("expanded", summary, details, theme));
  assert.equal(expanded.length, 7);
  assert.deepEqual(
    expanded.slice(1),
    details.map((line, index) => `${index === 0 ? "  L  " : "     "}${line}`),
  );
});

test("three-layer renderers expose tool-specific summaries and states", () => {
  const mode: ToolRendererMode = { enabled: true, defaultMode: "preview" };
  const read = createThreeLayerReadDefinition("C:\\workspace", mode);
  const readLines = previewResult(read, { path: "src/index.ts" }, "one\ntwo\nthree\nfour\nfive");
  assert.deepEqual(readLines, ["* Read(src/index.ts) [OK]", "  L  Read 5 lines"]);

  const bash = createThreeLayerBashDefinition("C:\\workspace", mode);
  const bashLines = render(
    bash.renderResult?.(
      result("first\nsecond\nthird"),
      { expanded: false, isPartial: true },
      theme,
      context({ command: "npm test" }, { isPartial: true }),
    ),
  );
  assert.match(bashLines[0] ?? "", /Bash\(npm test\) \[RUNNING\] 3 output lines/);

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
  assert.match(editLines[0] ?? "", /Update\(src\/app\.ts\) \[OK\]/);
  assert.deepEqual(editLines.slice(1), [
    "  L  Added 1 line, removed 1 line",
    "     @@",
    "     -old",
    "     +new",
  ]);

  const write = createThreeLayerWriteDefinition("C:\\workspace", mode);
  const writeLines = render(
    write.renderResult?.(
      result("written"),
      { expanded: false, isPartial: false },
      theme,
      context({ path: "out.txt", content: "one\ntwo" }),
    ),
  );
  assert.deepEqual(writeLines, [
    "* Write(out.txt) [OK]",
    "  L  Wrote 2 lines to out.txt",
    "      1 one",
    "      2 two",
  ]);
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
  assert.match(error[0] ?? "", /Bash\(bad\) \[ERROR\].*ATTENTION/);
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
  assert.match(empty[0] ?? "", /Bash\(true\) \[OK\] 0 output lines/);
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
  const frame = new Box(1, 1);
  frame.addChild(expected);
  assert.deepEqual(render(fallback), render(frame));
});

test("result replaces its pending row and disabling restores the host shell", () => {
  const mode: ToolRendererMode = { enabled: true, defaultMode: "preview" };
  const definition = createThreeLayerBashDefinition(process.cwd(), mode);
  const args = { command: "printf test" };
  const shared = context(args);
  const call = definition.renderCall?.(args, theme, shared);
  assert.ok(call);
  assert.match(render(call)[0] ?? "", /RUNNING/);
  assert.equal(definition.renderShell, "self");
  const output = definition.renderResult?.(
    result("test"),
    { expanded: false, isPartial: false },
    theme,
    shared,
  );
  assert.deepEqual(call.render(80), []);
  assert.match(render(output)[0] ?? "", /OK/);
  mode.enabled = false;
  assert.equal(definition.renderShell, "self");
});

test("reference result branches retain expansion, numbered Write contents, and failure detail", () => {
  const mode: ToolRendererMode = { enabled: true, defaultMode: "preview" };
  const read = createThreeLayerReadDefinition(process.cwd(), mode);
  const args = { path: "sample.ts" };
  const expanded = render(
    read.renderResult?.(
      result("one\ntwo"),
      { expanded: true, isPartial: false },
      theme,
      context(args),
    ),
  );
  assert.deepEqual(expanded, [
    "* Read(sample.ts) [OK]",
    "  L  Read 2 lines",
    "     one",
    "     two",
  ]);
  const failedRead = render(
    read.renderResult?.(
      result("File not found"),
      { expanded: false, isPartial: false },
      theme,
      context(args, { isError: true }),
    ),
  );
  assert.match(failedRead[0] ?? "", /ERROR.*ATTENTION/);
  assert.equal(failedRead[1], "  L  File not found");
  const write = createThreeLayerWriteDefinition(process.cwd(), mode);
  const writeArgs = { path: "notes.txt", content: "one\ntwo\nthree\nfour\nfive\nsix\n" };
  const component = write.renderResult?.(
    result("ok"),
    { expanded: false, isPartial: false },
    theme,
    context(writeArgs),
  );
  const lines = render(component);
  assert.equal(lines[1], "  L  Wrote 6 lines to notes.txt");
  assert.equal(lines[2], "      1 one");
  assert.equal(lines[3], "      2 two");
  assert.match(lines[4] ?? "", /2 more lines/);
  assert.equal(lines[5], "      5 five");
  assert.equal(lines[6], "      6 six");
  for (const width of [0, 1, 2, 8, 24, 40, 80, 120])
    assert.ok(component?.render(width).every((line) => visibleWidth(line) <= width));
  const writing = render(
    write.renderResult?.(
      result(""),
      { expanded: false, isPartial: true },
      theme,
      context(writeArgs),
    ),
  );
  assert.match(writing[0] ?? "", /RUNNING/);
  assert.match(writing[1] ?? "", /Writing 6 lines/);
  const failedWrite = render(
    write.renderResult?.(
      result("Permission denied\nCannot write notes.txt"),
      { expanded: false, isPartial: false },
      theme,
      context(writeArgs, { isError: true }),
    ),
  );
  assert.match(failedWrite[0] ?? "", /ERROR.*ATTENTION/);
  assert.equal(failedWrite[1], "  L  Permission denied");
  assert.ok(!failedWrite.join("\n").includes("  1 one"));
  mode.defaultMode = "collapsed";
  assert.match(
    render(
      write.renderResult?.(
        result("ok"),
        { expanded: false, isPartial: false },
        theme,
        context(writeArgs),
      ),
    )[0] ?? "",
    /6 lines written/,
  );
});

test("every reference tool retains the official executor and schema", () => {
  const cwd = process.cwd();
  const mode: ToolRendererMode = { enabled: true, defaultMode: "preview" };
  const read = createReadToolDefinition(cwd);
  const bash = createBashToolDefinition(cwd);
  const edit = createEditToolDefinition(cwd);
  const write = createWriteToolDefinition(cwd);
  const pairs = [
    [read, createThreeLayerReadDefinition(cwd, mode, read)],
    [bash, createThreeLayerBashDefinition(cwd, mode, bash)],
    [edit, createThreeLayerEditDefinition(cwd, mode, edit)],
    [write, createThreeLayerWriteDefinition(cwd, mode, write)],
  ] as const;
  for (const [original, wrapped] of pairs) {
    assert.equal(wrapped.execute, original.execute);
    assert.equal(wrapped.parameters, original.parameters);
    assert.equal(wrapped.prepareArguments, original.prepareArguments);
  }
});

test("configured ASCII mode updates pending and finished tools without changing execution", () => {
  let ascii = false;
  const mode: ToolRendererMode = { enabled: true, defaultMode: "preview", ascii: () => ascii };
  const cwd = process.cwd();
  const fixtures = [
    { definition: createThreeLayerReadDefinition(cwd, mode), args: { path: "sample.ts" } },
    { definition: createThreeLayerBashDefinition(cwd, mode), args: { command: "echo result" } },
    {
      definition: createThreeLayerEditDefinition(cwd, mode),
      args: { path: "sample.ts", edits: [] },
    },
    {
      definition: createThreeLayerWriteDefinition(cwd, mode),
      args: { path: "sample.ts", content: "result" },
    },
  ];
  const tui = { requestRender() {} } as ConstructorParameters<typeof ToolExecutionComponent>[5];
  for (const { definition, args } of fixtures) {
    ascii = false;
    const component = new ToolExecutionComponent(
      definition.name,
      "icons",
      args,
      {},
      definition,
      tui,
      cwd,
    );
    const lines = () => component.render(100).map(stripTerminalSequences).join("\n");
    assert.match(lines(), /⏺/);
    ascii = true;
    component.invalidate();
    assert.match(lines(), /\* .*\[QUEUED\]/);
    component.updateResult({
      ...result(
        "result",
        definition.name === "edit"
          ? { diff: "-1 old\n+1 new", patch: "", firstChangedLine: 1 }
          : undefined,
      ),
      isError: false,
    });
    assert.match(lines(), /\* .*\[OK\]/);
    assert.match(lines(), / {2}L {2}/);
    ascii = false;
    component.invalidate();
    assert.match(lines(), /⏺ .*\[OK\]/);
    assert.match(lines(), / {2}⎿ {2}/);
    for (const width of [0, 1, 4, 12, 40, 80, 100])
      assert.ok(component.render(width).every((line) => visibleWidth(line) <= width));
  }
});

test("live host tool components restore native frames and results after mode changes", () => {
  const cwd = process.cwd();
  const mode: ToolRendererMode = { enabled: true, defaultMode: "preview" };
  const fixtures = [
    { definition: createThreeLayerReadDefinition(cwd, mode), args: { path: "sample.ts" } },
    { definition: createThreeLayerBashDefinition(cwd, mode), args: { command: "printf test" } },
    {
      definition: createThreeLayerEditDefinition(cwd, mode),
      args: { path: "sample.ts", edits: [{ oldText: "old", newText: "new" }] },
    },
    {
      definition: createThreeLayerWriteDefinition(cwd, mode),
      args: { path: "sample.ts", content: "one\ntwo\nthree\nfour\nfive\n" },
    },
  ];
  const ui = { requestRender() {} } as ConstructorParameters<typeof ToolExecutionComponent>[5];
  for (const { definition, args } of fixtures) {
    for (const isError of [false, true]) {
      const output = { ...result(isError ? "fixture error" : "fixture output"), isError };
      const custom = new ToolExecutionComponent(
        definition.name,
        "fixture",
        args,
        {},
        definition,
        ui,
        cwd,
      );
      const native = new ToolExecutionComponent(
        definition.name,
        "native",
        args,
        {},
        undefined,
        ui,
        cwd,
      );
      custom.updateResult(output);
      native.updateResult(output);
      const before = render(custom, 100);
      mode.enabled = false;
      custom.invalidate();
      for (const expanded of [false, true]) {
        custom.setExpanded(expanded);
        native.setExpanded(expanded);
        for (const width of [12, 40, 100]) {
          assert.deepEqual(render(custom, width), render(native, width), definition.name);
        }
      }
      mode.enabled = true;
      custom.setExpanded(false);
      custom.invalidate();
      assert.deepEqual(render(custom, 100), before, definition.name);
    }
  }
});

test("a native running renderer receives completion after switching presentation modes", () => {
  const mode: ToolRendererMode = { enabled: false, defaultMode: "preview" };
  const original = createBashToolDefinition(process.cwd());
  const updates: boolean[] = [];
  original.renderResult = (_result, options) => {
    updates.push(options.isPartial);
    return { render: () => ["native output"], invalidate() {} };
  };
  const definition = createThreeLayerBashDefinition(process.cwd(), mode, original);
  const args = { command: "fixture" };
  const shared = context(args, { isPartial: true });
  definition.renderResult?.(result("running"), { expanded: false, isPartial: true }, theme, shared);
  mode.enabled = true;
  shared.isPartial = false;
  const final = definition.renderResult?.(
    result("complete"),
    { expanded: false, isPartial: false },
    theme,
    shared,
  );
  assert.deepEqual(updates, [true, false]);
  assert.match(render(final)[0] ?? "", /\[OK\]/);
  definition.renderResult?.(
    result("complete"),
    { expanded: true, isPartial: false },
    theme,
    shared,
  );
  assert.deepEqual(updates, [true, false]);
});

test("official Read image execution retains its bytes and renders byte summaries with host warnings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pituix-read-image-"));
  try {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAKAAAABgCAIAAAAVRe7OAAAA/klEQVR4nO3RQQ0AIRDAQDTdG00oRszJIOlOUgWddfce1XfuqNbz44ABAwYMGDDgET0/DhgwYMCAAQMeEeB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOP94QRk7Wn8KkUAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(dir, "image.png"), bytes);
    const mode: ToolRendererMode = { enabled: true, defaultMode: "preview" };
    const original = createReadToolDefinition(dir);
    const definition = createThreeLayerReadDefinition(dir, mode, original);
    assert.equal(definition.execute, original.execute);
    const args = { path: "image.png" };
    const actual = await definition.execute("image", args, undefined, undefined, {} as never);
    const media = actual.content.find((part) => part.type === "image");
    assert.ok(media);
    assert.deepEqual(Buffer.from(media.data, "base64"), bytes);
    const before = structuredClone(actual);
    for (const expanded of [false, true]) {
      const component = definition.renderResult?.(
        actual,
        { expanded, isPartial: false },
        theme,
        context(args),
      );
      assert.deepEqual(render(component), [
        "* Read(image.png) [OK]",
        `  L  Read image (${bytes.length} bytes)`,
      ]);
      for (const width of [0, 1, 2, 4, 12, 40, 80, 100])
        assert.ok(component?.render(width).every((line) => visibleWidth(line) <= width));
    }
    assert.deepEqual(actual, before);
    const warned = structuredClone(actual);
    warned.content.unshift({ type: "text", text: "[Current model does not support images.]" });
    const expanded = definition.renderResult?.(
      warned,
      { expanded: true, isPartial: false },
      theme,
      context(args),
    );
    assert.match(render(expanded).join("\n"), /Current model does not support images/);
    for (const [text, state] of [
      ["Operation cancelled", "CANCELLED"],
      ["Cannot read image", "ERROR"],
    ]) {
      const failed = definition.renderResult?.(
        { ...actual, content: [{ type: "text", text }, media] },
        { expanded: false, isPartial: false },
        theme,
        context(args, { isError: true }),
      );
      assert.match(render(failed).join("\n"), new RegExp(`\\[${state}\\]`));
      assert.match(render(failed).join("\n"), new RegExp(text));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("official Edit execution produces a numbered reference diff without changing its result", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pituix-diff-"));
  try {
    await writeFile(
      join(dir, "sample.ts"),
      "export function sum(a: number, b: number): number {\n  return a - b;\n}\n",
    );
    const mode: ToolRendererMode = { enabled: true, defaultMode: "preview" };
    const definition = createThreeLayerEditDefinition(dir, mode);
    const args = { path: "sample.ts", edits: [{ oldText: "a - b", newText: "a + b" }] };
    const actual = await definition.execute(
      "edit-fixture",
      args,
      undefined,
      undefined,
      {} as never,
    );
    assert.match(await readFile(join(dir, "sample.ts"), "utf8"), /return a \+ b/);
    const originalResult = structuredClone(actual);
    const component = definition.renderResult?.(
      actual,
      { expanded: true, isPartial: false },
      theme,
      context(args) as never,
    );
    const lines = render(component);
    assert.match(lines[0] ?? "", /Update\(sample\.ts\) \[OK\]/);
    assert.equal(lines[1], "  L  Added 1 line, removed 1 line");
    assert.match(lines.join("\n"), /2 -.*return a - b/);
    assert.match(lines.join("\n"), /2 \+.*return a \+ b/);
    const inverseCount = (value: string) => value.split("\u001b[7m").length - 1;
    assert.equal(
      inverseCount(component?.render(100).join("\n") ?? ""),
      inverseCount(renderDiff(actual.details?.diff ?? "")),
    );
    for (const width of [1, 2, 12, 24, 80])
      assert.ok(component?.render(width).every((line) => visibleWidth(line) <= width));
    assert.deepEqual(actual, originalResult);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
