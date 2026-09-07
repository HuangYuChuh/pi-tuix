import { closeSync, constants, fstatSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { InputEvent, InputEventResult, SessionEntry } from "@earendil-works/pi-coding-agent";
import { getImageDimensions } from "@earendil-works/pi-tui";
import { collectImages, type PrepareImages } from "../../session/image-attachments.ts";
import {
  type ImageNumberData,
  ImageNumberObservations,
} from "../../session/image-number-metadata.ts";
import { DraftQueue, type QueueDraft } from "./draft-queue.ts";
import { splitPastedPaths } from "./image-paths.ts";

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

type CapturedImage = Omit<DraftImage, "token" | "number">;

function highestImageLabel(text: string): number {
  let highest = 0;
  for (const match of text.matchAll(/\[Image #(\d+)\]/g)) {
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number > highest) highest = number;
  }
  return highest;
}

/** Read only an explicitly pasted single image path, outside all rendering. */
export function readPastedImage(
  text: string,
  cwd: string,
  maxBytes = MAX_IMAGE_BYTES,
): CapturedImage | undefined {
  let path = text.trim();
  if (!path || [...path].some((character) => character.charCodeAt(0) < 32)) return;
  if ((path.startsWith("'") && path.endsWith("'")) || (path.startsWith('"') && path.endsWith('"')))
    path = path.slice(1, -1);
  else path = path.replace(/\\([ ()[\]'"\\])/g, "$1");
  return readImagePath(path, cwd, maxBytes);
}

function readImagePath(
  path: string,
  cwd: string,
  maxBytes = MAX_IMAGE_BYTES,
): CapturedImage | undefined {
  const limit = Math.min(MAX_IMAGE_BYTES, maxBytes);
  if (limit <= 0) return;
  if ([...path].some((character) => character.charCodeAt(0) < 32)) return;
  try {
    if (path.startsWith("file:")) path = fileURLToPath(path);
    if (path.startsWith("~/")) path = resolve(homedir(), path.slice(2));
    path = resolve(cwd, path);
    const mimeType = mimeTypes[extname(path).toLowerCase()];
    if (!mimeType) return;
    const stat = statSync(path);
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit) return;
    // Nonblocking open and a second descriptor check also reject a path replaced
    // with a pipe/device between stat and open. Reads never exceed the bound.
    const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const current = fstatSync(fd);
      if (!current.isFile() || current.size <= 0 || current.size > limit) return;
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
  private readonly queue = new DraftQueue();
  private readonly submissions = new ImageNumberObservations();
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

  /** Historical user labels seed a fresh editor; live text does not reserve IDs. */
  seedHistory(entries: readonly SessionEntry[]): void {
    this.observe(entries);
    for (const entry of entries) {
      if (entry.type !== "message" || entry.message.role !== "user") continue;
      const content = entry.message.content;
      const texts =
        typeof content === "string"
          ? [content]
          : Array.isArray(content)
            ? content.flatMap((block) =>
                block?.type === "text" && typeof block.text === "string" ? [block.text] : [],
              )
            : [];
      for (const text of texts)
        this.nextNumber = Math.max(this.nextNumber, highestImageLabel(text));
    }
  }

  reserve(
    message: Extract<SessionEntry, { type: "message" }>["message"],
    pending = true,
  ): ImageNumberData | undefined {
    if (message.role !== "user") return;
    const observed = this.submissions.delivered(message.content, message.timestamp, pending);
    const content =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content;
    this.queue.delivered(
      content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(""),
      content.filter((block) => block.type === "image"),
      pending,
    );
    if (observed) {
      for (const number of observed.numbers) {
        if (number === null) this.nextNumber++;
        else this.nextNumber = Math.max(this.nextNumber, number);
      }
      return observed;
    }
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

  paste(text: string, cwd: string, draft = ""): string | undefined {
    if (this.closed) return;
    const minimumNumber = highestImageLabel(draft);
    const value = readPastedImage(text, cwd, MAX_DRAFT_BYTES - this.bytes);
    if (value) return this.attach(value, minimumNumber);
    const paths = splitPastedPaths(text);
    if (!paths) return;
    let changed = false;
    const transformed = paths.map(({ raw, path }) => {
      const image = readImagePath(path, cwd, MAX_DRAFT_BYTES - this.bytes);
      const token = image ? this.attach(image, minimumNumber) : undefined;
      if (!token) return this.display(raw);
      changed = true;
      return token;
    });
    return changed ? transformed.join(" ") : undefined;
  }

  private attach(value: CapturedImage, minimumNumber: number): string | undefined {
    const size = Buffer.byteLength(value.image.data, "base64");
    const number = Math.max(this.nextNumber, minimumNumber) + 1;
    if (
      this.bytes + size > MAX_DRAFT_BYTES ||
      this.nextToken >= 0xfffd ||
      !Number.isSafeInteger(number)
    )
      return;
    const token = String.fromCodePoint(0xf0000 + ++this.nextToken);
    const image = { ...value, token, number };
    this.nextNumber = number;
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

  /** External labels can reference the same captured attachment more than once. */
  restoreExternalLabels(text: string, source: string): string {
    const known = new Map<string, string>(
      [...source].flatMap((token) => {
        const image = this.images.get(token);
        return image ? [[`[Image #${image.number}]`, token] as const] : [];
      }),
    );
    return this.display(text).replace(/\[Image #\d+\]/g, (label) => known.get(label) ?? label);
  }

  restoreQueuedDraft(text: string, draft: QueueDraft): { text: string; unmatched: boolean } {
    this.submissions.clear();
    return this.queue.restore(text, draft);
  }

  transform(event: InputEvent, pending = true): InputEventResult {
    const referenced = new Map<number, DraftImage>();
    for (const character of event.text) {
      const image = this.images.get(character);
      if (image) referenced.set(image.number, image);
    }
    const text = referenced.size ? this.display(event.text) : event.text;
    const attached: ImageContent[] = [];
    const numbers: (number | null)[] = (event.images ?? []).map(() => null);
    // One attachment per owned identity, in first visible-reference order.
    // A typed reference can precede its chip; unused/old numbers stay text.
    if (referenced.size) {
      for (const match of text.matchAll(/\[Image #(\d+)\]/g)) {
        const number = Number(match[1]);
        const image = referenced.get(number);
        if (!image) continue;
        attached.push({ ...image.image });
        numbers.push(number);
        referenced.delete(number);
      }
    }
    const images = [...(event.images ?? []), ...attached];
    this.submissions.remember([{ type: "text", text }, ...images], numbers, pending);
    this.queue.observe(event, text, images, pending);
    return attached.length
      ? {
          action: "transform",
          text,
          images,
        }
      : { action: "continue" };
  }

  dispose(): void {
    this.closed = true;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.images.clear();
    this.queue.clear();
    this.submissions.clear();
    this.bytes = 0;
  }
}
