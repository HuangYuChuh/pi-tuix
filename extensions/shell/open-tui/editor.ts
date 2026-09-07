import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  keyText,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
  CURSOR_MARKER,
  getKeybindings,
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { CursorStyle } from "./config.ts";
import { layoutDraftImages } from "./draft-image-layout.ts";
import type { DraftImages } from "./draft-images.ts";
import type { QueueDraft } from "./draft-queue.ts";
import {
  applyFullscreenWheelScrollLines,
  DEFAULT_FULLSCREEN_WHEEL_SCROLL_LINES,
} from "./fullscreen-scroll.ts";
import { type IconMode, useAsciiChrome } from "./icons.ts";
import { hasImageLabels, imageLabelAt } from "./image-labels.ts";
import { findBottomBorderIndex, isEditorBorderLine, stripAnsi } from "./utils.ts";

function fillLine(content: string, width: number): string {
  let truncated = truncateToWidth(content, Math.max(0, width), "");
  const cursor = content.indexOf(CURSOR_MARKER);
  if (width > 0 && cursor >= 0 && !truncated.includes(CURSOR_MARKER)) {
    const column = visibleWidth(content.slice(0, cursor));
    truncated = truncateToWidth(
      sliceByColumn(content, Math.max(0, column - width + 1), width, true),
      width,
      "",
    );
    if (!truncated.includes(CURSOR_MARKER)) truncated = CURSOR_MARKER + truncated;
  }
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
  onQueueRestored?: () => void;
  onQueueRestoreUnmatched?: () => void;
  private helpVisible = false;
  private ascii: boolean;
  private readonly getBorder: (s: string) => string;
  private cursorStyle: CursorStyle;
  private previewHardwareCursor = false;
  private readonly getPromptStatus: (width: number) => string;
  private readonly images?: DraftImages;
  private readonly cwd: string;
  private imagePaste: string | undefined;
  private imageWidth = 80;
  private imagePreferredColumn: number | undefined;
  private readonly appKeys: KeybindingsManager;
  private externalImages = false;
  private externalDraft: string | undefined;
  private restoringQueuedDraft: QueueDraft | undefined;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    cursorStyle: CursorStyle = "block",
    ascii = useAsciiChrome(),
    getPromptStatus: (width: number) => string = () => "",
    images?: DraftImages,
    cwd = process.cwd(),
  ) {
    super(tui, editorTheme, keybindings, { paddingX: 0 });
    this.cursorStyle = cursorStyle;
    this.ascii = ascii;
    this.getPromptStatus = getPromptStatus;
    this.images = images;
    this.cwd = cwd;
    this.appKeys = keybindings;
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
    // A failed external editor resumes input without calling setText. Do not
    // apply that abandoned exchange to a later history or queue replacement.
    this.externalDraft = undefined;
    if (this.images && this.handleImagePaste(data)) return;
    if (this.appKeys.matches(data, "app.editor.external")) {
      this.externalImages = true;
      try {
        super.handleInput(data);
      } finally {
        this.externalImages = false;
      }
      return;
    }
    if (
      this.appKeys.matches(data, "app.message.dequeue") ||
      (this.appKeys.matches(data, "app.interrupt") &&
        !this.isShowingAutocomplete() &&
        !this.helpVisible)
    ) {
      this.restoringQueuedDraft = { raw: super.getText(), expanded: super.getExpandedText() };
      try {
        super.handleInput(data);
      } finally {
        this.restoringQueuedDraft = undefined;
        this.onQueueRestored?.();
      }
      return;
    }
    if (this.handleTextImageLabel(data) || this.moveImageCursor(data)) return;
    this.imagePreferredColumn = undefined;
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
    const beforeText = super.getText();
    const beforeCursor = this.getCursor();
    super.handleInput(this.images?.display(data) ?? data);
    const cursor = this.getCursor();
    if (
      this.images &&
      beforeText === super.getText() &&
      (cursor.line !== beforeCursor.line || cursor.col !== beforeCursor.col)
    ) {
      const backwards =
        cursor.line < beforeCursor.line ||
        (cursor.line === beforeCursor.line && cursor.col < beforeCursor.col);
      const label = imageLabelAt(this.getLines()[cursor.line] ?? "", cursor.col, backwards);
      if (label && cursor.col > label.start && cursor.col < label.end)
        this.moveToCursor({ line: cursor.line, col: backwards ? label.start : label.end });
    }
  }

  private hasRichDraft(): boolean {
    const text = super.getText();
    return Boolean(this.images && (this.images.has(text) || hasImageLabels(text)));
  }

  private handleTextImageLabel(data: string): boolean {
    if (!this.images || this.isShowingAutocomplete()) return false;
    const keys = getKeybindings();
    const left = keys.matches(data, "tui.editor.cursorLeft");
    const right = keys.matches(data, "tui.editor.cursorRight");
    const backspace = keys.matches(data, "tui.editor.deleteCharBackward");
    const forwardDelete = keys.matches(data, "tui.editor.deleteCharForward");
    if (!left && !right && !backspace && !forwardDelete) return false;
    const cursor = this.getCursor();
    const lines = this.getLines();
    const label = imageLabelAt(lines[cursor.line] ?? "", cursor.col, left || backspace);
    if (!label) return false;
    this.imagePreferredColumn = undefined;
    if (left || right)
      return this.moveToCursor({ line: cursor.line, col: left ? label.start : label.end });

    // Public setText provides one native undo snapshot. It also clears native
    // collapsed-paste data, so retain native deletion when that data is present.
    if (super.getExpandedText() !== super.getText()) return false;
    const line = lines[cursor.line];
    lines[cursor.line] = line.slice(0, label.start) + line.slice(label.end);
    super.setText(lines.join("\n"));
    this.moveToCursor({ line: cursor.line, col: label.start });
    this.tui.requestRender();
    return true;
  }

  private moveImageCursor(data: string): boolean {
    if (!this.images || !this.hasRichDraft() || this.isShowingAutocomplete()) return false;
    if (
      this.appKeys.matches(data, "tui.editor.historyPrevious") ||
      this.appKeys.matches(data, "tui.editor.historyNext")
    )
      return false;
    const keys = getKeybindings();
    const up = keys.matches(data, "tui.editor.cursorUp");
    const down = keys.matches(data, "tui.editor.cursorDown");
    if (!up && !down) return false;
    const layout = layoutDraftImages(
      this.getLines(),
      this.getCursor(),
      this.images,
      this.imageWidth,
      1,
      false,
      false,
      this.imagePreferredColumn,
    );
    const target = up ? layout.up : layout.down;
    if (!target) return false;
    this.imagePreferredColumn ??= layout.column;
    return this.moveToCursor(target);
  }

  private moveToCursor(target: { line: number; col: number }): boolean {
    const keys = getKeybindings();
    const lines = this.getLines();
    const offset = (cursor: { line: number; col: number }) =>
      lines.slice(0, cursor.line).reduce((sum, line) => sum + line.length + 1, cursor.col);
    const destination = offset(target);
    if (destination === offset(this.getCursor())) return true;
    const action =
      destination < offset(this.getCursor()) ? "tui.editor.cursorLeft" : "tui.editor.cursorRight";
    const candidates = action === "tui.editor.cursorLeft" ? ["\x1b[D", "\x02"] : ["\x1b[C", "\x06"];
    for (const key of keys.getKeys(action)) {
      if (key.length === 1) candidates.push(key);
      else if (/^ctrl\+[a-z]$/.test(key))
        candidates.push(String.fromCharCode(key.charCodeAt(5) - 96));
    }
    const key = candidates.find((candidate) => keys.matches(candidate, action));
    if (!key) return false;
    for (let remaining = super.getText().length + 1; remaining > 0; remaining--) {
      const before = offset(this.getCursor());
      if (before === destination) break;
      super.handleInput(key);
      if (offset(this.getCursor()) === before) break;
    }
    this.tui.requestRender();
    return true;
  }

  private handleImagePaste(data: string): boolean {
    const begin = "\x1b[200~";
    const end = "\x1b[201~";
    const start = data.indexOf(begin);
    if (this.imagePaste === undefined && start < 0) return false;
    if (this.imagePaste === undefined) {
      if (start > 0) super.handleInput(data.slice(0, start));
      this.imagePaste = "";
      data = data.slice(start + begin.length);
    }
    this.imagePaste += data;
    const stop = this.imagePaste.indexOf(end);
    if (stop < 0) return true;
    const content = this.imagePaste.slice(0, stop);
    const remainder = this.imagePaste.slice(stop + end.length);
    this.imagePaste = undefined;
    const image = this.images?.paste(content, this.cwd, super.getText());
    if (image) super.insertTextAtCursor(image);
    else super.handleInput(begin + (this.images?.display(content) ?? content) + end);
    if (remainder) this.handleInput(remainder);
    this.tui.requestRender();
    return true;
  }

  override insertTextAtCursor(text: string): void {
    super.insertTextAtCursor(
      this.images?.paste(text, this.cwd, super.getText()) ?? this.images?.display(text) ?? text,
    );
  }

  override getExpandedText(): string {
    const text = super.getExpandedText();
    if (this.externalImages && this.images?.has(text)) {
      this.externalDraft = text;
      return this.images.display(text);
    }
    return text;
  }

  override setText(text: string): void {
    if (this.restoringQueuedDraft && this.images) {
      const restored = this.images.restoreQueuedDraft(text, this.restoringQueuedDraft);
      text = restored.text;
      this.restoringQueuedDraft = undefined;
      if (restored.unmatched) this.onQueueRestoreUnmatched?.();
    }
    if (this.externalDraft !== undefined && this.images) {
      text = this.images.restoreExternalLabels(text, this.externalDraft);
      this.externalDraft = undefined;
    }
    super.setText(text);
  }

  restoreImagePaths(): void {
    if (this.images?.has(super.getText()))
      super.setText(this.images.paths(super.getExpandedText()));
    this.imagePaste = undefined;
    this.externalDraft = undefined;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    if (width < 4 && !this.hasRichDraft())
      return this.renderBase(width).map((line) => truncateToWidth(line, width, ""));
    const innerWidth = Math.max(1, width - 2);
    this.imageWidth = innerWidth;
    const baseLines = this.renderBase(innerWidth);
    const bottomIdx = findBottomBorderIndex(baseLines);
    const rich =
      this.images && this.hasRichDraft()
        ? layoutDraftImages(
            this.getLines(),
            this.getCursor(),
            this.images,
            innerWidth,
            Math.max(1, Math.min(10, Math.floor(this.tui.terminal.rows / 3))),
            this.focused,
            this.cursorStyle === "block",
          )
        : undefined;
    const top = rich ? (rich.above ? `↑ ${rich.above} more` : "") : baseLines[0];
    const bottom = rich ? (rich.below ? `↓ ${rich.below} more` : "") : baseLines[bottomIdx];
    const result = [renderPromptRule(width, this.getBorder, top, this.ascii)];
    const body = rich?.lines ?? baseLines.slice(1, bottomIdx);
    for (let i = 0; i < body.length; i++) {
      const line = body[i] ?? "";
      const prefix = i === 0 ? this.getBorder(this.ascii ? "> " : "❯ ") : "  ";
      result.push(prefix + fillLine(isEditorBorderLine(line) ? "" : line, innerWidth));
    }
    result.push(renderPromptRule(width, this.getBorder, bottom, this.ascii));
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
    const status = this.getPromptStatus(width);
    if (status) result.unshift(status);
    return result.map((line) => truncateToWidth(line, width, ""));
  }
}

