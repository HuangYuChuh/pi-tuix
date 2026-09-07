import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  keyText,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CursorStyle } from "./config.ts";
import {
  applyFullscreenWheelScrollLines,
  DEFAULT_FULLSCREEN_WHEEL_SCROLL_LINES,
} from "./fullscreen-scroll.ts";
import { type IconMode, useAsciiChrome } from "./icons.ts";
import { findBottomBorderIndex, isEditorBorderLine, stripAnsi } from "./utils.ts";

function fillLine(content: string, width: number): string {
  const truncated = truncateToWidth(content, Math.max(0, width), "");
  const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
  return `${truncated}${pad}`;
}

const CURSOR_STYLE_SEQUENCES: Partial<Record<CursorStyle, string>> = {
  bar: "\x1b[6 q",
  underline: "\x1b[4 q",
};
const DEFAULT_CURSOR_STYLE_SEQUENCE = "\x1b[0 q";

function removeSoftwareCursor(line: string, cursorMarker = ""): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matches terminal SGR cursor styling.
  return line.replace(/\x1b\[7m([\s\S]*?)\x1b\[0m/g, (_match, cursor: string) => {
    const replacement = `${cursorMarker}${cursor}`;
    cursorMarker = "";
    return replacement;
  });
}

function configureCursor(tui: TUI, cursorStyle: CursorStyle): void {
  if (cursorStyle === "block") return;
  tui.setShowHardwareCursor(true);
  const sequence = CURSOR_STYLE_SEQUENCES[cursorStyle];
  if (sequence) tui.terminal.write(sequence);
}

export function renderPromptRule(
  width: number,
  paint: (s: string) => string,
  sourceLine = "",
  ascii = false,
): string {
  const safeWidth = Math.max(0, width);
  const scroll = stripAnsi(sourceLine).match(/([↑↓]\s+\d+\s+more)/)?.[1];
  const label = scroll ? `--- ${scroll} ` : "";
  return paint(truncateToWidth(label + (ascii ? "-" : "─").repeat(safeWidth), safeWidth, ""));
}

export class OpenTuiEditor extends CustomEditor {
  private helpVisible = false;
  private ascii: boolean;
  private readonly getBorder: (s: string) => string;
  private cursorStyle: CursorStyle;
  private previewHardwareCursor = false;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    cursorStyle: CursorStyle = "block",
    ascii = useAsciiChrome(),
  ) {
    super(tui, editorTheme, keybindings, { paddingX: 0 });
    this.cursorStyle = cursorStyle;
    this.ascii = ascii;
    configureCursor(tui, cursorStyle);
    // ponytail: route the frame through this.borderColor so Pi can recolor it
    // via updateEditorBorderColor() — bash mode ("! " prefix → green) and
    // thinking-level borders both flow through this one property.

    this.getBorder = (s: string) => this.borderColor(s);
  }

  setIconMode(mode: IconMode): void {
    this.ascii = useAsciiChrome(mode);
    this.tui.requestRender();
  }

  override setPaddingX(_padding: number): void {
    // The custom rail owns the horizontal inset and keeps one stable text gap.
    super.setPaddingX(0);
  }

  setCursorStyle(cursorStyle: CursorStyle, blockHardwareCursor = false): void {
    const styleChanged = cursorStyle !== this.cursorStyle;
    this.previewHardwareCursor = cursorStyle !== "block";
    this.cursorStyle = cursorStyle;
    if (styleChanged) {
      if (cursorStyle === "block") {
        this.tui.terminal.write(DEFAULT_CURSOR_STYLE_SEQUENCE);
        this.tui.setShowHardwareCursor(blockHardwareCursor);
      } else {
        configureCursor(this.tui, cursorStyle);
      }
    }
    this.tui.requestRender();
  }

  private renderBase(width: number): string[] {
    // Pi 0.84 can recurse while wrapping a wide glyph into a one-cell editor.
    // Render a safe minimum and clip our surface for extremely narrow terminals.
    const renderedLines = super.render(Math.max(4, width));
    if (this.cursorStyle === "block") return renderedLines;

    // A focused overlay suppresses the editor's cursor marker. Preserve its
    // position only for the live settings preview, then clear it on refocus.
    let cursorMarker = this.previewHardwareCursor && !this.focused ? CURSOR_MARKER : "";
    if (this.focused) this.previewHardwareCursor = false;
    return renderedLines.map((line) => {
      const rendered = removeSoftwareCursor(line, cursorMarker);
      if (rendered !== line) cursorMarker = "";
      return rendered;
    });
  }

  override handleInput(data: string): void {
    if (data === "?" && this.getText() === "") {
      this.helpVisible = !this.helpVisible;
      this.tui.requestRender();
      return;
    }
    if (this.helpVisible && data === "\u001b") {
      this.helpVisible = false;
      this.tui.requestRender();
      return;
    }
    this.helpVisible = false;
    super.handleInput(data);
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    if (width < 4) return this.renderBase(width).map((line) => truncateToWidth(line, width, ""));
    const innerWidth = width - 2;
    const baseLines = this.renderBase(innerWidth);
    const bottomIdx = findBottomBorderIndex(baseLines);
    const result = [renderPromptRule(width, this.getBorder, baseLines[0], this.ascii)];
    for (let i = 1; i < bottomIdx; i++) {
      const line = baseLines[i] ?? "";
      const prefix = i === 1 ? this.getBorder(this.ascii ? "> " : "❯ ") : "  ";
      result.push(prefix + fillLine(isEditorBorderLine(line) ? "" : line, innerWidth));
    }
    result.push(renderPromptRule(width, this.getBorder, baseLines[bottomIdx], this.ascii));
    // Autocomplete belongs to Pi; keep its rows after the input rules.
    result.push(...baseLines.slice(bottomIdx + 1));
    if (this.helpVisible) {
      result.push(
        "  / commands    @ file paths    ! shell",
        `  ${keyText("app.tools.expand")} expand tools    ${keyText("app.interrupt")} interrupt`,
        "  /pituix-settings appearance    /pituix-default restore Pi",
        "  /pituix-steer steer    /pituix-followup queue",
        "  ? or esc close help",
      );
    }
    return result.map((line) => truncateToWidth(line, width, ""));
  }
}

