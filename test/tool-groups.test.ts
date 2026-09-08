import assert from "node:assert/strict";
import test from "node:test";
import {
  initTheme,
  type SessionEntry,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  createThreeLayerBashDefinition,
  createThreeLayerReadDefinition,
  type ToolRendererMode,
} from "../extensions/tools/renderers-v2.ts";
import { GroupedToolView, ToolGroupRuntime } from "../extensions/tools/tool-groups.ts";

initTheme("dark", false);
const paint = (text: string) => `\u001b[38;2;153;153;153m${text}\u001b[39m`;
const theme = { fg: (_token: string, text: string) => paint(text) } as Theme;
const call = (id: string, name: string, args: Record<string, unknown>) => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});
const assistant = (...content: unknown[]) => ({ role: "assistant", content });
const result = (text = "fixture output") => ({ content: [{ type: "text", text }] });
const plain = (component: Component, width = 100) =>
  component.render(width).map(stripTerminalSequences);

test("reference grouping counts unique files and every shell call without rewriting messages", () => {
  const groups = new ToolGroupRuntime();
  groups.reset("/workspace");
  const message = assistant(
    call("r1", "read", { path: "sample.ts", offset: 1, limit: 1 }),
    call("r2", "read", { path: "./sample.ts", offset: 2, limit: 1 }),
    call("b1", "bash", { command: "printf first" }),
    call("b2", "bash", { command: "printf second" }),
  );
  const before = structuredClone(message);
  groups.recordMessage(message);
  groups.complete("r1", result(), false);
  assert.equal(groups.get("r1"), undefined);
  for (const id of ["r2", "b1", "b2"]) groups.complete(id, result(), false);
  const group = groups.get("r1");
  assert.equal(group?.summary, "Read 1 file, ran 2 shell commands");
  assert.equal(group?.leader, "r1");
  assert.equal(group?.targets, "sample.ts; printf first; printf second");
  assert.deepEqual(group?.members, ["r1", "r2", "b1", "b2"]);
  assert.equal(groups.get("b2"), group);
  groups.recordMessage(message);
  assert.equal(groups.get("r1")?.summary, group?.summary);
  assert.deepEqual(message, before);
});

test("visible text, user turns, mutation tools and unknown tools separate groups", () => {
  for (const boundary of [
    { role: "user", content: "next question" },
    assistant({ type: "text", text: "I will inspect another file." }),
    assistant(call("boundary", "edit", { path: "sample.ts" })),
    assistant(call("boundary", "write", { path: "sample.ts", content: "changed" })),
    assistant(call("boundary", "mcp__query", { query: "example" })),
    { role: "custom", content: "extension message" },
  ]) {
    const groups = new ToolGroupRuntime();
    for (const id of ["a", "b"]) {
      groups.recordMessage(assistant(call(id, "read", { path: `${id}.ts` })));
      groups.complete(id, result(), false);
    }
    groups.recordMessage(boundary);
    for (const id of ["c", "d"]) {
      groups.recordMessage(assistant(call(id, "bash", { command: `printf ${id}` })));
      groups.complete(id, result(), false);
    }
    assert.deepEqual(groups.get("a")?.members, ["a", "b"]);
    assert.deepEqual(groups.get("c")?.members, ["c", "d"]);
    assert.equal(groups.get("a")?.summary, "Read 2 files");
    assert.equal(groups.get("c")?.summary, "Ran 2 shell commands");
  }
});

test("pending, failed, cancelled and truncated results remain individually visible", () => {
  for (const [middle, isError] of [
    [undefined, false],
    [result("Command exited with code 7"), true],
    [result("Operation cancelled"), true],
    [{ ...result(), details: { truncation: { truncated: true } } }, false],
  ] as const) {
    const groups = new ToolGroupRuntime();
    groups.recordMessage(assistant(...["a", "b", "c"].map((id) => call(id, "read", { path: id }))));
    groups.complete("a", result(), false);
    if (middle) groups.complete("b", middle, isError);
    groups.complete("c", result(), false);
    assert.equal(groups.get("a"), undefined);
    assert.equal(groups.get("b"), undefined);
    assert.equal(groups.get("c"), undefined);
  }
  const groups = new ToolGroupRuntime();
  groups.recordMessage(
    assistant(...["a", "b", "c"].map((id) => call(id, "bash", { command: id }))),
  );
  for (const id of ["a", "b", "c"]) groups.complete(id, result(), false);
  assert.deepEqual(groups.complete("b", result("failure"), true), ["a", "b", "c"]);
  assert.equal(groups.get("a"), undefined);
  assert.equal(groups.get("c"), undefined);
});

