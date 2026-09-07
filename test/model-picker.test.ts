import assert from "node:assert/strict";
import test from "node:test";
import {
  getSupportedThinkingLevels,
  type Model,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  getModelChoices,
  ModelPicker,
  type ModelSelection,
  registerModelPicker,
} from "../extensions/control/model-picker.ts";

function model(id: string, reasoning = true): Model<"anthropic-messages"> {
  return {
    id,
    name: `Model ${id}`,
    provider: "fixture",
    api: "anthropic-messages",
    baseUrl: "https://example.invalid",
    reasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8000,
  };
}
const models = [model("first"), model("second"), model("plain", false)];
const theme = {
  fg: (_color: string, text: string) => `\x1b[36m${text}\x1b[39m`,
  bold: (text: string) => text,
} as Theme;
function setup(rows = 40, ascii = false, choices = models.map((model) => ({ model }))) {
  const results: (ModelSelection | undefined)[] = [];
  const view = new ModelPicker({
    choices,
    current: models[1],
    thinkingLevel: "high",
    theme,
    ascii,
    getRows: () => rows,
    done: (value) => results.push(value),
  });
  return { view, results };
}
const text = (view: ModelPicker, width = 100) =>
  view.render(width).map(stripTerminalSequences).join("\n");

test("model picker reads scoped models without resolving credentials or enumerating outside scope", () => {
  let enumerated = 0;
  const ctx = {
    scopedModels: [
      { model: models[1], thinkingLevel: "low" },
      { model: models[1], thinkingLevel: "low" },
    ],
    modelRegistry: {
      getAvailable: () => {
        enumerated++;
        return models;
      },
    },
  } as unknown as ExtensionContext;
  assert.deepEqual(getModelChoices(ctx), [{ model: models[1], thinkingLevel: "low" }]);
  assert.equal(enumerated, 0);
  ctx.scopedModels = [];
  assert.equal(getModelChoices(ctx).length, 3);
  assert.equal(enumerated, 1);
});

test("model picker stages effort until confirmation and cancellation makes no selection", () => {
  const { view, results } = setup();
  assert.match(text(view), /❯ 2\. Model second ✔/);
  const levels = getSupportedThinkingLevels(models[1]);
  view.handleInput("\x1b[D");
  const expected = levels[Math.max(0, levels.indexOf("high") - 1)];
  assert.match(text(view), new RegExp(`${expected} effort`));
  assert.equal(results.length, 0);
  view.handleInput("\r");
  view.handleInput("\r");
  assert.deepEqual(results, [{ model: models[1], thinkingLevel: expected }]);
  const canceled = setup();
  canceled.view.handleInput("\x1b[C");
  canceled.view.handleInput("\x1b");
  assert.deepEqual(canceled.results, [undefined]);
});

test("model changes use public thinking capabilities, preserve drafts per row and wrap selection", () => {
  const { view, results } = setup();
  view.handleInput("\x1b[D");
  const draft = text(view).match(/(\w+) effort/)?.[1];
  view.handleInput("\x1b[B");
  assert.match(text(view), /off effort/);
  assert.doesNotMatch(text(view), /to adjust/);
  view.handleInput("\x1b[C");
  view.handleInput("\x1b[B");
  assert.match(text(view), /❯ 1\./);
  view.handleInput("2");
  assert.match(text(view), new RegExp(`${draft} effort`));
  view.handleInput("3");
  view.handleInput("\r");
  assert.deepEqual(results, [{ model: models[2], thinkingLevel: "off" }]);
});

test("model picker constrains ANSI and CJK rows and keeps the selected model in short views", () => {
  const choices = Array.from({ length: 30 }, (_, index) => ({
    model: { ...model(String(index)), name: `中文 Model ${index} very long label` },
  }));
  for (const rows of [1, 3, 4, 8, 12, 20, 40])
    for (const ascii of [true, false]) {
      const { view } = setup(rows, ascii, choices);
      for (let i = 0; i < 29; i++) view.handleInput("\x1b[B");
      for (const width of [0, 1, 2, 12, 24, 40, 80, 100, 120]) {
        const lines = view.render(width);
        assert.ok(lines.length <= rows);
        assert.ok(
          lines.every((line) => visibleWidth(line) <= width),
          `${width}x${rows}`,
        );
        if (width >= 24) assert.match(lines.join("\n"), /[>❯] 30\./);
      }
    }
  const { view, results } = setup(40, false, []);
  assert.match(text(view), /No models available/);
  view.handleInput("\r");
  assert.equal(results.length, 0);
  view.handleInput("\x1b");
  assert.deepEqual(results, [undefined]);
});

test("model selection delegates once to Pi and applies effort only after a successful switch", async () => {
  for (const success of [true, false]) {
    let command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> } | undefined;
    const calls: unknown[] = [];
    const pi = {
      registerCommand: (_name: string, definition: typeof command) => (command = definition),
      setModel: async (value: unknown) => {
        calls.push(value);
        return success;
      },
      setThinkingLevel: (level: ModelThinkingLevel) => calls.push(level),
    } as unknown as ExtensionAPI;
    registerModelPicker(pi, {
      ascii: () => false,
      onOpen: () => calls.push("open"),
      onClose: () => calls.push("close"),
    });
    const ctx = {
      hasUI: true,
      ui: {
        custom: async () => ({ model: models[1], thinkingLevel: "low" }),
        notify: (message: string) => calls.push(message),
      },
    } as unknown as ExtensionContext;
    assert.ok(command);
    await command.handler("", ctx);
    assert.deepEqual(calls.slice(0, 3), ["open", "close", models[1]]);
    if (success) assert.equal(calls[3], "low");
    else {
      assert.match(String(calls[3]), /credentials/);
      assert.ok(!calls.includes("low"));
    }
  }
});

test("cancellation and failed custom views restore shell without changing the host model", async () => {
  for (const reject of [false, true]) {
    let command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> } | undefined;
    const calls: string[] = [];
    const pi = {
      registerCommand: (_name: string, definition: typeof command) => (command = definition),
      setModel: async () => {
        calls.push("model");
        return true;
      },
    } as unknown as ExtensionAPI;
    registerModelPicker(pi, {
      ascii: () => false,
      onOpen: () => calls.push("open"),
      onClose: () => calls.push("close"),
    });
    const ctx = {
      hasUI: true,
      ui: {
        custom: async () => {
          if (reject) throw new Error("view failed");
          return undefined;
        },
      },
    } as unknown as ExtensionContext;
    assert.ok(command);
    if (reject) await assert.rejects(command.handler("", ctx), /view failed/);
    else await command.handler("", ctx);
    assert.deepEqual(calls, ["open", "close"]);
  }
});