export function installEditor(
  _pi: ExtensionAPI,
  ctx: ExtensionContext,
  cursorStyle: CursorStyle = "block",
  wheelScrollLines = DEFAULT_FULLSCREEN_WHEEL_SCROLL_LINES,
  iconMode: IconMode = "auto",
  getPromptStatus: (width: number) => string = () => "",
  onCreate?: (tui: TUI, editor: OpenTuiEditor) => () => void,
  images?: DraftImages,
) {
  let activeTui: TUI | undefined;
  let activeEditor: OpenTuiEditor | undefined;
  let previousHardwareCursor: boolean | undefined;
  let currentIconMode = iconMode;
  let currentCursorStyle = cursorStyle;
  let currentWheelScrollLines = wheelScrollLines;
  let disposePresentation: (() => void) | undefined;

  ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
    disposePresentation?.();
    activeTui = tui;
    applyFullscreenWheelScrollLines(tui, currentWheelScrollLines);
    previousHardwareCursor = tui.getShowHardwareCursor();
    activeEditor = new OpenTuiEditor(
      tui,
      editorTheme,
      keybindings,
      currentCursorStyle,
      useAsciiChrome(currentIconMode),
      getPromptStatus,
      images,
      ctx.cwd,
    );
    disposePresentation = onCreate?.(tui, activeEditor);
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
      disposePresentation?.();
      disposePresentation = undefined;
      activeEditor?.restoreImagePaths();
      ctx.ui.setEditorComponent(undefined);
      if (activeTui) {
        if (currentCursorStyle !== "block") activeTui.terminal.write(DEFAULT_CURSOR_STYLE_SEQUENCE);
        if (previousHardwareCursor !== undefined)
          activeTui.setShowHardwareCursor(previousHardwareCursor);
      }
    },
  };
}