test("Read images collapse to a file count while Bash images remain individually visible", () => {
  const groups = new ToolGroupRuntime();
  const media = { content: [{ type: "image", data: "fixture", mimeType: "image/png" }] };
  groups.recordMessage(assistant(call("image", "read", { path: "image.png" })));
  groups.complete("image", media, false);
  assert.equal(groups.get("image")?.summary, "Read 1 file");
  groups.recordMessage(assistant(call("text", "read", { path: "text.txt" })));
  groups.complete("text", result(), false);
  assert.equal(groups.get("image")?.summary, "Read 2 files");
  groups.recordMessage(assistant(call("bash", "bash", { command: "render-image" })));
  groups.complete("bash", media, false);
  assert.equal(groups.get("bash"), undefined);
  assert.equal(groups.get("image")?.summary, "Read 2 files");
  assert.deepEqual(groups.complete("image", media, true), ["image", "text"]);
  assert.equal(groups.get("image"), undefined);
  assert.equal(groups.get("text"), undefined);
});

test("group metadata can be hydrated from the public session branch and reset on navigation", () => {
  const groups = new ToolGroupRuntime();
  groups.reset("/workspace");
  const messages = [
    { role: "user", content: "inspect" },
    assistant(call("a", "read", { path: "file.ts" })),
    { role: "toolResult", toolCallId: "a", isError: false, ...result() },
    assistant(
      { type: "thinking", thinking: "inspect" },
      call("b", "bash", { command: "printf test" }),
    ),
    { role: "toolResult", toolCallId: "b", isError: false, ...result() },
  ];
  for (const message of messages) groups.recordEntry({ type: "message", message } as SessionEntry);
  assert.equal(groups.get("a")?.summary, "Read 1 file, ran 1 shell command");
  groups.reset("/another-workspace");
  assert.equal(groups.get("a"), undefined);
  assert.equal(groups.complete("a", result(), false).length, 0);
});

test("group views collapse secondary rows, expose individual details and bound ANSI/CJK targets", () => {
  const groups = new ToolGroupRuntime();
  groups.recordMessage(
    assistant(
      call("a", "read", { path: "src/中文文件.ts" }),
      call("b", "bash", { command: "printf 中文输出" }),
    ),
  );
  groups.complete("a", result(), false);
  groups.complete("b", result(), false);
  const fallback = { render: () => ["individual tool details"], invalidate() {} };
  const leader = new GroupedToolView("a", fallback, groups, false, theme);
  const secondary = new GroupedToolView("b", fallback, groups, false, theme);
  assert.match(plain(leader)[0], /^ {2}Read 1 file, ran 1 shell command.*中文文件.*\[OK\]$/);
  assert.deepEqual(secondary.render(100), []);
  assert.deepEqual(plain(new GroupedToolView("b", fallback, groups, true, theme)), [
    "individual tool details",
  ]);
  for (let width = 0; width <= 140; width++) {
    assert.ok(
      leader.render(width).every((line) => visibleWidth(line) <= width),
      `width ${width}`,
    );
  }
});

test("the real host hides grouped rows, expands every call, and restores the native transcript", () => {
  const cwd = process.cwd();
  const groups = new ToolGroupRuntime();
  const mode: ToolRendererMode = {
    enabled: true,
    config: {
      defaultMode: "preview",
      autoExpand: true,
      maxPreviewLines: 4,
      highlightErrors: true,
    },
    groups,
  };
  const ui = { requestRender() {} } as ConstructorParameters<typeof ToolExecutionComponent>[5];
  const fixtures = [
    { id: "a", definition: createThreeLayerReadDefinition(cwd, mode), args: { path: "sample.ts" } },
    {
      id: "b",
      definition: createThreeLayerBashDefinition(cwd, mode),
      args: { command: "printf test" },
    },
  ];
  groups.recordMessage(
    assistant(...fixtures.map(({ id, definition, args }) => call(id, definition.name, args))),
  );
  const components = fixtures.map(({ id, definition, args }) => {
    const component = new ToolExecutionComponent(
      definition.name,
      id,
      args,
      {},
      definition,
      ui,
      cwd,
    );
    component.updateResult({ ...result(), isError: false });
    groups.complete(id, result(), false);
    return component;
  });
  for (const component of components) component.invalidate();
  const collapsed = components.flatMap((component) => plain(component));
  assert.equal(
    collapsed.filter((line) => line.includes("Read 1 file, ran 1 shell command")).length,
    1,
  );
  assert.deepEqual(
    components[1].render(100).filter((line) => line.trim().length > 0),
    [],
  );
  for (const component of components) component.setExpanded(true);
  assert.match(plain(components[0]).join("\n"), /READ sample\.ts \[OK\]/);
  assert.match(plain(components[1]).join("\n"), /BASH printf test \[OK\]/);
  mode.enabled = false;
  for (const component of components) component.invalidate();
  fixtures.forEach(({ id, definition, args }, index) => {
    const native = new ToolExecutionComponent(definition.name, id, args, {}, undefined, ui, cwd);
    native.updateResult({ ...result(), isError: false });
    native.setExpanded(true);
    assert.deepEqual(
      plain(components[index]).filter((line) => line.trim().length > 0),
      plain(native).filter((line) => line.trim().length > 0),
    );
  });
});
