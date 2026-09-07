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
  Markdown,
  sliceByColumn,
  type TUI,
  type TuiAltScreen,
  truncateToWidth,
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

  getObservedPadding(component: Markdown): number | undefined {
    const read = this.reads.get(component);
    return read ? Math.max(0, Math.floor((read.width - read.availableWidth) / 2)) : undefined;
  }

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

function renderNative(component: Component, width: number): string[] {
  const lines = component.render(Math.max(4, width));
  return width < 4 ? lines.map((line) => truncateToWidth(line, width, "")) : lines;
}

interface CachedMessage {
  source: string | string[];
  width: number;
  theme: Theme;
  ascii: boolean;
  lines: string[];
}

/** Read public components; opaque components retain their own render methods. */
export class LiveMessageMirror {
  private readonly observation: MarkdownObservation;
  private readonly getTheme: () => Theme;
  private readonly getAscii: () => boolean;
  private cache = new WeakMap<Markdown, CachedMessage>();

  constructor(observation: MarkdownObservation, getTheme: () => Theme, getAscii: () => boolean) {
    this.observation = observation;
    this.getTheme = getTheme;
    this.getAscii = getAscii;
  }

  private cached(
    component: Markdown,
    source: string | string[],
    width: number,
    theme: Theme,
    ascii: boolean,
    render: () => string[],
  ): string[] {
    const previous = this.cache.get(component);
    if (
      previous?.source === source &&
      previous.width === width &&
      previous.theme === theme &&
      previous.ascii === ascii
    )
      return previous.lines;
    const lines = render();
    this.cache.set(component, { source, width, theme, ascii, lines });
    return lines;
  }

  invalidate(): void {
    this.cache = new WeakMap();
  }

  render(component: Component, width: number): string[] {
    if (width <= 0) return [];
    const theme = this.getTheme();
    const ascii = this.getAscii();
    if (component instanceof UserMessageComponent) {
      const [box] = component.children;
      // Version-local shape check: an unfamiliar public component layout is
      // rendered by Pi intact, never traversed through private fields.
      if (component.children.length === 1 && box instanceof Box && box.children.length === 1) {
        const [markdown] = box.children;
        if (markdown instanceof Markdown) {
          const read = this.observation.read(markdown, Math.max(4, width - 2));
          if (read?.messageType === "user") {
            return this.cached(markdown, read.source, width, theme, ascii, () => {
              const lines = new ReferenceUserMessage(read.source, theme, ascii).render(width);
              // Preserve the standard semantic prompt zones used by Pi's native
              // prompt navigation and terminal scrollback integrations.
              if (lines.length) {
                lines[0] = `\x1b]133;A\x07${lines[0]}`;
                lines[lines.length - 1] = `${lines[lines.length - 1]}\x1b]133;B\x07\x1b]133;C\x07`;
              }
              return lines;
            });
          }
        }
      }
      return renderNative(component, width);
    }
    if (component instanceof AssistantMessageComponent) {
      return component.children.flatMap(flatten).flatMap((child) => {
        if (!(child instanceof Markdown)) return renderNative(child, width);
        const inset = width >= 4 ? 2 : 0;
        const knownPadding = this.observation.getObservedPadding(child);
        let read = this.observation.read(
          child,
          Math.max(4, knownPadding === undefined ? width : width - inset + knownPadding * 2),
        );
        if (
          !read ||
          (read.messageType !== "assistant" && read.messageType !== "assistant-thinking")
        )
          return renderNative(child, width);
        const padding = Math.max(0, Math.floor((read.width - read.availableWidth) / 2));
        const target = Math.max(4, width - inset + padding * 2);
        if (target !== read.width) read = this.observation.read(child, target);
        if (!read) return renderNative(child, width);
        const thinking = read.messageType === "assistant-thinking";
        const marker = thinking ? (ascii ? "~" : "∴") : ascii ? "*" : "⏺";
        const availableWidth = read.availableWidth;
        const sourceLines = read.lines;
        return this.cached(child, sourceLines, width, theme, ascii, () =>
          sourceLines.map((line, index) => {
            const body = sliceByColumn(line, padding, Math.max(1, availableWidth), true);
            const prefix = inset
              ? index === 0
                ? `${theme.fg(thinking ? "thinkingText" : "userMessageText", marker)} `
                : "  "
              : "";
            return truncateToWidth(prefix + body, width, "");
          }),
        );
      });
    }
    if (plainContainer(component)) {
      const lines: string[] = [];
      for (const child of component.children) lines.push(...this.render(child, width));
      return lines;
    }
    return renderNative(component, width);
  }
}

/** A public container keeps its source mounted for host focus and invalidation. */
export class LiveDocumentPresentation extends Container {
  readonly source: Component;
  private readonly mirror: LiveMessageMirror;

  constructor(source: Component, mirror: LiveMessageMirror) {
    super();
    this.source = source;
    this.mirror = mirror;
    this.addChild(source);
  }

  override render(width: number): string[] {
    return this.mirror.render(this.source, width);
  }

  override invalidate(): void {
    this.mirror.invalidate();
    super.invalidate();
  }
}

export function createLiveTranscript(pi: ExtensionAPI) {
  const observation = new MarkdownObservation();
  const mounted = new Set<TUI>();
  pi.registerMarkdownTransformer(observation.transform);
  return {
    followLatest(): void {
      for (const tui of mounted) {
        // These are public TuiAltScreen members. The host can supply a stable
        // TUI reference, so use a capability check instead of instanceof.
        const viewport = tui as TUI & Partial<Pick<TuiAltScreen, "scrollToBottom">>;
        if (tui.mode === "fullscreen" && typeof viewport.scrollToBottom === "function")
          viewport.scrollToBottom();
      }
    },
    mount(
      tui: TUI,
      editor: OpenTuiEditor,
      ctx: ExtensionContext,
      getAscii: () => boolean,
    ): () => void {
      let alive = true;
      let document: Container | undefined;
      const wrappers = new Set<LiveDocumentPresentation>();
      // The editor factory runs before Pi puts that editor into its container.
      // Wait for that public composition to finish before recognizing the root.
      queueMicrotask(() => {
        if (!alive || !Array.isArray(tui.children)) return;
        const [candidate, ...dock] = tui.children;
        if (
          !candidate ||
          !plainContainer(candidate) ||
          !contains(
            candidate,
            (child) =>
              child instanceof OpenTuiHeader ||
              child instanceof UserMessageComponent ||
              child instanceof AssistantMessageComponent,
          ) ||
          contains(candidate, (child) => child === editor) ||
          !dock.some((child) => contains(child, (component) => component === editor))
        )
          return;
        document = candidate;
        const mirror = new LiveMessageMirror(observation, () => ctx.ui.theme, getAscii);
        // Wrap document children, retaining the original document and message
        // containers. Pi continues appending/removing messages through those
        // original references. Both native renderer modes see this same tree.
        document.children = document.children.map((source) => {
          const wrapper = new LiveDocumentPresentation(source, mirror);
          wrappers.add(wrapper);
          return wrapper;
        });
        mounted.add(tui);
        tui.invalidate();
        tui.requestRender();
      });
      return () => {
        if (!alive) return;
        alive = false;
        mounted.delete(tui);
        if (!document) return;
        // Only unwrap this mount's own components. Preserve later host/extension
        // additions, removals and reordering rather than restoring a stale list.
        document.children = document.children.map((child) =>
          child instanceof LiveDocumentPresentation && wrappers.has(child) ? child.source : child,
        );
        wrappers.clear();
        tui.invalidate();
        tui.requestRender();
      };
    },
  };
}
