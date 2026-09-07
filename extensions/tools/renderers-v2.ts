import {
  type AgentToolResult,
  type BashToolDetails,
  type BashToolInput,
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type EditToolDetails,
  type EditToolInput,
  type ExtensionAPI,
  type ReadToolDetails,
  type ReadToolInput,
  renderDiff,
  type Theme,
  type ToolRenderResultOptions,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  sliceByColumn,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  type DisplayMode,
  diffStats,
  extractErrorSummary,
  ThreeLayerToolView,
  type ToolStatus,
  type ToolSummary,
  truncatePath,
} from "./three-layer-view.ts";

export interface ToolRendererMode {
  enabled: boolean;
  defaultMode: DisplayMode; // collapsed | preview | expanded
  observe?: (toolCallId: string, invalidate: () => void) => void;
}

type ReadDefinition = ReturnType<typeof createReadToolDefinition>;
type BashDefinition = ReturnType<typeof createBashToolDefinition>;
type EditDefinition = ReturnType<typeof createEditToolDefinition>;
type WriteDefinition = ReturnType<typeof createWriteToolDefinition>;

// ===== 辅助函数 =====

const emptyResult: Component = { render: () => [], invalidate() {} };

function renderOriginal<
  T extends { state: unknown; lastComponent: unknown; isPartial: boolean; isError: boolean },
>(
  slot: "call" | "result",
  context: T,
  theme: Theme,
  shell: "self" | "default" | undefined,
  render: (context: T) => Component,
): Component {
  const state = context.state as SharedPresentationState;
  const component = render({
    ...context,
    lastComponent: slot === "call" ? state.pituixNativeCall : state.pituixNativeResult,
  });
  if (slot === "call") state.pituixNativeCall = component;
  else {
    state.pituixNativeResult = component;
    state.pituixNativePartial = context.isPartial;
  }
  if (shell === "self") return component;

  // Pi 0.84 keeps the original shell container attached after renderShell changes.
  // Keep "self" stable and compose the native default frame with public components.
  state.pituixNativeBox ??= new Box(1, 1);
  const box = state.pituixNativeBox;
  const background = context.isPartial
    ? "toolPendingBg"
    : context.isError
      ? "toolErrorBg"
      : "toolSuccessBg";
  box.setBgFn((text) => theme.bg(background, text));
  box.clear();
  if (state.pituixNativeCall) box.addChild(state.pituixNativeCall);
  if (state.pituixNativeResult) box.addChild(state.pituixNativeResult);
  return slot === "call" ? box : emptyResult;
}

