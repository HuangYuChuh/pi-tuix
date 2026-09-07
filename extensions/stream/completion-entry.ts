import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Component, Container, type TUI } from "@earendil-works/pi-tui";
import { type RunCompletion, renderRunCompletion } from "./run-presentation.ts";

export const COMPLETION_ENTRY_TYPE = "pi-tuix-run-completion";

export interface CompletionEntryData extends RunCompletion {
  version: 1;
  /** Observed when this run ended, never inferred from today's checkout. */
  gitBranch?: string;
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
    ...(typeof data.gitBranch === "string" &&
    data.gitBranch.length > 0 &&
    data.gitBranch.length <= 1024 &&
    !/\p{Cc}/u.test(data.gitBranch)
      ? { gitBranch: data.gitBranch }
      : {}),
  };
}

/** Keep the host entry mounted even when the extension starts disabled. */
class CompletionRow implements Component {
  readonly render: (width: number) => string[];

  constructor(render: (width: number) => string[]) {
    this.render = render;
  }

  invalidate(): void {}
}

/** Hide the host's entry spacer together with our content, using public children. */
class CompletionVisibility extends Container {
  readonly source: Container;
  private readonly enabled: () => boolean;

  constructor(source: Container, enabled: () => boolean) {
    super();
    this.source = source;
    this.enabled = enabled;
    this.addChild(source);
  }

  override render(width: number): string[] {
    return this.enabled() ? this.source.render(width) : [];
  }
}

export function registerCompletionEntries(
  pi: ExtensionAPI,
  enabled: () => boolean,
  ascii: () => boolean,
) {
  let tui: TUI | undefined;
  let queued = false;
  const compose = (parent: Container, remove = false): boolean => {
    let changed = false;
    for (let index = 0; index < parent.children.length; index++) {
      const child = parent.children[index];
      if (child instanceof CompletionVisibility) {
        if (remove) {
          parent.children[index] = child.source;
          changed = true;
        }
      } else if (child instanceof Container) {
        if (!remove && child.children.some((row) => row instanceof CompletionRow)) {
          parent.children[index] = new CompletionVisibility(child, enabled);
          changed = true;
        } else changed = compose(child, remove) || changed;
      }
    }
    return changed;
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    // Pi attaches a returned entry component after calling its renderer.
    queueMicrotask(() => {
      queued = false;
      if (tui && compose(tui)) tui.requestRender();
    });
  };
  pi.registerEntryRenderer(COMPLETION_ENTRY_TYPE, (entry, _options, theme) => {
    const completion = readCompletionEntry(entry.data);
    if (!completion) return;
    schedule();
    return new CompletionRow((width) =>
      enabled() ? renderRunCompletion(completion, theme, width, ascii()) : [],
    );
  });
  return {
    attach(ctx: ExtensionContext): void {
      if (ctx.mode !== "tui") return;
      // A zero-height public widget supplies the stable TUI reference without
      // replacing Pi's editor, including startup with our interface disabled.
      ctx.ui.setWidget("pituix-completion-visibility", (ui) => {
        tui = ui;
        schedule();
        return {
          render: () => [],
          invalidate() {},
          dispose() {
            compose(ui, true);
            if (tui === ui) tui = undefined;
          },
        };
      });
    },
    refresh(): void {
      tui?.invalidate();
      schedule();
      tui?.requestRender();
    },
    detach(ctx: ExtensionContext): void {
      ctx.ui.setWidget("pituix-completion-visibility", undefined);
    },
  };
}
