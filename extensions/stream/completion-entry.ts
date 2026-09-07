import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type RunCompletion, renderRunCompletion } from "./run-presentation.ts";

export const COMPLETION_ENTRY_TYPE = "pi-tuix-run-completion";

export interface CompletionEntryData extends RunCompletion {
  version: 1;
}

/** Ignore unknown versions and malformed imported UI metadata. */
export function readCompletionEntry(value: unknown): CompletionEntryData | undefined {
  if (typeof value !== "object" || value === null) return;
  const data = value as Partial<CompletionEntryData>;
  if (
    data.version !== 1 ||
    typeof data.durationMs !== "number" ||
    !Number.isFinite(data.durationMs) ||
    data.durationMs < 0 ||
    typeof data.finishedAt !== "number" ||
    !Number.isFinite(new Date(data.finishedAt).getTime()) ||
    typeof data.failedTools !== "number" ||
    !Number.isSafeInteger(data.failedTools) ||
    data.failedTools < 0 ||
    !["done", "error", "cancelled", "stopped"].includes(data.outcome ?? "")
  )
    return;
  return {
    version: 1,
    durationMs: data.durationMs,
    finishedAt: data.finishedAt,
    outcome: data.outcome as RunCompletion["outcome"],
    failedTools: data.failedTools,
  };
}

export function registerCompletionEntries(
  pi: ExtensionAPI,
  enabled: () => boolean,
  ascii: () => boolean,
): void {
  pi.registerEntryRenderer(COMPLETION_ENTRY_TYPE, (entry, _options, theme) => {
    const completion = readCompletionEntry(entry.data);
    if (!enabled() || !completion) return;
    return {
      render: (width) => (enabled() ? renderRunCompletion(completion, theme, width, ascii()) : []),
      invalidate() {},
    };
  });
}
