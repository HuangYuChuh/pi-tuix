import { closeSync, constants, fstatSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { InputEvent, InputEventResult, SessionEntry } from "@earendil-works/pi-coding-agent";
import { getImageDimensions } from "@earendil-works/pi-tui";
import { collectImages, type PrepareImages } from "../../session/image-attachments.ts";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_DRAFT_BYTES = 128 * 1024 * 1024;
const mimeTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface DraftImage {
  token: string;
  number: number;
  path: string;
  image: ImageContent;
  url?: string;
}

/** Read only an explicitly pasted single image path, outside all rendering. */
export function readPastedImage(
  text: string,
  cwd: string,
): Omit<DraftImage, "token" | "number"> | undefined {
  let path = text.trim();
  if (!path || [...path].some((character) => character.charCodeAt(0) < 32)) return;
  if ((path.startsWith("'") && path.endsWith("'")) || (path.startsWith('"') && path.endsWith('"')))
    path = path.slice(1, -1);
  else path = path.replace(/\\([ ()[\]'"\\])/g, "$1");
  try {
    if (path.startsWith("file:")) path = fileURLToPath(path);
    if (path.startsWith("~/")) path = resolve(homedir(), path.slice(2));
    path = resolve(cwd, path);
    const mimeType = mimeTypes[extname(path).toLowerCase()];
    if (!mimeType) return;
    const stat = statSync(path);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) return;
    // Nonblocking open and a second descriptor check also reject a path replaced
    // with a pipe/device between stat and open. Reads never exceed the bound.
    const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const current = fstatSync(fd);
      if (!current.isFile() || current.size <= 0 || current.size > MAX_IMAGE_BYTES) return;
      const bytes = Buffer.alloc(current.size + 1);
      let size = 0;
      while (size < bytes.length) {
        const count = readSync(fd, bytes, size, bytes.length - size, null);
        if (!count) break;
        size += count;
      }
      if (size !== current.size) return;
      const data = bytes.subarray(0, size).toString("base64");
      const dimensions = getImageDimensions(data, mimeType);
      if (!dimensions || dimensions.widthPx <= 0 || dimensions.heightPx <= 0) return;
      return { path, image: { type: "image", data, mimeType } };
    } finally {
      closeSync(fd);
    }
  } catch {
    return;
  }
}

/** One native grapheme per chip preserves Pi's own editing and undo snapshots. */
export class DraftImages {
  private readonly images = new Map<string, DraftImage>();
  private nextNumber = 0;
  private nextToken = 0;
  private bytes = 0;
  private readonly requests = new Set<AbortController>();
  private closed = false;
  private readonly prepare?: PrepareImages;
  private readonly requestRender: () => void;
  constructor(prepare?: PrepareImages, requestRender: () => void = () => {}) {
    this.prepare = prepare;
    this.requestRender = requestRender;
  }

  observe(entries: readonly SessionEntry[]): void {
    for (const image of collectImages(entries))
      this.nextNumber = Math.max(this.nextNumber, image.number ?? 0);
  }

  reserve(message: Extract<SessionEntry, { type: "message" }>["message"]): void {
    if (message.role !== "user") return;
    const images = collectImages([
      {
        type: "message",
        id: "pending",
        parentId: null,
        timestamp: new Date(0).toISOString(),
        message,
      },
    ]);
    if (images.every((image) => image.inline)) {
      for (const image of images) this.nextNumber = Math.max(this.nextNumber, image.number ?? 0);
    } else this.nextNumber += images.length;
  }

  paste(text: string, cwd: string): string | undefined {
    if (this.closed) return;
    const value = readPastedImage(text, cwd);
    if (!value) return;
    const size = Buffer.byteLength(value.image.data, "base64");
    if (this.bytes + size > MAX_DRAFT_BYTES || this.nextToken >= 0xfffd) return;
    const token = String.fromCodePoint(0xf0000 + ++this.nextToken);
    const image = { ...value, token, number: ++this.nextNumber };
    this.images.set(token, image);
    this.bytes += size;
    if (this.prepare) {
      const request = new AbortController();
      this.requests.add(request);
      const id = `pi-tuix-draft-${this.nextToken}`;
      const entry: SessionEntry = {
        type: "message",
        id,
        parentId: null,
        timestamp: new Date(0).toISOString(),
        message: { role: "user", timestamp: 0, content: [image.image] },
      };
      void this.prepare([entry], request.signal)
        .then((links) => {
          if (this.closed || request.signal.aborted) return;
          const attachment = this.images.get(token);
          if (attachment) attachment.url = links.get(`${id}:0`);
          this.requestRender();
        })
        .catch(() => {})
        .finally(() => this.requests.delete(request));
    }
    return token;
  }

  get(token: string): DraftImage | undefined {
    return this.images.get(token);
  }

  has(text: string): boolean {
    return [...text].some((character) => this.images.has(character));
  }

  display(text: string): string {
    return [...text]
      .map((character) => {
        const image = this.images.get(character);
        return image ? `[Image #${image.number}]` : character;
      })
      .join("");
  }

  paths(text: string): string {
    return [...text]
      .map((character) => {
        const image = this.images.get(character);
        return image ? ` ${JSON.stringify(image.path)} ` : character;
      })
      .join("");
  }

  restoreLabels(text: string, source: string): string {
    const known = new Map<string, string>(
      [...source].flatMap((token) => {
        const image = this.images.get(token);
        return image ? [[`[Image #${image.number}]`, token] as const] : [];
      }),
    );
    return text.replace(/\[Image #\d+\]/g, (label) => known.get(label) ?? label);
  }

  restoreQueuedLabels(text: string): string {
    return this.restoreLabels(text, [...this.images.keys()].join(""));
  }

  transform(event: InputEvent): InputEventResult {
    const attached = [...event.text].flatMap((character) => {
      const image = this.images.get(character);
      return image ? [{ ...image.image }] : [];
    });
    return attached.length
      ? {
          action: "transform",
          text: this.display(event.text),
          images: [...(event.images ?? []), ...attached],
        }
      : { action: "continue" };
  }

  dispose(): void {
    this.closed = true;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.images.clear();
    this.bytes = 0;
  }
}