function cleanSingleLine(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function splitLines(value: string): string[] {
  if (!value) return [];
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function textOutput(result: AgentToolResult<unknown>): string {
  return result.content
    .filter(
      (item): item is Extract<(typeof result.content)[number], { type: "text" }> =>
        item.type === "text",
    )
    .map((item) => item.text)
    .join("\n");
}

function hasImage(result: AgentToolResult<unknown>): boolean {
  return result.content.some((item) => item.type === "image");
}

function isCancellation(text: string): boolean {
  return /\b(abort(?:ed)?|cancel(?:led|ed)?)\b/i.test(text);
}

function resultState(
  options: ToolRenderResultOptions,
  context: { isError: boolean },
  output: string,
): ToolStatus {
  if (options.isPartial) return "RUNNING";
  if (!context.isError) return "OK";
  return isCancellation(output) ? "CANCELLED" : "ERROR";
}

function callState(context: { executionStarted: boolean }): ToolStatus {
  return context.executionStarted ? "RUNNING" : "QUEUED";
}

function readLineCount(output: string): number {
  if (!output) return 0;
  return splitLines(output).length;
}

function formatLines(lines: string[], theme: Theme): string[] {
  return lines.map((line) => theme.fg("toolOutput", line));
}

function numberedLines(content: string, theme: Theme): string[] {
  const lines = splitLines(content);
  if (lines.at(-1) === "") lines.pop();
  const digits = Math.max(2, String(lines.length).length);
  return lines.map(
    (line, index) =>
      `${theme.fg("dim", String(index + 1).padStart(digits))} ${theme.fg("toolOutput", line)}`,
  );
}

function numberedDiff(diff: string, theme: Theme): string[] {
  const rows = splitLines(renderDiff(diff)).map((styled) => ({
    styled,
    prefix: stripTerminalSequences(styled).match(/^([+ -])(\s*\d+) /),
  }));
  const digits = Math.max(2, ...rows.map(({ prefix }) => prefix?.[2].trim().length ?? 0));
  return rows.map(({ styled, prefix }) => {
    // Unknown host formats retain their original presentation.
    if (!prefix) return styled;
    const sign = prefix[1];
    const color =
      sign === "+" ? "toolDiffAdded" : sign === "-" ? "toolDiffRemoved" : "toolDiffContext";
    const body = sliceByColumn(styled, prefix[0].length, visibleWidth(styled));
    return `${theme.fg("dim", prefix[2].trim().padStart(digits))} ${theme.fg(color, sign)}${body}`;
  });
}

interface SharedPresentationState {
  pituixHasResult?: boolean;
  pituixNativeCall?: Component;
  pituixNativeResult?: Component;
  pituixNativeBox?: Box;
  pituixNativePartial?: boolean;
}

class PendingToolView extends ThreeLayerToolView {
  private readonly shared: SharedPresentationState;
  constructor(summary: ToolSummary, theme: Theme, shared: SharedPresentationState) {
    super("collapsed", summary, [], theme);
    this.shared = shared;
  }
  override render(width: number): string[] {
    return this.shared.pituixHasResult ? [] : super.render(width);
  }
}

// ===== READ 工具渲染器（三层版本）=====

export function createThreeLayerReadDefinition(
  cwd: string,
  mode: ToolRendererMode,
  original: ReadDefinition = createReadToolDefinition(cwd),
): ReadDefinition {
  return {
    ...original,
    renderShell: "self",
    renderCall(args: ReadToolInput, theme, context) {
      mode.observe?.(context.toolCallId, context.invalidate);
      const nativeCall = original.renderCall;
      if (!mode.enabled && nativeCall) {
        return renderOriginal("call", context, theme, original.renderShell, (nativeContext) =>
          nativeCall(args, theme, nativeContext),
        );
      }

      const range =
        args.offset || args.limit
          ? `lines ${args.offset ?? 1}-${args.limit ? (args.offset ?? 1) + args.limit - 1 : "end"}`
          : undefined;

      const summary: ToolSummary = {
        action: "read",
        target: truncatePath(cleanSingleLine(args.path, "(path pending)"), 56),
        status: callState(context),
        meta: range,
        attention: false,
      };

      return new PendingToolView(
        summary,
        theme,
        context.state as unknown as SharedPresentationState,
      );
    },

    renderResult(result, options, theme, context) {
      mode.observe?.(context.toolCallId, context.invalidate);
      const nativeResult = original.renderResult;
      const shared = context.state as SharedPresentationState;
      if (nativeResult && (!mode.enabled || (shared.pituixNativePartial && !options.isPartial))) {
        // A native running renderer must receive completion even after a UI mode switch.
        const native = renderOriginal(
          "result",
          context,
          theme,
          original.renderShell,
          (nativeContext) => nativeResult(result, options, theme, nativeContext),
        );
        if (!mode.enabled) return native;
      }

      (context.state as unknown as SharedPresentationState).pituixHasResult = true;
      const output = textOutput(result);
      const state = resultState(options, context, output);
      const details = result.details as ReadToolDetails | undefined;
      const args = context.args as ReadToolInput;

      // 计算元信息
      let meta = hasImage(result) ? "image" : `${readLineCount(output)} lines`;
      if (details?.truncation?.truncated) {
        const shown = details.truncation.outputLines ?? readLineCount(output);
        const total = details.truncation.totalLines;
        meta = total ? `truncated ${shown}/${total} lines` : `truncated ${shown} lines`;
      }
      if (context.isError) {
        meta = extractErrorSummary(output);
      }

      const summary: ToolSummary = {
        action: "read",
        target: truncatePath(cleanSingleLine(args.path, "(unknown path)"), 56),
        status: state,
        meta,
        attention: context.isError,
        resultSummary: context.isError
          ? undefined
          : `${state === "OK" ? "Read" : "Reading"} ${meta}`,
        previewDetails: context.isError,
      };

      // 决定显示模式
      const displayMode: DisplayMode = options.expanded ? "expanded" : mode.defaultMode;

      // 准备详情行
      const detailLines = formatLines(splitLines(output), theme);

      return new ThreeLayerToolView(displayMode, summary, detailLines, theme);
    },
  };
}

// ===== BASH 工具渲染器（三层版本）=====

export function createThreeLayerBashDefinition(
  cwd: string,
  mode: ToolRendererMode,
  original: BashDefinition = createBashToolDefinition(cwd),
): BashDefinition {
  return {
    ...original,
    renderShell: "self",
    renderCall(args: BashToolInput, theme, context) {
      mode.observe?.(context.toolCallId, context.invalidate);
      const nativeCall = original.renderCall;
      if (!mode.enabled && nativeCall) {
        return renderOriginal("call", context, theme, original.renderShell, (nativeContext) =>
          nativeCall(args, theme, nativeContext),
        );
      }

      const meta = args.timeout ? `timeout ${args.timeout}s` : undefined;
      const summary: ToolSummary = {
        action: "bash",
        target: cleanSingleLine(args.command, "(command pending)"),
        status: callState(context),
        meta,
        attention: false,
      };

      return new PendingToolView(
        summary,
        theme,
        context.state as unknown as SharedPresentationState,
      );
    },

    renderResult(result, options, theme, context) {
      mode.observe?.(context.toolCallId, context.invalidate);
      const nativeResult = original.renderResult;
      const shared = context.state as SharedPresentationState;
      if (nativeResult && (!mode.enabled || (shared.pituixNativePartial && !options.isPartial))) {
        // A native running renderer must receive completion even after a UI mode switch.
        const native = renderOriginal(
          "result",
          context,
          theme,
          original.renderShell,
          (nativeContext) => nativeResult(result, options, theme, nativeContext),
        );
        if (!mode.enabled) return native;
      }

      (context.state as unknown as SharedPresentationState).pituixHasResult = true;
      const output = textOutput(result);
      const state = resultState(options, context, output);
      const details = result.details as BashToolDetails | undefined;
      const args = context.args as BashToolInput;

      let meta = context.isError
        ? extractErrorSummary(output)
        : `${splitLines(output).filter((line) => line.trim()).length} output lines`;
      if (details?.truncation?.truncated) meta += " | truncated";

      const summary: ToolSummary = {
        action: "bash",
        target: cleanSingleLine(args.command, "(unknown command)"),
        status: state,
        meta,
        attention: context.isError,
      };

      const displayMode: DisplayMode = options.expanded ? "expanded" : mode.defaultMode;
      const detailLines = formatLines(splitLines(output), theme);

      return new ThreeLayerToolView(displayMode, summary, detailLines, theme);
    },
  };
}

// ===== EDIT 工具渲染器（三层版本）=====

export function createThreeLayerEditDefinition(
  cwd: string,
  mode: ToolRendererMode,
  original: EditDefinition = createEditToolDefinition(cwd),
): EditDefinition {
  return {
    ...original,
    renderShell: "self",
    renderCall(args: EditToolInput, theme, context) {
      mode.observe?.(context.toolCallId, context.invalidate);
      const nativeCall = original.renderCall;
      if (!mode.enabled && nativeCall) {
        return renderOriginal("call", context, theme, original.renderShell, (nativeContext) =>
          nativeCall(args, theme, nativeContext),
        );
      }

      const count = Array.isArray(args.edits) ? args.edits.length : 0;
      const summary: ToolSummary = {
        action: "update",
        target: truncatePath(cleanSingleLine(args.path, "(path pending)"), 56),
        status: callState(context),
        meta: `${count} replacement${count === 1 ? "" : "s"}`,
        attention: false,
      };

      return new PendingToolView(
        summary,
        theme,
        context.state as unknown as SharedPresentationState,
      );
    },

    renderResult(result, options, theme, context) {
      mode.observe?.(context.toolCallId, context.invalidate);
      const nativeResult = original.renderResult;
      const shared = context.state as SharedPresentationState;
      if (nativeResult && (!mode.enabled || (shared.pituixNativePartial && !options.isPartial))) {
        // A native running renderer must receive completion even after a UI mode switch.
        const native = renderOriginal(
          "result",
          context,
          theme,
          original.renderShell,
          (nativeContext) => nativeResult(result, options, theme, nativeContext),
        );
        if (!mode.enabled) return native;
      }

      (context.state as unknown as SharedPresentationState).pituixHasResult = true;
      const output = textOutput(result);
      const state = resultState(options, context, output);
      const details = result.details as EditToolDetails | undefined;
      const args = context.args as EditToolInput;

      const stats = details?.diff ? diffStats(details.diff) : undefined;
      const meta = context.isError
        ? extractErrorSummary(output)
        : stats
          ? `+${stats.additions} -${stats.removals}`
          : "applied";

      const summary: ToolSummary = {
        action: "update",
        target: truncatePath(cleanSingleLine(args.path, "(unknown path)"), 56),
        status: state,
        meta,
        attention: context.isError,
        resultSummary:
          state === "OK" && stats
            ? `Added ${stats.additions} line${stats.additions === 1 ? "" : "s"}, removed ${stats.removals} line${stats.removals === 1 ? "" : "s"}`
            : undefined,
      };

      const displayMode: DisplayMode = options.expanded ? "expanded" : mode.defaultMode;

      // 详情：优先显示 diff，否则显示错误输出
      const detailLines = details?.diff
        ? numberedDiff(details.diff, theme)
        : context.isError
          ? formatLines(splitLines(output), theme)
          : [];

      return new ThreeLayerToolView(displayMode, summary, detailLines, theme);
    },
  };
}

// ===== WRITE 工具渲染器（三层版本）=====

export function createThreeLayerWriteDefinition(
  cwd: string,
  mode: ToolRendererMode,
  original: WriteDefinition = createWriteToolDefinition(cwd),
): WriteDefinition {
  return {
    ...original,
    renderShell: "self",
    renderCall(args: WriteToolInput, theme, context) {
      mode.observe?.(context.toolCallId, context.invalidate);
      const nativeCall = original.renderCall;
      if (!mode.enabled && nativeCall) {
        return renderOriginal("call", context, theme, original.renderShell, (nativeContext) =>
          nativeCall(args, theme, nativeContext),
        );
      }

      const content = typeof args.content === "string" ? args.content : "";
      const summary: ToolSummary = {
        action: "write",
        target: truncatePath(cleanSingleLine(args.path, "(path pending)"), 56),
        status: callState(context),
        meta: `${readLineCount(content)} lines`,
        attention: false,
      };

      // Write 工具在 call 阶段可以 preview 内容
      return new PendingToolView(
        summary,
        theme,
        context.state as unknown as SharedPresentationState,
      );
    },

    renderResult(result, options, theme, context) {
      mode.observe?.(context.toolCallId, context.invalidate);
      const nativeResult = original.renderResult;
      const shared = context.state as SharedPresentationState;
      if (nativeResult && (!mode.enabled || (shared.pituixNativePartial && !options.isPartial))) {
        // A native running renderer must receive completion even after a UI mode switch.
        const native = renderOriginal(
          "result",
          context,
          theme,
          original.renderShell,
          (nativeContext) => nativeResult(result, options, theme, nativeContext),
        );
        if (!mode.enabled) return native;
      }

      (context.state as unknown as SharedPresentationState).pituixHasResult = true;
      const output = textOutput(result);
      const state = resultState(options, context, output);
      const args = context.args as WriteToolInput;
      const contentLines = numberedLines(
        typeof args.content === "string" ? args.content : "",
        theme,
      );

      const meta = context.isError
        ? extractErrorSummary(output)
        : `${contentLines.length} lines written`;

      const summary: ToolSummary = {
        action: "write",
        target: truncatePath(cleanSingleLine(args.path, "(unknown path)"), 56),
        status: state,
        meta,
        attention: context.isError,
        resultSummary: context.isError
          ? undefined
          : `${state === "OK" ? "Wrote" : "Writing"} ${contentLines.length} line${contentLines.length === 1 ? "" : "s"} to ${cleanSingleLine(args.path, "(unknown path)")}`,
      };

      const displayMode: DisplayMode = options.expanded ? "expanded" : mode.defaultMode;
      const detailLines = context.isError ? formatLines(splitLines(output), theme) : contentLines;

      return new ThreeLayerToolView(displayMode, summary, detailLines, theme);
    },
  };
}

// ===== 注册函数 =====

export function registerThreeLayerToolRenderers(
  pi: ExtensionAPI,
  mode: ToolRendererMode,
  cwd: string = process.cwd(),
) {
  const invalidators = new Map<string, () => void>();
  mode.observe = (id, invalidate) => invalidators.set(id, invalidate);
  pi.registerTool(createThreeLayerReadDefinition(cwd, mode));
  pi.registerTool(createThreeLayerBashDefinition(cwd, mode));
  pi.registerTool(createThreeLayerEditDefinition(cwd, mode));
  pi.registerTool(createThreeLayerWriteDefinition(cwd, mode));
  return {
    invalidate() {
      for (const invalidate of invalidators.values()) invalidate();
    },
    clear() {
      invalidators.clear();
    },
  };
}
