import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  type MarkdownTransformContext,
  type MarkdownTransformer,
  type Theme,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  Container,
  CURSOR_MARKER,
  getKeybindings,
  isKeyRelease,
  Markdown,
  type OverlayHandle,
  ScrollView,
  sliceByColumn,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { ReferenceUserMessage } from "../../session/message-view.ts";
import type { OpenTuiEditor } from "./editor.ts";
import { OpenTuiHeader } from "./header.ts";

interface MarkdownRead extends MarkdownTransformContext {
  source: string;
  width: number;
  lines: string[];
}

/** Observe the public Markdown callback without changing the host's input. */
export class MarkdownObservation {
  private active: { component: Markdown; width: number } | undefined;
  private readonly reads = new WeakMap<Markdown, MarkdownRead>();
  readonly transform: MarkdownTransformer = (source, context) => {
    if (this.active) {
      this.reads.set(this.active.component, {
        ...context,
        source,
        width: this.active.width,
        lines: [],
      });
    }
    return source;
  };

  read(component: Markdown, width: number): MarkdownRead | undefined {
    const previous = this.active;
    this.active = { component, width };
    try {
      let before = this.reads.get(component);
      let lines = component.render(width);
      let read = this.reads.get(component);
      // A cache populated by Pi outside this read has no component-associated
      // observation. Invalidate once to request the public callback. A changed
      // cached array also detects setText() without peeking at Markdown fields.
      if (!read || read.width !== width || (before === read && read.lines !== lines)) {
        component.invalidate();
        before = read;
        lines = component.render(width);
        read = this.reads.get(component);
        if (before === read) return undefined;
      }
      if (!read) return undefined;
      read.lines = lines;
      return read;
    } finally {
      this.active = previous;
    }
  }
}

function plainContainer(component: Component): component is Container {
  return component.constructor === Container;
}

function flatten(component: Component): Component[] {
  return plainContainer(component) ? component.children.flatMap(flatten) : [component];
}

function contains(component: Component, predicate: (child: Component) => boolean): boolean {
  return (
    predicate(component) ||
    (plainContainer(component) && component.children.some((child) => contains(child, predicate)))
  );
}

/** Read public components; opaque components retain their own render methods. */
export class LiveMessageMirror {
  private readonly observation: MarkdownObservation;
  private readonly getTheme: () => Theme;
  private readonly getAscii: () => boolean;

  constructor(observation: MarkdownObservation, getTheme: () => Theme, getAscii: () => boolean) {
    this.observation = observation;
    this.getTheme = getTheme;
    this.getAscii = getAscii;
  }

  render(component: Component, width: number, prompts?: number[], offset = 0): string[] {
    if (width <= 0) return [];
    const theme = this.getTheme();
    if (component instanceof UserMessageComponent) {
      prompts?.push(offset);
      const [box] = component.children;
      // Version-local shape check: an unfamiliar public component layout is
      // rendered by Pi intact, never traversed through private fields.
      if (component.children.length === 1 && box instanceof Box && box.children.length === 1) {
        const [markdown] = box.children;
        if (markdown instanceof Markdown) {
          const read = this.observation.read(markdown, Math.max(4, width - 2));
          if (read?.messageType === "user")
            return new ReferenceUserMessage(read.source, theme, this.getAscii()).render(width);
        }
      }
      return component.render(Math.max(4, width));
    }
    if (component instanceof AssistantMessageComponent) {
      return component.children.flatMap(flatten).flatMap((child) => {
        if (!(child instanceof Markdown)) return child.render(Math.max(4, width));
        let read = this.observation.read(child, Math.max(4, width));
        if (
          !read ||
          (read.messageType !== "assistant" && read.messageType !== "assistant-thinking")
        )
          return child.render(Math.max(4, width));
        const padding = Math.max(0, Math.floor((read.width - read.availableWidth) / 2));
        const inset = width >= 4 ? 2 : 0;
        const target = Math.max(4, width - inset + padding * 2);
        if (target !== read.width) read = this.observation.read(child, target);
        if (!read) return child.render(Math.max(4, width));
        const thinking = read.messageType === "assistant-thinking";
        const marker = thinking ? (this.getAscii() ? "~" : "∴") : this.getAscii() ? "*" : "⏺";
        const availableWidth = read.availableWidth;
        return read.lines.map((line, index) => {
          const body = sliceByColumn(line, padding, Math.max(1, availableWidth), true);
          const prefix = inset
            ? index === 0
              ? `${theme.fg(thinking ? "thinkingText" : "userMessageText", marker)} `
              : "  "
            : "";
          return truncateToWidth(prefix + body, width, "");
        });
      });
    }
    if (plainContainer(component)) {
      const lines: string[] = [];
      for (const child of component.children)
        lines.push(...this.render(child, width, prompts, offset + lines.length));
      return lines;
    }
    return component.render(Math.max(4, width));
  }
}

