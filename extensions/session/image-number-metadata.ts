import { createHash } from "node:crypto";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const IMAGE_NUMBERS_ENTRY_TYPE = "pi-tuix-image-numbers";
export interface ImageNumberData {
  version: 1;
  timestamp: number;
  fingerprint: string;
  numbers: (number | null)[];
}

/** Bind display metadata to exact public content without retaining image bytes. */
export function imageContentFingerprint(content: unknown): string | undefined {
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
  if (!Array.isArray(blocks)) return;
  const hash = createHash("sha256");
  for (const block of blocks) {
    if (block?.type === "text" && typeof block.text === "string") {
      hash.update(JSON.stringify(["text", block.text.length])).update(block.text);
    } else if (
      block?.type === "image" &&
      typeof block.mimeType === "string" &&
      typeof block.data === "string"
    ) {
      hash.update(JSON.stringify(["image", block.mimeType, block.data.length])).update(block.data);
    } else return;
  }
  return hash.digest("hex");
}

export function readImageNumberData(value: unknown): ImageNumberData | undefined {
  if (!value || typeof value !== "object") return;
  const data = value as Partial<ImageNumberData>;
  if (
    data.version !== 1 ||
    typeof data.timestamp !== "number" ||
    !Number.isSafeInteger(data.timestamp) ||
    data.timestamp < 0 ||
    typeof data.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.fingerprint) ||
    !Array.isArray(data.numbers) ||
    data.numbers.length > 65536 ||
    !data.numbers.some((number) => number !== null) ||
    !data.numbers.every((number) => number === null || (Number.isSafeInteger(number) && number > 0))
  )
    return;
  return {
    version: 1,
    timestamp: data.timestamp,
    fingerprint: data.fingerprint,
    numbers: [...data.numbers],
  };
}

/** Keep an attachment's display annotation when Pi compacts its preceding entry. */
export function withImageNumberMetadata(
  projected: SessionEntry[],
  source: readonly SessionEntry[],
): SessionEntry[] {
  const visible = new Set(projected.map((entry) => entry.id));
  const byId = new Map(source.map((entry) => [entry.id, entry]));
  return projected.flatMap((entry) => {
    if (
      entry.type !== "message" ||
      entry.message.role !== "user" ||
      !Array.isArray(entry.message.content) ||
      !entry.message.content.some((block) => block?.type === "image")
    )
      return [entry];
    const seen = new Set([entry.id]);
    let parent = entry.parentId ? byId.get(entry.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      if (parent.type === "message" && parent.message.role === "user") break;
      if (parent.type === "custom" && parent.customType === IMAGE_NUMBERS_ENTRY_TYPE) {
        const data = readImageNumberData(parent.data);
        return !visible.has(parent.id) &&
          data?.timestamp === entry.message.timestamp &&
          data.fingerprint === imageContentFingerprint(entry.message.content)
          ? [parent, entry]
          : [entry];
      }
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return [entry];
  });
}

/** Observations only: Pi retains input handling and queue delivery. */
export class ImageNumberObservations {
  private inputs: Pick<ImageNumberData, "fingerprint" | "numbers">[] = [];
  private count = 0;
  private reliable = true;

  remember(content: unknown, numbers: (number | null)[], pending: boolean): void {
    if (!pending) this.clear();
    if (!numbers.some((number) => number !== null) || !this.reliable) return;
    if (this.inputs.length >= 256 || this.count + numbers.length > 65536) {
      this.clear();
      this.reliable = false;
      return;
    }
    const fingerprint = imageContentFingerprint(content);
    if (!fingerprint) return;
    this.inputs.push({ fingerprint, numbers: [...numbers] });
    this.count += numbers.length;
  }

  delivered(content: unknown, timestamp: number, pending: boolean): ImageNumberData | undefined {
    const fingerprint = imageContentFingerprint(content);
    const matches = this.inputs.filter((input) => input.fingerprint === fingerprint);
    let result: Pick<ImageNumberData, "fingerprint" | "numbers"> | undefined = matches[0];
    if (
      result &&
      matches.some((input) => JSON.stringify(input.numbers) !== JSON.stringify(result?.numbers))
    ) {
      // Identical public payloads with conflicting observations are ambiguous.
      this.inputs = this.inputs.filter((input) => input.fingerprint !== fingerprint);
      this.count -= matches.reduce((total, input) => total + input.numbers.length, 0);
      result = undefined;
    } else if (result) {
      this.inputs.splice(this.inputs.indexOf(result), 1);
      this.count -= result.numbers.length;
    }
    if (!pending) this.clear();
    return result ? { version: 1, timestamp, ...result } : undefined;
  }

  clear(): void {
    this.inputs = [];
    this.count = 0;
    this.reliable = true;
  }
}
