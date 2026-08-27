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
  type Theme,
  type ToolRenderResultOptions,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
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
}

type ReadDefinition = ReturnType<typeof createReadToolDefinition>;
type BashDefinition = ReturnType<typeof createBashToolDefinition>;
type EditDefinition = ReturnType<typeof createEditToolDefinition>;
type WriteDefinition = ReturnType<typeof createWriteToolDefinition>;

// ===== 辅助函数 =====

function contextForOriginal<T extends { lastComponent: unknown }>(context: T): T {
  if (!(context.lastComponent instanceof ThreeLayerToolView)) return context;
  return { ...context, lastComponent: undefined };
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

function formatDiff(diff: string, theme: Theme): string[] {
  return splitLines(diff).map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) return theme.fg("success", line);
    if (line.startsWith("-") && !line.startsWith("---")) return theme.fg("error", line);
    return theme.fg("toolOutput", line);
  });
}

// ===== READ 工具渲染器（三层版本）=====

export function createThreeLayerReadDefinition(
  cwd: string,
  mode: ToolRendererMode,
  original: ReadDefinition = createReadToolDefinition(cwd),
): ReadDefinition {
  return {
    ...original,
    renderCall(args: ReadToolInput, theme, context) {
      if (!mode.enabled && original.renderCall) {
        return original.renderCall(args, theme, contextForOriginal(context));
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

      return new ThreeLayerToolView("collapsed", summary, [], theme);
    },

    renderResult(result, options, theme, context) {
      if (!mode.enabled && original.renderResult) {
        return original.renderResult(result, options, theme, contextForOriginal(context));
      }

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
    renderCall(args: BashToolInput, theme, context) {
      if (!mode.enabled && original.renderCall) {
        return original.renderCall(args, theme, contextForOriginal(context));
      }

      const meta = args.timeout ? `timeout ${args.timeout}s` : undefined;
      const summary: ToolSummary = {
        action: "bash",
        target: cleanSingleLine(args.command, "(command pending)"),
        status: callState(context),
        meta,
        attention: false,
      };

      return new ThreeLayerToolView("collapsed", summary, [], theme);
    },

    renderResult(result, options, theme, context) {
      if (!mode.enabled && original.renderResult) {
        return original.renderResult(result, options, theme, contextForOriginal(context));
      }

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
    renderCall(args: EditToolInput, theme, context) {
      if (!mode.enabled && original.renderCall) {
        return original.renderCall(args, theme, contextForOriginal(context));
      }

      const count = Array.isArray(args.edits) ? args.edits.length : 0;
      const summary: ToolSummary = {
        action: "edit",
        target: truncatePath(cleanSingleLine(args.path, "(path pending)"), 56),
        status: callState(context),
        meta: `${count} replacement${count === 1 ? "" : "s"}`,
        attention: false,
      };

      return new ThreeLayerToolView("collapsed", summary, [], theme);
    },

    renderResult(result, options, theme, context) {
      if (!mode.enabled && original.renderResult) {
        return original.renderResult(result, options, theme, contextForOriginal(context));
      }

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
        action: "edit",
        target: truncatePath(cleanSingleLine(args.path, "(unknown path)"), 56),
        status: state,
        meta,
        attention: context.isError,
      };

      const displayMode: DisplayMode = options.expanded ? "expanded" : mode.defaultMode;

      // 详情：优先显示 diff，否则显示错误输出
      const detailLines = details?.diff
        ? formatDiff(details.diff, theme)
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
    renderCall(args: WriteToolInput, theme, context) {
      if (!mode.enabled && original.renderCall) {
        return original.renderCall(args, theme, contextForOriginal(context));
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
      const displayMode: DisplayMode = context.expanded ? "preview" : "collapsed";
      const detailLines = formatLines(splitLines(content), theme);

      return new ThreeLayerToolView(displayMode, summary, detailLines, theme);
    },

    renderResult(result, options, theme, context) {
      if (!mode.enabled && original.renderResult) {
        return original.renderResult(result, options, theme, contextForOriginal(context));
      }

      const output = textOutput(result);
      const state = resultState(options, context, output);
      const args = context.args as WriteToolInput;

      const meta = context.isError
        ? extractErrorSummary(output)
        : `${readLineCount(args.content)} lines written`;

      const summary: ToolSummary = {
        action: "write",
        target: truncatePath(cleanSingleLine(args.path, "(unknown path)"), 56),
        status: state,
        meta,
        attention: context.isError,
      };

      const displayMode: DisplayMode = options.expanded ? "expanded" : "collapsed";
      const detailLines = context.isError ? formatLines(splitLines(output), theme) : [];

      return new ThreeLayerToolView(displayMode, summary, detailLines, theme);
    },
  };
}

// ===== 注册函数 =====

export function registerThreeLayerToolRenderers(
  pi: ExtensionAPI,
  mode: ToolRendererMode,
  cwd: string = process.cwd(),
): void {
  pi.registerTool(createThreeLayerReadDefinition(cwd, mode));
  pi.registerTool(createThreeLayerBashDefinition(cwd, mode));
  pi.registerTool(createThreeLayerEditDefinition(cwd, mode));
  pi.registerTool(createThreeLayerWriteDefinition(cwd, mode));
}
