import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  discoverAndLoadExtensions,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  CURSOR_MARKER,
  type EditorTheme,
  setKeybindings,
  stripTerminalSequences,
  type TUI,
  TUI_KEYBINDINGS,
  KeybindingsManager as TuiKeybindingsManager,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../extensions/shell/open-tui/config.ts";
import { OpenTuiEditor, renderPromptRule } from "../extensions/shell/open-tui/editor.ts";
import { renderEffortLine } from "../extensions/shell/open-tui/effort.ts";
import { installFooter } from "../extensions/shell/open-tui/footer.ts";
import { OpenTuiHeader } from "../extensions/shell/open-tui/header.ts";
import { createInitialState } from "../extensions/shell/open-tui/state.ts";

const paint = (s: string) => `\x1b[38;2;153;153;153m${s}\x1b[39m`;
const theme = { fg: (_token: string, s: string) => paint(s), bold: paint } as Theme;
const tui = {
  terminal: { rows: 40, write: () => {} },
  requestRender: () => {},
  getShowHardwareCursor: () => false,
  setShowHardwareCursor: () => {},
} as unknown as TUI;
const keys = new TuiKeybindingsManager({
  ...TUI_KEYBINDINGS,
  "app.tools.expand": { defaultKeys: "ctrl+o" },
  "app.interrupt": { defaultKeys: "escape" },
  "app.thinking.cycle": { defaultKeys: "shift+tab" },
});
setKeybindings(keys);
// npm may install a nested copy even at the same version. Initialize the public
// runtime resolved by the host as well, just as Pi's loader does in production.
const hostRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const hostTui = await import(pathToFileURL(hostRequire.resolve("@earendil-works/pi-tui")).href);
hostTui.setKeybindings(keys);

function editor(ascii = false) {
  return new OpenTuiEditor(
    tui,
    { borderColor: paint, selectList: {} } as EditorTheme,
    keys as unknown as KeybindingsManager,
    "block",
    ascii,
  );
}

test("compact startup identity remains bounded with ANSI, CJK and tiny terminals", () => {
  const header = new OpenTuiHeader(
    { getThinkingLevel: () => "high" } as ExtensionAPI,
    {
      ui: { theme },
      cwd: "/workspace/中文/very-long-directory",
      model: { name: "Model", id: "model" },
    } as unknown as ExtensionContext,
    tui,
  );
  for (const width of [0, 1, 2, 12, 24, 40, 80, 120]) {
    const lines = header.render(width);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
    assert.ok(lines.length <= 5);
  }
  assert.match(header.render(80).map(stripTerminalSequences).join("\n"), /Pi-TUIX/);
});

test("prompt rules and editor retain input and cursor across resize and ASCII fallback", () => {
  for (const ascii of [false, true]) {
    const input = editor(ascii);
    input.focused = true;
    input.setText("中文 first\nsecond");
    input.handleInput("!");
    assert.equal(input.getText(), "中文 first\nsecond!");
    for (const width of [0, 1, 2, 3, 4, 12, 24, 80, 120]) {
      const lines = input.render(width);
      assert.ok(
        lines.every((line) => visibleWidth(line) <= width),
        `overflow at ${width}`,
      );
      assert.equal(visibleWidth(renderPromptRule(width, paint, "↑ 12 more", ascii)), width);
    }
    const lines = input.render(80);
    assert.match(stripTerminalSequences(lines[1] ?? ""), ascii ? /^> / : /^❯ /);
    assert.ok(lines.join("").includes(CURSOR_MARKER));
    assert.ok(!lines.map(stripTerminalSequences).join("").includes("│"));
  }
});

