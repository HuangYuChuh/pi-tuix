import { createHash } from "node:crypto";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { InputEvent } from "@earendil-works/pi-coding-agent";

interface ObservedInput {
  lane: "steer" | "followUp";
  raw: string;
  text: string;
  images: string;
}

export interface QueueDraft {
  raw: string;
  expanded: string;
}

function fingerprint(images: readonly ImageContent[]): string {
  const hash = createHash("sha256");
  for (const image of images)
    hash.update(image.mimeType).update("\0").update(image.data).update("\0");
  return hash.digest("hex");
}

/** Disposable input observations; Pi alone stores, orders and delivers its queue. */
export class DraftQueue {
  private inputs: ObservedInput[] = [];
  private characters = 0;
  private reliable = true;
  private owned = false;

  observe(
    event: InputEvent,
    text: string,
    images: readonly ImageContent[],
    pending: boolean,
  ): void {
    if (!pending) this.clear();
    if (!event.streamingBehavior) return;
    this.owned ||= event.text !== text;
    const size = event.text.length + text.length;
    if (!this.reliable || this.inputs.length >= 256 || this.characters + size > 8 * 1024 * 1024) {
      this.reliable = false;
      this.inputs = [];
      this.characters = 0;
      return;
    }
    this.inputs.push({
      lane: event.streamingBehavior,
      raw: event.text,
      text,
      images: fingerprint(images),
    });
    this.characters += size;
  }

  delivered(text: string, images: readonly ImageContent[], pending: boolean): void {
    if (!pending) {
      this.clear();
      return;
    }
    const digest = fingerprint(images);
    const matches = (input: ObservedInput) => input.text === text && input.images === digest;
    let index = this.inputs.findIndex((input) => input.lane === "steer" && matches(input));
    if (index < 0) index = this.inputs.findIndex(matches);
    if (index < 0) return;
    const [input] = this.inputs.splice(index, 1);
    this.characters -= input.raw.length + input.text.length;
    if (this.reliable) this.owned = this.inputs.some((input) => input.raw !== input.text);
  }

  restore(text: string, draft: QueueDraft): { text: string; unmatched: boolean } {
    const ordered = [
      ...this.inputs.filter((input) => input.lane === "steer"),
      ...this.inputs.filter((input) => input.lane === "followUp"),
    ];
    const queued = ordered.map((input) => input.text).join("\n\n");
    const expected = [queued, draft.raw].filter((part) => part.trim()).join("\n\n");
    const matched = this.reliable && ordered.length > 0 && text === expected;
    const unmatched = !matched && this.owned;
    if (matched) {
      text = [ordered.map((input) => input.raw).join("\n\n"), draft.expanded]
        .filter((part) => part.trim())
        .join("\n\n");
    } else if (draft.raw.trim() && text.endsWith(`\n\n${draft.raw}`)) {
      // Native setText clears collapsed-paste storage. Expand only the exact
      // current-draft suffix; unknown queued labels never become attachments.
      text = text.slice(0, -draft.raw.length) + draft.expanded;
    }
    this.clear();
    return { text, unmatched };
  }

  clear(): void {
    this.inputs = [];
    this.characters = 0;
    this.reliable = true;
    this.owned = false;
  }
}
