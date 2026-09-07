import assert from "node:assert/strict";
import test from "node:test";
import type {
  CustomEntry,
  EntryRenderer,
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  type EditorComponent,
  type EditorTheme,
  stripTerminalSequences,
  type TUI,
} from "@earendil-works/pi-tui";
import piTuix from "../extensions/index.ts";
import { COMPLETION_ENTRY_TYPE } from "../extensions/stream/completion-entry.ts";

test("Pi-TUIX installs and reverses its editor component in the active session", async () => {
  // biome-ignore lint/suspicious/noExplicitAny: Test mock types
  const handlers = new Map<string, (...args: any[]) => any>();
  // biome-ignore lint/suspicious/noExplicitAny: Test mock types
  const commands = new Map<string, { handler: (...args: any[]) => Promise<void> }>();
  const tools: ToolDefinition[] = [];
  const entries: CustomEntry[] = [];
  const renderers = new Map<string, EntryRenderer>();
  const pi = {
    registerMarkdownTransformer: () => {},
    registerEntryRenderer: (name: string, renderer: EntryRenderer) => renderers.set(name, renderer),
    appendEntry: (customType: string, data: unknown) =>
      entries.push({
        type: "custom",
        customType,
        data,
        id: String(entries.length),
        parentId: entries.at(-1)?.id ?? null,
        timestamp: new Date().toISOString(),
      }),
    // biome-ignore lint/suspicious/noExplicitAny: Test mock types
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    // biome-ignore lint/suspicious/noExplicitAny: Test mock types
    registerCommand: (name: string, definition: { handler: (...args: any[]) => Promise<void> }) =>
      commands.set(name, definition),
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    sendUserMessage: () => {},
  } as unknown as ExtensionAPI;

  piTuix(pi);
  assert.ok(commands.has("pituix-settings"));
  assert.ok(commands.has("pituix-session"));
  assert.ok(commands.has("pituix-resume"));
  assert.ok(commands.has("pituix-transcript"));
  assert.ok(!commands.has("open-tui"));
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["read", "bash", "edit", "write"],
  );

  const editorFactories: unknown[] = [];
  const workingMessages: (string | undefined)[] = [];
  const widgets = new Map<string, unknown>();
  const originalTheme = { name: "original", fg: (_color: string, text: string) => text };
  const referenceTheme = { ...originalTheme, name: "pi-tuix-dark" };
  const ui = {
    theme: originalTheme,
    getTheme: () => referenceTheme,
    setTheme: (next: typeof originalTheme) => {
      ui.theme = next;
      return { success: true };
    },
    setWorkingMessage: (message?: string) => workingMessages.push(message),
    setTitle: () => {},
    setHeader: () => {},
    setFooter: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: (key: string, value: unknown) => widgets.set(key, value),
    setEditorComponent: (factory: unknown) => editorFactories.push(factory),
    notify: () => {},
  };
  const context = {
    mode: "tui",
    hasUI: true,
    cwd: process.cwd(),
    ui,
    getContextUsage: () => undefined,
  } as unknown as ExtensionContext;

  assert.ok(
    renderers.get(COMPLETION_ENTRY_TYPE)?.(
      {
        type: "custom",
        customType: COMPLETION_ENTRY_TYPE,
        id: "history",
        parentId: null,
        timestamp: new Date(0).toISOString(),
        data: { version: 1, durationMs: 1000, finishedAt: 1000, outcome: "done", failedTools: 0 },
      },
      { expanded: false },
      originalTheme as Theme,
    ),
    "Pi replays saved entries before session_start during resume/reload",
  );
  await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, context);
  assert.equal(typeof editorFactories.at(-1), "function");
  assert.equal(ui.theme, referenceTheme);

  const editorFactory = editorFactories.at(-1) as (
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
  ) => EditorComponent;
  const editor = editorFactory(
    {
      terminal: { rows: 40, write: () => {} },
      getShowHardwareCursor: () => false,
      setShowHardwareCursor: () => {},
      requestRender: () => {},
    } as unknown as TUI,
    { borderColor: (text: string) => text, selectList: {} } as EditorTheme,
    { matches: () => false } as unknown as KeybindingsManager,
  );
  assert.match(stripTerminalSequences(editor.render(60)[0] ?? ""), /^[-─]+$/);

  await handlers.get("agent_start")?.({ type: "agent_start" }, context);
  assert.equal(workingMessages.at(-1), "Working...");
  await handlers.get("message_update")?.(
    { assistantMessageEvent: { type: "thinking_delta" } },
    context,
  );
  assert.equal(workingMessages.at(-1), "Thinking...");
  await handlers.get("tool_execution_start")?.({ toolCallId: "read-a", toolName: "Read" }, context);
  await handlers.get("tool_execution_start")?.({ toolCallId: "read-b", toolName: "Read" }, context);
  assert.match(workingMessages.at(-1) ?? "", /^Running 2 tools/);
  await handlers.get("tool_execution_end")?.(
    { toolCallId: "read-a", result: { content: [] }, isError: false },
    context,
  );
  assert.match(workingMessages.at(-1) ?? "", /^Running Read/);
  await handlers.get("tool_execution_end")?.(
    { toolCallId: "read-b", result: { content: [] }, isError: false },
    context,
  );
  assert.equal(workingMessages.at(-1), "Working...");
  await handlers.get("agent_end")?.(
    { type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] },
    context,
  );
  assert.equal(entries.length, 0);
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, context);
  assert.equal(entries.length, 1);
  const completionRenderer = renderers.get(COMPLETION_ENTRY_TYPE);
  assert.ok(completionRenderer);
  const renderCompletion = () =>
    completionRenderer(entries[0], { expanded: false }, ui.theme as Theme);
  const completed = renderCompletion();
  assert.ok(completed);
  assert.match(stripTerminalSequences(completed.render(100)[0]), /Worked for.*done/);
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, context);
  assert.equal(entries.length, 1, "duplicate settlement must not append twice");
  await handlers.get("agent_start")?.({ type: "agent_start" }, context);
  assert.ok(renderCompletion(), "earlier completion remains visible during the next run");
  await handlers.get("agent_end")?.(
    { messages: [{ role: "assistant", stopReason: "aborted" }] },
    context,
  );
  await handlers.get("agent_settled")?.({}, context);
  assert.equal(entries.length, 2);
  const interrupted = completionRenderer(entries[1], { expanded: false }, ui.theme as Theme);
  assert.ok(interrupted);
  assert.match(interrupted.render(100)[0], /Interrupted/);
  const read = tools.find((tool) => tool.name === "read");
  const readContext = {
    args: { path: "fixture.ts" },
    cwd: process.cwd(),
    state: {},
    toolCallId: "mode-fixture",
    invalidate() {},
    isError: false,
  };
  const toolTheme = {
    fg: (_token: string, text: string) => text,
    bg: (_token: string, text: string) => text,
    bold: (text: string) => text,
  };
  const renderRead = () =>
    read
      ?.renderResult?.(
        { content: [{ type: "text", text: "first\nsecond" }], details: undefined },
        { expanded: false, isPartial: false },
        toolTheme as never,
        readContext as never,
      )
      .render(100);
  await commands.get("pituix-compact")?.handler("", context);
  assert.equal(renderRead()?.length, 1);
  assert.match(renderRead()?.[0] ?? "", /Read\(fixture.ts\) \[OK\]/);
  await commands.get("pituix-three-layer")?.handler("", context);
  assert.equal(renderRead()?.length, 2);
  assert.match(renderRead()?.[1] ?? "", /Read 2 lines/);
  assert.match(stripTerminalSequences(editor.render(60)[0] ?? ""), /^[-─]+$/);

  let toolRedraws = 0;
  const tool = tools.at(-1);
  tool?.renderCall?.(
    { path: "fixture", content: "example" },
    { fg: (_token: string, text: string) => text } as never,
    { toolCallId: "fixture", state: {}, invalidate: () => toolRedraws++ } as never,
  );
  await commands.get("pituix-mode")?.handler("collapsed", context);
  assert.equal(toolRedraws, 1);
  await commands.get("pituix-mode")?.handler("preview", context);
  assert.equal(toolRedraws, 2);
  await commands.get("pituix-default")?.handler("", context);
  assert.equal(renderCompletion(), undefined);
  assert.equal(toolRedraws, 3);
  assert.equal(editorFactories.at(-1), undefined);
  assert.equal(ui.theme, originalTheme);
  assert.equal(workingMessages.at(-1), undefined);
  assert.equal(commands.has("pituix-settings"), true);
  await handlers.get("agent_start")?.({}, context);
  await handlers.get("agent_end")?.(
    { messages: [{ role: "assistant", stopReason: "stop" }] },
    context,
  );
  await handlers.get("agent_settled")?.({}, context);
  assert.equal(entries.length, 2, "default UI does not create Pi-TUIX entries");
  await commands.get("pituix")?.handler("", context);
  assert.ok(renderCompletion(), "historical completion restores when re-enabled");
  await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, context);
  await commands.get("pituix-mode")?.handler("preview", context);
  assert.equal(toolRedraws, 4);
});

