import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  hyperlink,
  stripTerminalSequences,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { type ImageAttachment, type ImageLinks, imageLabel } from "./image-attachments.ts";
import { messageText } from "./message-view.ts";

export function contentText(
  content: unknown,
  entryId = "",
  images: ReadonlyMap<string, ImageAttachment> = new Map(),
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = content.map((part, index) => {
    if (part?.type === "text" && typeof part.text === "string") return part.text;
    const image = images.get(`${entryId}:${index}`);
    if (image) return image.inline ? "" : imageLabel(image);
    return `[${messageText(String(part?.type ?? "attachment"))}${part?.mimeType ? `: ${messageText(String(part.mimeType))}` : ""}]`;
  });
  return content.some((part) => part?.type === "image")
    ? parts.filter((part) => part.length > 0).join(" ")
    : parts.join("\n");
}

/** Reference attachment branches stay adjacent to their message or tool. */
export class AttachedContent implements Component {
  private readonly content: Component;
  private readonly images: readonly ImageAttachment[];
  private readonly links: ImageLinks;
  private readonly theme: Theme;
  private readonly ascii: boolean;
  private readonly loading: boolean;
  constructor(
    content: Component,
    images: readonly ImageAttachment[],
    links: ImageLinks,
    theme: Theme,
    ascii: boolean,
    loading: boolean,
  ) {
    this.content = content;
    this.images = images;
    this.links = links;
    this.theme = theme;
    this.ascii = ascii;
    this.loading = loading;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const lines = [...this.content.render(width)];
    while (lines.length && !stripTerminalSequences(lines.at(-1) ?? "").trim()) lines.pop();
    for (const image of this.images) {
      const label = imageLabel(image);
      const url = this.links.get(image.key);
      lines.push(
        truncateToWidth(
          this.theme.fg("muted", this.ascii ? "  L  " : "  ⎿  ") +
            (url
              ? hyperlink(label, url)
              : `${label} ${this.theme.fg("muted", this.loading ? "(loading...)" : "(unavailable)")}`),
          width,
          "",
        ),
      );
    }
    return lines;
  }

  invalidate(): void {
    this.content.invalidate();
  }
}
