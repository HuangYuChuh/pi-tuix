import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  type EditorComponent,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import piTuix from "../extensions/index.ts";

test("Pi-TUIX installs and reverses its editor component in the active session", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, { handler: (...args: any[]) => Promise<void> }>();
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    registerCommand: (name: string, definition: { handler: (...args: any[]) => Promise<void> }) =>
      commands.set(name, definition),
    registerTool: () => {},
    sendUserMessage: () => {},
  } as unknown as ExtensionAPI;

  piTuix(pi);

  const editorFactories: unknown[] = [];
  const ui = {
    theme: {
      fg: (_color: string, text: string) => text,
    },
    setTitle: () => {},
    setHeader: () => {},
    setFooter: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setEditorComponent: (factory: unknown) => editorFactories.push(factory),
    notify: () => {},
  };
  const context = { mode: "tui", ui, getContextUsage: () => undefined } as unknown as ExtensionContext;

  await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, context);
  assert.equal(typeof editorFactories.at(-1), "function");

  const editorFactory = editorFactories.at(-1) as (
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
  ) => EditorComponent;
  const editor = editorFactory(
    { terminal: { rows: 40 }, requestRender: () => {} } as TUI,
    { borderColor: (text: string) => text, selectList: {} } as EditorTheme,
    { matches: () => false } as unknown as KeybindingsManager,
  );
  assert.match(stripTerminalSequences(editor.render(60)[0] ?? ""), /READY/);

  await handlers.get("agent_start")?.({ type: "agent_start" }, context);
  assert.match(stripTerminalSequences(editor.render(60)[0] ?? ""), /WORKING/);

  await handlers.get("agent_end")?.({ type: "agent_end" }, context);
  assert.match(stripTerminalSequences(editor.render(60)[0] ?? ""), /READY/);

  await commands.get("pituix-default")?.handler("", context);
  assert.equal(editorFactories.at(-1), undefined);
});

test("queue commands delegate steering and follow-ups to Pi", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, { handler: (...args: any[]) => Promise<void> }>();
  const sent: unknown[] = [];
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    registerCommand: (name: string, definition: { handler: (...args: any[]) => Promise<void> }) => commands.set(name, definition),
    registerTool: () => {},
    sendUserMessage: (...args: unknown[]) => sent.push(args),
  } as unknown as ExtensionAPI;
  piTuix(pi);
  const ui = { theme: { fg: (_color: string, text: string) => text }, notify: () => {} };
  const context = { mode: "tui", ui, isIdle: () => false, hasPendingMessages: () => true } as unknown as ExtensionContext;

  await commands.get("pituix-steer")?.handler("focus tests", context);
  await commands.get("pituix-followup")?.handler("then package", context);
  assert.deepEqual(sent, [["focus tests", { deliverAs: "steer" }], ["then package", { deliverAs: "followUp" }]]);
});

test("plan panel follows Pi-TUIX enable and default lifecycle", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, { handler: (...args: any[]) => Promise<void> }>();
  const widgets: unknown[] = [];
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
    registerCommand: (name: string, definition: { handler: (...args: any[]) => Promise<void> }) => commands.set(name, definition),
    registerTool: () => {},
  } as unknown as ExtensionAPI;
  piTuix(pi);
  const ui = {
    theme: { fg: (_color: string, text: string) => text },
    setTitle: () => {}, setHeader: () => {}, setFooter: () => {}, setEditorComponent: () => {},
    setWorkingIndicator: () => {}, setHiddenThinkingLabel: () => {}, notify: () => {},
    setWidget: (_key: string, value: unknown) => widgets.push(value),
  };
  const context = { mode: "tui", ui, getContextUsage: () => undefined } as unknown as ExtensionContext;

  await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, context);
  await handlers.get("turn_end")?.({
    type: "turn_end", turnIndex: 0, toolResults: [],
    message: { role: "assistant", content: [{ type: "text", text: "Plan:\n1. Inspect\n2. Test" }] },
  }, context);
  assert.equal(typeof widgets.at(-1), "function");

  await commands.get("pituix-default")?.handler("", context);
  assert.equal(widgets.at(-1), undefined);
  await commands.get("pituix-plan")?.handler("show", context);
  assert.equal(widgets.at(-1), undefined);
});