export function installEditor(
  _pi: ExtensionAPI,
  ctx: ExtensionContext,
  cursorStyle: CursorStyle = "block",
  wheelScrollLines = DEFAULT_FULLSCREEN_WHEEL_SCROLL_LINES,
  iconMode: IconMode = "auto",
) {
  let activeTui: TUI | undefined;
  let activeEditor: OpenTuiEditor | undefined;
  let previousHardwareCursor: boolean | undefined;
  let currentIconMode = iconMode;
  let currentCursorStyle = cursorStyle;
  let currentWheelScrollLines = wheelScrollLines;

  ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
    activeTui = tui;
    applyFullscreenWheelScrollLines(tui, currentWheelScrollLines);
    previousHardwareCursor = tui.getShowHardwareCursor();
    activeEditor = new OpenTuiEditor(
      tui,
      editorTheme,
      keybindings,
      currentCursorStyle,
      useAsciiChrome(currentIconMode),
    );
    return activeEditor;
  });
  return {
    setIconMode(next: IconMode): void {
      currentIconMode = next;
      activeEditor?.setIconMode(next);
    },
    setCursorStyle(nextCursorStyle: CursorStyle): void {
      currentCursorStyle = nextCursorStyle;
      activeEditor?.setCursorStyle(nextCursorStyle, previousHardwareCursor);
    },
    setWheelScrollLines(nextWheelScrollLines: number): void {
      currentWheelScrollLines = nextWheelScrollLines;
      if (activeTui) applyFullscreenWheelScrollLines(activeTui, currentWheelScrollLines);
    },
    cleanup(): void {
      ctx.ui.setEditorComponent(undefined);
      if (activeTui) {
        if (currentCursorStyle !== "block") activeTui.terminal.write(DEFAULT_CURSOR_STYLE_SEQUENCE);
        if (previousHardwareCursor !== undefined)
          activeTui.setShowHardwareCursor(previousHardwareCursor);
      }
    },
  };
}