test("empty-input help toggles without submitting text and ordinary question marks are preserved", () => {
  const input = editor();
  input.handleInput("?");
  assert.equal(input.getText(), "");
  assert.match(input.render(100).map(stripTerminalSequences).join("\n"), /ctrl\+o expand tools/);
  input.handleInput("\x1b");
  assert.doesNotMatch(input.render(100).map(stripTerminalSequences).join("\n"), /expand tools/);
  input.setIconMode("ascii");
  assert.match(stripTerminalSequences(input.render(80)[1] ?? ""), /^> /);
  input.setIconMode("nerd");
  assert.match(stripTerminalSequences(input.render(80)[1] ?? ""), /^❯ /);
  input.setText("why");
  input.handleInput("?");
  assert.equal(input.getText(), "why?");
});

test("compact footer displays running hints and context pressure without width overflow", () => {
  let component: Component | undefined;
  let percent = 20;
  let settingsOpen = false;
  const state = createInitialState();
  const ctx = {
    model: { contextWindow: 100000 },
    getContextUsage: () => ({ percent, tokens: percent * 1000, contextWindow: 100000 }),
    ui: {
      setFooter: (factory: Parameters<ExtensionContext["ui"]["setFooter"]>[0]) => {
        component = factory?.(tui, theme, {
          onBranchChange: () => () => {},
          getExtensionStatuses: () => new Map(),
        } as never);
      },
    },
  } as unknown as ExtensionContext;
  const cleanup = installFooter(
    ctx,
    () => state,
    () => DEFAULT_CONFIG,
    () => ({ model: "test-model", provider: "test", effort: "high" }),
    {
      setRequestRender: () => {},
      scheduleGitRefresh: () => {},
      isSettingsOpen: () => settingsOpen,
    },
  );
  assert.ok(component);
  assert.equal(component.render(100).length, 1);
  assert.match(stripTerminalSequences(component.render(100)[0] ?? ""), /\? for shortcuts/);
  settingsOpen = true;
  assert.deepEqual(component.render(100), []);
  settingsOpen = false;
  assert.equal(component.render(100).length, 1);
  state.workingSince = Date.now();
  assert.match(stripTerminalSequences(component.render(100)[0] ?? ""), /esc.*to interrupt/);
  assert.match(stripTerminalSequences(component.render(24)[0] ?? ""), /interrupt/);
  percent = 96;
  assert.match(stripTerminalSequences(component.render(100)[0] ?? ""), /96% CRITICAL/);
  for (const width of [1, 2, 12, 24, 80, 120]) {
    assert.ok(component.render(width).every((line) => visibleWidth(line) <= width));
  }
  cleanup();
  assert.equal(component, undefined);
});

test("extension loads through Pi's public loader with all presentation commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pituix-loader-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const result = await discoverAndLoadExtensions([resolve("extensions/index.ts")], dir, dir);
    assert.deepEqual(result.errors, []);
    assert.equal(result.extensions.length, 1);
    const extension = result.extensions[0];
    assert.ok(extension?.commands.has("pituix-status"));
    assert.ok(extension?.commands.has("pituix-default"));
    assert.equal(extension?.tools.size, 4);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("effective thinking level sits above the prompt rule and remains right aligned", () => {
  const state = { enabled: true, level: "high", ascii: false };
  const input = new OpenTuiEditor(
    tui,
    { borderColor: paint, selectList: {} } as EditorTheme,
    keys as unknown as KeybindingsManager,
    "block",
    false,
    (width) => renderEffortLine(state, theme, width),
  );
  const lines = input.render(100).map(stripTerminalSequences);
  assert.match(lines[0], /◉ high · shift\+tab $/);
  assert.match(lines[1], /^─+$/);
  assert.equal(visibleWidth(lines[0]), 100);
  state.level = "xhigh";
  assert.match(stripTerminalSequences(input.render(100)[0]), /xhigh/);
  for (const width of [0, 1, 4, 8, 12, 24, 80, 120]) {
    assert.ok(input.render(width).every((line) => visibleWidth(line) <= width));
  }
  state.enabled = false;
  assert.match(stripTerminalSequences(input.render(100)[0]), /^─+$/);
});
