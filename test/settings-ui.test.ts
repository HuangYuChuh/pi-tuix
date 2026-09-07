import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG, type OpenTuiConfig } from "../extensions/shell/open-tui/config.ts";
import {
  registerSettingsCommand,
  SettingsUi,
} from "../extensions/shell/open-tui/settings-command.ts";

const theme = {
  fg: (_color: string, s: string) => `\x1b[38;2;177;185;249m${s}\x1b[39m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  inverse: (s: string) => `\x1b[7m${s}\x1b[27m`,
} as Theme;

function setup(config: OpenTuiConfig = structuredClone(DEFAULT_CONFIG), rows = 40) {
  const changes: OpenTuiConfig[] = [];
  let closed = 0;
  const ui = new SettingsUi(
    theme,
    config,
    (next) => changes.push(next),
    () => closed++,
    () => rows,
  );
  return { ui, changes, closed: () => closed };
}
const text = (ui: SettingsUi, width = 100) =>
  ui.render(width).map(stripTerminalSequences).join("\n");

test("settings search selects before changing and Escape clears then leaves search before closing", () => {
  const { ui, changes, closed } = setup();
  assert.match(text(ui), /Search settings/);
  assert.ok(ui.render(100).join("").includes(CURSOR_MARKER));
  ui.handleInput("enabled");
  assert.match(text(ui), /Enabled/);
  assert.doesNotMatch(text(ui), /Language/);
  ui.handleInput("\r");
  assert.equal(changes.length, 0);
  ui.handleInput("\r");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].enabled, false);
  ui.handleInput("/");
  ui.handleInput("\x1b");
  assert.match(text(ui), /Language/);
  assert.equal(closed(), 0);
  ui.handleInput("\x1b");
  assert.equal(closed(), 0);
  ui.handleInput("\x1b");
  assert.equal(closed(), 1);
});

test("tabs preserve a selected row, and filtered settings mutate only the matching preference", () => {
  const { ui, changes } = setup();
  ui.handleInput("\t");
  ui.handleInput("\x1b[B");
  ui.handleInput("cursor");
  assert.doesNotMatch(text(ui), /Icon mode/);
  ui.handleInput("\r");
  ui.handleInput(" ");
  assert.equal(changes.at(-1)?.cursorStyle, "bar");
  assert.deepEqual(changes.at(-1)?.icons, DEFAULT_CONFIG.icons);
  ui.handleInput("\t");
  ui.handleInput("\x1b[B");
  ui.handleInput("layout");
  ui.handleInput("\r");
  ui.handleInput("\r");
  assert.equal(changes.at(-1)?.footerStyle, "detailed");
  assert.deepEqual(changes.at(-1)?.footerSegments, DEFAULT_CONFIG.footerSegments);
  ui.handleInput("\x1b[Z");
  ui.handleInput("\x1b[B");
  ui.handleInput("\r");
  assert.match(text(ui), /[>❯] Cursor style/);
});

test("settings empty matches, Chinese search, ASCII chrome and width limits", () => {
  for (const settingsLanguage of ["en", "zh"] as const) {
    for (const mode of ["ascii", "nerd"] as const) {
      const config = { ...structuredClone(DEFAULT_CONFIG), settingsLanguage, icons: { mode } };
      const { ui, changes } = setup(config, 24);
      ui.handleInput("no-setting-matches-this-query");
      assert.match(text(ui), settingsLanguage === "en" ? /No matching settings/ : /没有匹配/);
      ui.handleInput("\r");
      assert.equal(changes.length, 0);
      for (const width of [0, 1, 2, 8, 12, 24, 40, 60, 80, 100, 120]) {
        assert.ok(
          ui.render(width).every((line) => visibleWidth(line) <= width),
          `overflow at ${width}`,
        );
      }
      ui.handleInput("\x1b");
      ui.handleInput(settingsLanguage === "zh" ? "语言" : "language");
      assert.match(text(ui), settingsLanguage === "zh" ? /语言/ : /Language/);
      assert.equal(ui.render(100)[0]?.includes("▔"), mode !== "ascii");
    }
  }
});

test("settings values align and keyboard selection remains visible while scrolling", () => {
  const { ui } = setup(undefined, 20);
  ui.handleInput("\t");
  ui.handleInput("\t");
  ui.handleInput("\x1b[B");
  ui.handleInput("\r");
  for (let i = 0; i < 10; i++) ui.handleInput("\x1b[B");
  assert.match(text(ui), /[>❯] Extension status line/);
  assert.match(text(ui), /more above/);
  const row = text(ui)
    .split("\n")
    .find((line) => /[>❯] Extension status line/.test(line));
  assert.equal(row?.indexOf("On"), 48);
});

test("short terminal layouts retain the selected preference without exceeding height", () => {
  for (const rows of [1, 3, 4, 8, 12, 14, 20, 24, 40]) {
    const { ui } = setup(undefined, rows);
    ui.handleInput("\t");
    ui.handleInput("\t");
    ui.handleInput("\x1b[B");
    ui.handleInput("\r");
    for (let i = 0; i < 10; i++) ui.handleInput("\x1b[B");
    for (const width of [1, 8, 24, 40, 80, 100]) {
      const rendered = ui.render(width);
      assert.ok(rendered.length <= rows, `${width}x${rows} height overflow`);
      assert.ok(rendered.every((line) => visibleWidth(line) <= width));
      if (width >= 24) assert.match(rendered.join("\n"), /[>❯] Exten/);
    }
  }
});

test("settings lifecycle restores the shell even when the custom view rejects", async () => {
  let command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> } | undefined;
  const pi = {
    registerCommand: (_name: string, definition: typeof command) => {
      command = definition;
    },
  } as unknown as ExtensionAPI;
  const events: string[] = [];
  registerSettingsCommand(pi, {
    getConfig: () => structuredClone(DEFAULT_CONFIG),
    onConfigChanged: () => {},
    onOverlayOpened: () => events.push("open"),
    onOverlayClosed: () => events.push("closed"),
  });
  const ctx = {
    hasUI: true,
    ui: {
      custom: async () => {
        throw new Error("view failed");
      },
    },
  } as unknown as ExtensionContext;
  assert.ok(command);
  await assert.rejects(command.handler("", ctx), /view failed/);
  assert.deepEqual(events, ["open", "closed"]);
});