test("queue commands delegate steering and follow-ups to Pi", async () => {
  // biome-ignore lint/suspicious/noExplicitAny: Test mock types
  const handlers = new Map<string, (...args: any[]) => any>();
  // biome-ignore lint/suspicious/noExplicitAny: Test mock types
  const commands = new Map<string, { handler: (...args: any[]) => Promise<void> }>();
  const sent: unknown[] = [];
  const pi = {
    registerMarkdownTransformer: () => {},
    registerEntryRenderer: () => {},
    // biome-ignore lint/suspicious/noExplicitAny: Test mock types
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    // biome-ignore lint/suspicious/noExplicitAny: Test mock types
    registerCommand: (name: string, definition: { handler: (...args: any[]) => Promise<void> }) =>
      commands.set(name, definition),
    registerTool: () => {},
    sendUserMessage: (...args: unknown[]) => sent.push(args),
  } as unknown as ExtensionAPI;
  piTuix(pi);
  const ui = { theme: { fg: (_color: string, text: string) => text }, notify: () => {} };
  const context = {
    mode: "tui",
    ui,
    isIdle: () => false,
    hasPendingMessages: () => true,
  } as unknown as ExtensionContext;

  await commands.get("pituix-steer")?.handler("focus tests", context);
  await commands.get("pituix-followup")?.handler("then package", context);
  assert.deepEqual(sent, [
    ["focus tests", { deliverAs: "steer" }],
    ["then package", { deliverAs: "followUp" }],
  ]);
});

