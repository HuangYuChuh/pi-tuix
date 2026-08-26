import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type AgentToolResult,
  type BashToolDetails,
  type BashToolInput,
  type EditToolDetails,
  type EditToolInput,
  type ExtensionAPI,
  type ReadToolDetails,
  type ReadToolInput,
  type Theme,
  type ToolRenderResultOptions,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { CompactToolView } from "./compact-view.ts";

type ToolState = "QUEUED" | "RUNNING" | "OK" | "ERROR" | "CANCELLED";

export interface ToolRendererMode {
  enabled: boolean;
}

type ReadDefinition = ReturnType<typeof createReadToolDefinition>;
type BashDefinition = ReturnType<typeof createBashToolDefinition>;
type EditDefinition = ReturnType<typeof createEditToolDefinition>;
type WriteDefinition = ReturnType<typeof createWriteToolDefinition>;

function contextForOriginal<T extends { lastComponent: unknown }>(context: T): T {
  if (!(context.lastComponent instanceof CompactToolView)) return context;
  return { ...context, lastComponent: undefined };
}

function cleanSingleLine(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function textOutput(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((item): item is Extract<(typeof result.content)[number], { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function hasImage(result: AgentToolResult<unknown>): boolean {
  return result.content.some((item) => item.type === "image");
}

function isCancellation(text: string): boolean {
  return /\b(abort(?:ed)?|cancel(?:led|ed)?)\b/i.test(text);
}

function resultState(options: ToolRenderResultOptions, context: { isError: boolean }, output: string): ToolState {
  if (options.isPartial) return "RUNNING";
  if (!context.isError) return "OK";
  return isCancellation(output) ? "CANCELLED" : "ERROR";
}

function stateStyle(theme: Theme, state: ToolState, text: string): string {
  if (state === "OK") return theme.fg("success", text);
  if (state === "ERROR") return theme.fg("error", text);
  if (state === "CANCELLED") return theme.fg("warning", text);
  return theme.fg("warning", text);
}

function createView(
  theme: Theme,
  action: string,
  target: string,
  state: ToolState,
  meta?: string,
  details: string[] = [],
): CompactToolView {
  const actionText = theme.fg("toolTitle", theme.bold(action.toUpperCase()));
  const targetText = theme.fg("accent", `${target}${meta ? ` | ${meta}` : ""}`);
  const attention = state === "ERROR" ? "ATTENTION" : "CLEAR";
  const stateText = stateStyle(theme, state, `[${state}]`);
  const attentionText = state === "ERROR" ? theme.fg("error", attention) : theme.fg("dim", attention);
  return new CompactToolView({ action: actionText, target: targetText, suffix: `${stateText} ${attentionText}` }, details);
}

function outputDetails(output: string, theme: Theme): string[] {
  if (!output) return [];
  return splitLines(output).map((line) => theme.fg("toolOutput", line));
}

function errorSummary(output: string): string {
  const lines = splitLines(output).map((line) => line.trim()).filter(Boolean);
  const commandStatus = [...lines].reverse().find((line) => /^Command (?:exited|aborted|timed out)/i.test(line));
  return cleanSingleLine(commandStatus ?? lines[0], "failed");
}

function callState(context: { executionStarted: boolean }): ToolState {
  return context.executionStarted ? "RUNNING" : "QUEUED";
}

function readLineCount(output: string): number {
  if (!output) return 0;
  return splitLines(output).length;
}

function diffStats(diff: string): { additions: number; removals: number } {
  let additions = 0;
  let removals = 0;
  for (const line of splitLines(diff)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removals += 1;
  }
  return { additions, removals };
}

function diffDetails(diff: string, theme: Theme): string[] {
  return splitLines(diff).map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) return theme.fg("success", line);
    if (line.startsWith("-") && !line.startsWith("---")) return theme.fg("error", line);
    return theme.fg("toolOutput", line);
  });
}

export function createCompactReadDefinition(
  cwd: string,
  mode: ToolRendererMode,
  original: ReadDefinition = createReadToolDefinition(cwd),
): ReadDefinition {
  return {
    ...original,
    renderCall(args: ReadToolInput, theme, context) {
      if (!mode.enabled && original.renderCall) return original.renderCall(args, theme, contextForOriginal(context));
      const range = args.offset || args.limit
        ? `lines ${args.offset ?? 1}-${args.limit ? (args.offset ?? 1) + args.limit - 1 : "end"}`
        : undefined;
      return createView(theme, "read", cleanSingleLine(args.path, "(path pending)"), callState(context), range);
    },
    renderResult(result, options, theme, context) {
      if (!mode.enabled && original.renderResult) {
        return original.renderResult(result, options, theme, contextForOriginal(context));
      }
      const output = textOutput(result);
      const state = resultState(options, context, output);
      const details = result.details as ReadToolDetails | undefined;
      let meta = hasImage(result) ? "image" : `${readLineCount(output)} lines`;
      if (details?.truncation?.truncated) {
        const shown = details.truncation.outputLines ?? readLineCount(output);
        const total = details.truncation.totalLines;
        meta = total ? `truncated ${shown}/${total} lines` : `truncated ${shown} lines`;
      }
      if (context.isError) meta = errorSummary(output);
      return createView(
        theme,
        "read",
        cleanSingleLine((context.args as ReadToolInput).path, "(unknown path)"),
        state,
        meta,
        options.expanded ? outputDetails(output, theme) : [],
      );
    },
  };
}

export function createCompactBashDefinition(
  cwd: string,
  mode: ToolRendererMode,
  original: BashDefinition = createBashToolDefinition(cwd),
): BashDefinition {
  return {
    ...original,
    renderCall(args: BashToolInput, theme, context) {
      if (!mode.enabled && original.renderCall) return original.renderCall(args, theme, contextForOriginal(context));
      const meta = args.timeout ? `timeout ${args.timeout}s` : undefined;
      return createView(theme, "bash", cleanSingleLine(args.command, "(command pending)"), callState(context), meta);
    },
    renderResult(result, options, theme, context) {
      if (!mode.enabled && original.renderResult) {
        return original.renderResult(result, options, theme, contextForOriginal(context));
      }
      const output = textOutput(result);
      const state = resultState(options, context, output);
      const details = result.details as BashToolDetails | undefined;
      let meta = context.isError ? errorSummary(output) : `${splitLines(output).filter((line) => line.trim()).length} output lines`;
      if (details?.truncation?.truncated) meta += " | truncated";
      return createView(
        theme,
        "bash",
        cleanSingleLine((context.args as BashToolInput).command, "(unknown command)"),
        state,
        meta,
        options.expanded ? outputDetails(output, theme) : [],
      );
    },
  };
}

export function createCompactEditDefinition(
  cwd: string,
  mode: ToolRendererMode,
  original: EditDefinition = createEditToolDefinition(cwd),
): EditDefinition {
  return {
    ...original,
    renderCall(args: EditToolInput, theme, context) {
      if (!mode.enabled && original.renderCall) return original.renderCall(args, theme, contextForOriginal(context));
      const count = Array.isArray(args.edits) ? args.edits.length : 0;
      return createView(
        theme,
        "edit",
        cleanSingleLine(args.path, "(path pending)"),
        callState(context),
        `${count} replacement${count === 1 ? "" : "s"}`,
      );
    },
    renderResult(result, options, theme, context) {
      if (!mode.enabled && original.renderResult) {
        return original.renderResult(result, options, theme, contextForOriginal(context));
      }
      const output = textOutput(result);
      const state = resultState(options, context, output);
      const details = result.details as EditToolDetails | undefined;
      const stats = details?.diff ? diffStats(details.diff) : undefined;
      const meta = context.isError
        ? errorSummary(output)
        : stats
          ? `+${stats.additions} -${stats.removals}`
          : "applied";
      return createView(
        theme,
        "edit",
        cleanSingleLine((context.args as EditToolInput).path, "(unknown path)"),
        state,
        meta,
        options.expanded && details?.diff
          ? diffDetails(details.diff, theme)
          : options.expanded && context.isError
            ? outputDetails(output, theme)
            : [],
      );
    },
  };
}

export function createCompactWriteDefinition(
  cwd: string,
  mode: ToolRendererMode,
  original: WriteDefinition = createWriteToolDefinition(cwd),
): WriteDefinition {
  return {
    ...original,
    renderCall(args: WriteToolInput, theme, context) {
      if (!mode.enabled && original.renderCall) return original.renderCall(args, theme, contextForOriginal(context));
      const content = typeof args.content === "string" ? args.content : "";
      return createView(
        theme,
        "write",
        cleanSingleLine(args.path, "(path pending)"),
        callState(context),
        `${readLineCount(content)} lines`,
        context.expanded ? outputDetails(content, theme) : [],
      );
    },
    renderResult(result, options, theme, context) {
      if (!mode.enabled && original.renderResult) {
        return original.renderResult(result, options, theme, contextForOriginal(context));
      }
      const output = textOutput(result);
      const state = resultState(options, context, output);
      const args = context.args as WriteToolInput;
      const meta = context.isError ? errorSummary(output) : `${readLineCount(args.content)} lines written`;
      return createView(
        theme,
        "write",
        cleanSingleLine(args.path, "(unknown path)"),
        state,
        meta,
        options.expanded && context.isError ? outputDetails(output, theme) : [],
      );
    },
  };
}

export function registerCompactToolRenderers(
  pi: ExtensionAPI,
  mode: ToolRendererMode,
  cwd: string = process.cwd(),
): void {
  pi.registerTool(createCompactReadDefinition(cwd, mode));
  pi.registerTool(createCompactBashDefinition(cwd, mode));
  pi.registerTool(createCompactEditDefinition(cwd, mode));
  pi.registerTool(createCompactWriteDefinition(cwd, mode));
}
