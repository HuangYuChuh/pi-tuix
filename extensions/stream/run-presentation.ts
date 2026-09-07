import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { fmtTokens, formatDuration } from "../shell/open-tui/utils.ts";

export interface RunCompletion {
  durationMs: number;
  finishedAt: number;
  outcome: "done" | "error" | "cancelled" | "stopped";
  failedTools: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export class RunPresentation {
  private startedAt: number | undefined;
  private endedAt: number | undefined;
  private settled = true;
  private outputTokens = new Map<string, number>();
  private failedTools = new Set<string>();
  private toolCancelled = false;
  private outcome: RunCompletion["outcome"] = "stopped";
  completion: RunCompletion | undefined;

  reset(): void {
    this.startedAt = undefined;
    this.endedAt = undefined;
    this.settled = true;
    this.outputTokens.clear();
    this.failedTools.clear();
    this.toolCancelled = false;
    this.completion = undefined;
    this.outcome = "stopped";
  }

  begin(now = Date.now()): void {
    if (this.settled) this.reset();
    this.startedAt ??= now;
    this.endedAt = undefined;
    this.settled = false;
  }

  observeMessage(value: unknown): void {
    if (this.settled) return;
    const message = record(value);
    if (message?.role !== "assistant" || typeof message.timestamp !== "number") return;
    const output = record(message.usage)?.output;
    if (typeof output !== "number" || !Number.isFinite(output) || output < 0) return;
    const key = `${message.provider}/${message.model}/${message.timestamp}`;
    this.outputTokens.set(key, output);
  }

  observeTool(id: string, value: unknown, isError: boolean): void {
    if (this.settled || !isError) return;
    this.failedTools.add(id);
    const content = record(value)?.content;
    if (Array.isArray(content)) {
      this.toolCancelled ||= content.some((part) => {
        const text = record(part)?.text;
        return typeof text === "string" && /\b(abort(?:ed)?|cancel(?:led|ed)?)\b/i.test(text);
      });
    }
  }

  end(messages: readonly unknown[], now = Date.now()): void {
    if (this.startedAt === undefined || this.settled) return;
    this.endedAt = now;
    const last = messages
      .map(record)
      .filter((message) => message?.role === "assistant")
      .at(-1);
    const reason = last?.stopReason;
    const aborted =
      reason === "aborted" ||
      (reason === "error" &&
        typeof last?.errorMessage === "string" &&
        /\b(abort(?:ed)?|cancel(?:led|ed)?)\b/i.test(last.errorMessage));
    this.outcome =
      reason === "stop"
        ? "done"
        : aborted
          ? "cancelled"
          : reason === "error"
            ? "error"
            : this.toolCancelled
              ? "cancelled"
              : "stopped";
  }

  settle(now = Date.now()): RunCompletion | undefined {
    if (this.startedAt === undefined || this.settled) return;
    const finishedAt = this.endedAt ?? now;
    this.completion = {
      durationMs: Math.max(0, finishedAt - this.startedAt),
      finishedAt,
      outcome: this.outcome,
      failedTools: this.failedTools.size,
    };
    this.settled = true;
    return this.completion;
  }

  workingMessage(label: string, now = Date.now(), ascii = false): string {
    if (this.startedAt === undefined || this.settled) return label;
    const elapsed = Math.max(0, now - this.startedAt);
    const tokens = [...this.outputTokens.values()].reduce((sum, count) => sum + count, 0);
    const details: string[] = [];
    if (elapsed >= 1000) details.push(formatDuration(elapsed));
    if (tokens > 0) details.push(`${ascii ? "out" : "↓"} ${fmtTokens(tokens)} tokens`);
    return details.length ? `${label} (${details.join(ascii ? " | " : " · ")})` : label;
  }
}

export function renderRunCompletion(
  completion: RunCompletion,
  theme: Theme,
  width: number,
  ascii = false,
): string[] {
  if (width <= 0) return [];
  if (completion.outcome === "cancelled") {
    const text = ascii
      ? "  L  Interrupted | What should Pi do instead?"
      : "  ⎿  Interrupted · What should Pi do instead?";
    return [truncateToWidth(theme.fg("dim", text), width)];
  }
  const duration = formatDuration(completion.durationMs);
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
    .format(completion.finishedAt)
    .replace(/\s/g, " ");
  const description =
    completion.outcome === "done"
      ? `Worked for ${duration} · done ${clock}`
      : completion.outcome === "error"
        ? `Failed after ${duration} · stopped ${clock}`
        : `Stopped after ${duration} · ${clock}`;
  const color =
    completion.outcome === "error" ? "error" : completion.outcome === "done" ? "dim" : "warning";
  const failures =
    completion.failedTools > 0
      ? theme.fg(
          "error",
          ` · ${completion.failedTools} tool${completion.failedTools === 1 ? "" : "s"} failed`,
        )
      : "";
  const line = `${theme.fg(color, `${ascii ? "*" : "✻"} ${description}`)}${failures}`;
  return [truncateToWidth(ascii ? line.replaceAll(" · ", " | ") : line, width)];
}