test("plan panel follows Pi-TUIX enable and default lifecycle", async () => {
  // biome-ignore lint/suspicious/noExplicitAny: Test mock types
  const handlers = new Map<string, (...args: any[]) => any>();
  // biome-ignore lint/suspicious/noExplicitAny: Test mock types
  const commands = new Map<string, { handler: (...args: any[]) => Promise<void> }>();
  const widgets: unknown[] = [];
  const pi = {
    registerMarkdownTransformer: () => {},
    registerEntryRenderer: () => {},
    // biome-ignore lint/suspicious/noExplicitAny: Test mock types
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    // biome-ignore lint/suspicious/noExplicitAny: Test mock types
    registerCommand: (name: string, definition: { handler: (...args: any[]) => Promise<void> }) =>
      commands.set(name, definition),
    registerTool: () => {},
  } as unknown as ExtensionAPI;
  piTuix(pi);
  const ui = {
    theme: { fg: (_color: string, text: string) => text },
    setTitle: () => {},
    setHeader: () => {},
    setFooter: () => {},
    setEditorComponent: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    notify: () => {},
    setWidget: (_key: string, value: unknown) => widgets.push(value),
  };
  const context = {
    mode: "tui",
    hasUI: true,
    cwd: process.cwd(),
    ui,
    getContextUsage: () => undefined,
  } as unknown as ExtensionContext;

  await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, context);
  await handlers.get("turn_end")?.(
    {
      type: "turn_end",
      turnIndex: 0,
      toolResults: [],
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Plan:\n1. Inspect\n2. Test" }],
      },
    },
    context,
  );
  assert.equal(typeof widgets.at(-1), "function");

  await commands.get("pituix-default")?.handler("", context);
  assert.equal(widgets.at(-1), undefined);
  await commands.get("pituix-plan")?.handler("show", context);
  assert.equal(widgets.at(-1), undefined);
});
