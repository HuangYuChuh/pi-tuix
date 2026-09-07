import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { getImageDimensions } from "@earendil-works/pi-tui";

export interface ImageAttachment {
  entryId: string;
  key: string;
  number?: number;
  mimeType: string;
  data: string;
}
export type ImageLinks = ReadonlyMap<string, string>;
export type PrepareImages = (
  entries: readonly SessionEntry[],
  signal: AbortSignal,
) => Promise<ImageLinks>;

export function imageLabel(image: ImageAttachment): string {
  return image.number === undefined ? "[Image]" : `[Image #${image.number}]`;
}

/** Only user attachments consume numbers; repeated bytes still count separately. */
export function collectImages(entries: readonly SessionEntry[]): ImageAttachment[] {
  const images: ImageAttachment[] = [];
  let userNumber = 0;
  for (const entry of entries) {
    const content =
      entry.type === "message" && "content" in entry.message
        ? entry.message.content
        : entry.type === "custom_message" && entry.display
          ? entry.content
          : undefined;
    if (entry.type === "message" && entry.message.role === "custom" && !entry.message.display)
      continue;
    if (!Array.isArray(content)) continue;
    content.forEach((part, index) => {
      if (part?.type !== "image") return;
      images.push({
        entryId: entry.id,
        key: `${entry.id}:${index}`,
        number:
          entry.type === "message" && entry.message.role === "user" ? ++userNumber : undefined,
        mimeType: typeof part.mimeType === "string" ? part.mimeType : "",
        data: typeof part.data === "string" ? part.data : "",
      });
    });
  }
  return images;
}

const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Disposable UI assets only. No session writes, decoding during render, or network I/O. */
export class SessionImageCache {
  private directory: Promise<string> | undefined;
  private readonly files = new Map<string, Promise<string>>();
  private readonly pending = new Set<Promise<ImageLinks>>();
  private closed = false;

  prepare(entries: readonly SessionEntry[], signal: AbortSignal): Promise<ImageLinks> {
    const task = this.prepareEntries(entries, signal);
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task)).catch(() => {});
    return task;
  }

  private async prepareEntries(
    entries: readonly SessionEntry[],
    signal: AbortSignal,
  ): Promise<ImageLinks> {
    signal.throwIfAborted();
    if (this.closed) throw new Error("Image cache is closed");
    const links = new Map<string, string>();
    for (const attachment of collectImages(entries)) {
      signal.throwIfAborted();
      if (this.closed) throw new Error("Image cache is closed");
      const extension = extensions[attachment.mimeType];
      // Only supported raster formats become openable files. Bad/absent media
      // retains its attachment label instead of breaking the whole conversation.
      if (
        !extension ||
        !attachment.data ||
        attachment.data.length > 28 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(attachment.data)
      )
        continue;
      const bytes = Buffer.from(attachment.data, "base64");
      if (bytes.toString("base64").replace(/=+$/, "") !== attachment.data.replace(/=+$/, ""))
        continue;
      const dimensions = getImageDimensions(attachment.data, attachment.mimeType);
      if (!dimensions || dimensions.widthPx <= 0 || dimensions.heightPx <= 0) continue;
      const digest = createHash("sha256").update(bytes).digest("hex");
      const filename = `${digest}.${extension}`;
      let file = this.files.get(filename);
      if (!file) {
        this.directory ??= mkdtemp(join(tmpdir(), "pi-tuix-images-"));
        const directory = this.directory;
        file = (async () => {
          const path = join(await directory, filename);
          if (this.closed) throw new Error("Image cache is closed");
          await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
          return pathToFileURL(path).href;
        })();
        this.files.set(filename, file);
        void file.catch(() => this.files.delete(filename));
      }
      try {
        const url = await file;
        signal.throwIfAborted();
        if (this.closed) throw new Error("Image cache is closed");
        links.set(attachment.key, url);
      } catch {
        signal.throwIfAborted();
        if (this.closed) throw new Error("Image cache is closed");
      }
    }
    signal.throwIfAborted();
    return links;
  }

  async dispose(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.pending]);
    if (this.directory) {
      const directory = await this.directory.catch(() => undefined);
      if (directory) await rm(directory, { recursive: true, force: true });
    }
    this.files.clear();
  }
}
