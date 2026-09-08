import type { Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Markdown,
  sliceByColumn,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { styleReferenceMarkdownLines } from "./markdown-style.ts";

/** Session text is data: terminal controls must not become viewport commands. */
export function messageText(text: string): string {
  return stripTerminalSequences(text).replace(/\p{Cc}/gu, (char) =>
    char === "\n" ? "\n" : char === "\t" ? "  " : "",
  );
}

function userMarker(text: string, theme: Theme): string {
  const noColor = Boolean(process.env.NO_COLOR);
  const forced = Boolean(process.env.FORCE_COLOR) && process.env.FORCE_COLOR !== "0";
  if (theme.name !== "pi-tuix-dark" || (noColor && !forced)) return theme.fg("borderMuted", text);
  const color = theme.getColorMode() === "truecolor" ? "2;80;80;80" : "5;239";
  return `\x1b[38;${color}m${text}\x1b[39m`;
}

export class ReferenceUserMessage implements Component {
  private readonly text: string;
  private readonly theme: Theme;
  private readonly ascii: boolean;

  constructor(text: string, theme: Theme, ascii = false) {
    this.text = messageText(text);
    this.theme = theme;
    this.ascii = ascii;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const prefixWidth = width >= 4 ? 2 : 0;
    const bodyWidth = Math.max(1, width - prefixWidth - (width >= 4 ? 1 : 0));
    const body = this.text.split("\n").flatMap((line) => wrapTextWithAnsi(line, bodyWidth));
    return body.map((line, index) => {
      const prefix = prefixWidth
        ? index === 0
          ? userMarker(`${this.ascii ? ">" : "❯"} `, this.theme)
          : "  "
        : "";
      const content = truncateToWidth(prefix + this.theme.fg("userMessageText", line), width, "");
      return this.theme.bg("userMessageBg", content + " ".repeat(width - visibleWidth(content)));
    });
  }

  invalidate(): void {}
}

/** Add chrome after Markdown layout, reflowing any minimum-width host output. */
export function renderAssistantLines(
  lines: readonly string[],
  width: number,
  theme: Theme,
  ascii = false,
  thinking = false,
): string[] {
  if (width <= 0) return [];
  const inset = width >= 4 ? 2 : 0;
  const bodyWidth = width - inset;
  const body = lines.flatMap((line) => {
    if (visibleWidth(line) <= bodyWidth) return [line];
    // A one-column view cannot contain a wide glyph. Column slicing avoids the
    // host wrapper's wide-glyph minimum while retaining every single-cell glyph.
    if (bodyWidth === 1) {
      return Array.from({ length: visibleWidth(line) }, (_, column) =>
        sliceByColumn(line, column, 1, true),
      );
    }
    return wrapTextWithAnsi(line, bodyWidth);
  });
  const marker = thinking ? (ascii ? "~" : "∴") : ascii ? "*" : "⏺";
  return body.map((line, index) => {
    const prefix = inset
      ? index === 0
        ? `${theme.fg(thinking ? "thinkingText" : "userMessageText", marker)} `
        : "  "
      : "";
    return truncateToWidth(prefix + line, width, "");
  });
}

/** Prefix the rendered Markdown, keeping headings, lists and code fences intact. */
export class ReferenceAssistantText implements Component {
  private readonly markdown: Markdown;
  private readonly theme: Theme;
  private readonly ascii: boolean;
  private readonly thinking: boolean;
  private readonly metadata: string | undefined;

  constructor(text: string, theme: Theme, ascii = false, thinking = false, metadata?: string) {
    this.theme = theme;
    this.ascii = ascii;
    this.thinking = thinking;
    this.metadata = metadata ? messageText(metadata) : undefined;
    this.markdown = new Markdown(
      messageText(text),
      0,
      0,
      getMarkdownTheme(),
      thinking ? { color: (text) => theme.fg("thinkingText", text), italic: true } : undefined,
    );
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const inset = width >= 4 ? 2 : 0;
    // Pi's Markdown wrapper needs room for a wide glyph even in one-cell views.
    const lines = styleReferenceMarkdownLines(this.markdown.render(Math.max(4, width - inset)));
    const rendered = renderAssistantLines(lines, width, this.theme, this.ascii, this.thinking);
    if (!this.metadata) return rendered;
    const metadataWidth = Math.max(0, width - 2);
    const label = truncateToWidth(this.metadata, metadataWidth, "");
    return [
      this.theme.fg("dim", " ".repeat(Math.max(0, metadataWidth - visibleWidth(label))) + label),
      ...rendered,
    ];
  }

  invalidate(): void {
    this.markdown.invalidate();
  }
}
