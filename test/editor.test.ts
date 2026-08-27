import assert from "node:assert/strict";
import test from "node:test";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  type EditorTheme,
  stripTerminalSequences,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  createEditorChromeRuntime,
  createPiTuixEditor,
  detachEditorChrome,
  fitStatusBorder,
  setEditorWorking,
} from "../extensions/shell/editor.ts";

const color = (text: string) => `\u001b[36m${text}\u001b[39m`;

function createTui() {
  let renders = 0;
  const tui = {
    terminal: { rows: 40 },
    requestRender: () => {
      renders += 1;
    },
  } as TUI;
  return { tui, renderCount: () => renders };
}

const editorTheme = {
  borderColor: color,
  selectList: {},
} as EditorTheme;

const keybindings = {
  matches: () => false,
} as unknown as KeybindingsManager;

test("status border remains ANSI-aware at narrow and normal widths", () => {
  for (const width of [1, 12, 24, 80]) {
    const line = fitStatusBorder(color(" PI-TUIX "), color(" WORKING | 2L 12C "), width, color);
    assert.equal(visibleWidth(line), width);
  }

  const normal = stripTerminalSequences(
    fitStatusBorder(color(" PI-TUIX "), color(" WORKING | 2L 12C "), 80, color),
  );
  assert.match(normal, /PI-TUIX/);
  assert.match(normal, /WORKING \| 2L 12C/);
});

test("Pi-TUIX editor preserves CustomEditor text input behavior", () => {
  const runtime = createEditorChromeRuntime();
  const { tui } = createTui();
  const editor = createPiTuixEditor(tui, editorTheme, keybindings, runtime);

  editor.setText("first\nsecond");
  editor.handleInput("!");

  assert.equal(editor.getText(), "first\nsecond!");
  const lines = editor.render(60);
  assert.ok(lines.every((line) => visibleWidth(line) <= 60));
  assert.match(stripTerminalSequences(lines[0] ?? ""), /PI-TUIX/);
  assert.match(stripTerminalSequences(lines[0] ?? ""), /READY \| 2L 13C/);
});

test("working state redraws the active editor and detach clears runtime state", () => {
  const runtime = createEditorChromeRuntime();
  const { tui, renderCount } = createTui();
  const editor = createPiTuixEditor(tui, editorTheme, keybindings, runtime);

  setEditorWorking(runtime, true);
  assert.equal(renderCount(), 1);
  assert.match(stripTerminalSequences(editor.render(50)[0] ?? ""), /WORKING/);

  detachEditorChrome(runtime);
  assert.equal(runtime.working, false);
  assert.equal(runtime.activeTui, undefined);
});