/** Keep the active cursor and native footer visible when dock widgets grow. */
export function fitLiveDock(
  groups: readonly string[][],
  editorIndex: number,
  budget: number,
): string[] {
  if (budget <= 0) return [];
  const fitted = groups.map((lines) => [...lines]);
  let excess = fitted.reduce((sum, lines) => sum + lines.length, 0) - budget;
  const footerIndex = fitted.length - 1;
  const trim = (index: number, minimum: number) => {
    const lines = fitted[index];
    const count = Math.min(Math.max(0, excess), Math.max(0, lines.length - minimum));
    if (count) {
      lines.splice(0, count);
      excess -= count;
    }
  };
  for (let i = 0; i < fitted.length; i++) if (i !== editorIndex && i !== footerIndex) trim(i, 0);
  if (footerIndex !== editorIndex) trim(footerIndex, budget > 1 ? 1 : 0);
  if (excess > 0) {
    const lines = fitted[editorIndex] ?? [];
    const keep = Math.max(1, lines.length - excess);
    const cursor = lines.findIndex((line) => line.includes(CURSOR_MARKER));
    const start = Math.max(0, Math.min(cursor < 0 ? 0 : cursor, lines.length - keep));
    fitted[editorIndex] = lines.slice(start, start + keep);
  }
  return fitted.flat().slice(0, budget);
}

interface LiveEditor extends Component {
  focused: boolean;
  handleInput(data: string): void;
  onFocusChange(listener: (focused: boolean) => void): () => void;
}

export class LiveTranscriptView implements Component {
  private readonly tui: TUI;
  private readonly editor: LiveEditor;
  private readonly mirror: LiveMessageMirror;
  private readonly scroll: ScrollView;
  private documentRows = 1;
  private promptRows: number[] = [];

  constructor(tui: TUI, editor: LiveEditor, mirror: LiveMessageMirror) {
    this.tui = tui;
    this.editor = editor;
    this.mirror = mirror;
    this.scroll = new ScrollView(
      { render: () => [], invalidate() {} },
      { follow: "end", scrollbar: "hidden" },
    );
  }

  get focused(): boolean {
    return this.editor.focused;
  }
  set focused(value: boolean) {
    this.editor.focused = value;
  }

  supportsLayout(): boolean {
    const [document, ...dock] = this.tui.children;
    return Boolean(
      document &&
        plainContainer(document) &&
        contains(
          document,
          (component) =>
            component instanceof OpenTuiHeader ||
            component instanceof UserMessageComponent ||
            component instanceof AssistantMessageComponent,
        ) &&
        !contains(document, (component) => component === this.editor) &&
        dock.some((component) => contains(component, (child) => child === this.editor)),
    );
  }

  render(width: number): string[] {
    if (width <= 0 || !this.supportsLayout()) return [];
    const [document, ...dock] = this.tui.children;
    const rows = Math.max(1, this.tui.terminal.rows);
    const editorIndex = dock.findIndex((component) =>
      contains(component, (child) => child === this.editor),
    );
    const dockLines = fitLiveDock(
      dock.map((component) => component.render(Math.max(4, width))),
      editorIndex,
      Math.max(1, rows - (rows >= 4 ? 1 : 0)),
    );
    this.documentRows = Math.max(0, rows - dockLines.length);
    this.promptRows = [];
    const documentLines = this.mirror.render(document, width, this.promptRows);
    this.scroll.updateLayout(documentLines.length, this.documentRows, () =>
      this.tui.requestRender(),
    );
    const visible = documentLines.slice(
      this.scroll.scrollTop,
      this.scroll.scrollTop + this.documentRows,
    );
    while (visible.length < this.documentRows) visible.push("");
    return [...visible, ...dockLines].slice(0, rows).map((line) => {
      const text = truncateToWidth(line, width, "");
      return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
    });
  }

