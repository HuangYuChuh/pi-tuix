import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  type EditorTheme,
  stripTerminalSequences,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

export interface EditorChromeRuntime {
  working: boolean;
  activeTui: TUI | undefined;
}

export function fitStatusBorder(
  left: string,
  right: string,
  width: number,
  border: (text: string) => string,
): string {
  if (width <= 0) return "";
  if (width === 1) return border("-");

  let leftText = left;
  let rightText = right;
  const fixedWidth = 2;
  const minimumGap = 1;

  while (
    fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
    visibleWidth(leftText) > 0
  ) {
    leftText = truncateToWidth(leftText, Math.max(0, visibleWidth(leftText) - 1), "");
  }
  while (
    fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
    visibleWidth(rightText) > 0
  ) {
    rightText = truncateToWidth(rightText, Math.max(0, visibleWidth(rightText) - 1), "");
  }

  const gap = Math.max(0, width - fixedWidth - visibleWidth(leftText) - visibleWidth(rightText));
  return `${border("-")}${leftText}${border("-".repeat(gap))}${rightText}${border("-")}`;
}

function editorStats(text: string): string {
  const lines = text.split("\n").length;
  return `${lines}L ${text.length}C`;
}

function scrollLabel(line: string): string | undefined {
  const match = stripTerminalSequences(line).match(/↑\s*(\d+)/);
  return match?.[1] ? ` SCROLL ${match[1]} ` : undefined;
}

export class PiTuixEditor extends CustomEditor {
  private runtime: EditorChromeRuntime;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    runtime: EditorChromeRuntime,
  ) {
    super(tui, theme, keybindings);
    this.runtime = runtime;
  }

  render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length === 0) return lines;

    const left = scrollLabel(lines[0] ?? "") ?? " PI-TUIX ";
    const state = this.runtime.working ? "WORKING" : "READY";
    const right = ` ${state} | ${editorStats(this.getText())} `;
    lines[0] = fitStatusBorder(left, right, width, (text) => this.borderColor(text));
    return lines;
  }
}

export function createEditorChromeRuntime(): EditorChromeRuntime {
  return { working: false, activeTui: undefined };
}

export function setEditorWorking(runtime: EditorChromeRuntime, working: boolean): void {
  runtime.working = working;
  runtime.activeTui?.requestRender();
}

export function detachEditorChrome(runtime: EditorChromeRuntime): void {
  runtime.working = false;
  runtime.activeTui = undefined;
}

export function createPiTuixEditor(
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager,
  runtime: EditorChromeRuntime,
): PiTuixEditor {
  runtime.activeTui = tui;
  return new PiTuixEditor(tui, theme, keybindings, runtime);
}