  handleInput(data: string): void {
    const keys = getKeybindings();
    const release = isKeyRelease(data);
    // Only standard vertical wheel reports are consumed. Mouse selection and
    // hyperlinks remain handled by Pi against the composited screen.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Standard terminal SGR mouse report.
    const wheel = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
    if (wheel && Number(wheel[1]) & 64 && (Number(wheel[1]) & 3) < 2) {
      if (wheel[4] === "M" && Number(wheel[3]) <= this.documentRows)
        this.scroll.scrollBy(Number(wheel[1]) & 1 ? 3 : -3);
      return;
    }
    const page = Math.max(1, this.documentRows - 2);
    const movements = [
      ["tui.altScreen.pageUp", -page],
      ["tui.altScreen.pageDown", page],
      ["tui.altScreen.halfPageUp", -Math.max(1, Math.floor(this.documentRows / 2))],
      ["tui.altScreen.halfPageDown", Math.max(1, Math.floor(this.documentRows / 2))],
      ["tui.altScreen.lineUp", -1],
      ["tui.altScreen.lineDown", 1],
    ] as const;
    for (const [key, amount] of movements)
      if (keys.matches(data, key)) {
        if (!release) this.scroll.scrollBy(amount);
        return;
      }
    if (keys.matches(data, "tui.altScreen.top")) {
      if (!release) this.scroll.scrollToStart();
      return;
    }
    if (keys.matches(data, "tui.altScreen.bottom")) {
      if (!release) this.scroll.scrollToEnd();
      return;
    }
    for (const [key, direction] of [
      ["tui.altScreen.previousPrompt", -1],
      ["tui.altScreen.nextPrompt", 1],
    ] as const) {
      if (!keys.matches(data, key)) continue;
      if (!release) {
        const positions = direction < 0 ? [...this.promptRows].reverse() : this.promptRows;
        const target = positions.find((row) =>
          direction < 0 ? row < this.scroll.scrollTop : row > this.scroll.scrollTop,
        );
        if (target !== undefined) this.scroll.scrollTo(target);
      }
      return;
    }
    this.editor.handleInput(data);
  }

  invalidate(): void {}

  followLatest(): void {
    this.scroll.scrollToEnd();
  }
}

export function createLiveTranscript(pi: ExtensionAPI) {
  const observation = new MarkdownObservation();
  const views = new Set<LiveTranscriptView>();
  pi.registerMarkdownTransformer(observation.transform);
  return {
    followLatest(): void {
      for (const view of views) view.followLatest();
    },
    mount(
      tui: TUI,
      editor: OpenTuiEditor,
      ctx: ExtensionContext,
      getAscii: () => boolean,
    ): () => void {
      // Inline-mode scrollback and full-screen overlays have different contracts.
      // Keep the inline host intact until that projection is independently tested.
      if (tui.mode !== "fullscreen") return () => {};
      const view = new LiveTranscriptView(
        tui,
        editor,
        new LiveMessageMirror(observation, () => ctx.ui.theme, getAscii),
      );
      views.add(view);
      let alive = true;
      let overlay: OverlayHandle | undefined;
      const focus = () => {
        if (alive && editor.focused && view.supportsLayout() && !overlay?.isFocused())
          overlay?.focus();
      };
      const unsubscribe = editor.onFocusChange((focused) => {
        if (focused) queueMicrotask(focus);
      });
      overlay = tui.showOverlay(view, {
        width: "100%",
        maxHeight: "100%",
        row: 0,
        col: 0,
        margin: 0,
        visible: () =>
          alive && tui.mode === "fullscreen" && editor.focused && view.supportsLayout(),
      });
      queueMicrotask(focus);
      return () => {
        alive = false;
        views.delete(view);
        unsubscribe();
        overlay?.hide();
      };
    },
  };
}
