import { keyText, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/**
 * 三层 Tool 视图（基于 CodeWhale 模式）
 *
 * - Collapsed: 一行摘要（工具名 + 目标 + 状态 + 元信息）
 * - Preview: Header + 前2行 + "...N hidden" + 后2行
 * - Expanded: Header + 完整输出
 */

import { useAsciiChrome } from "../shell/open-tui/icons.ts";

export type DisplayMode = "collapsed" | "preview" | "expanded";
export type ToolStatus = "QUEUED" | "RUNNING" | "OK" | "ERROR" | "CANCELLED";
export type ToolDetailLine = string | ((width: number) => string);

export interface ToolSummary {
  action: string; // 工具名（READ/BASH/EDIT/WRITE）
  target: string; // 目标（文件路径/命令）
  status: ToolStatus;
  meta?: string; // 元信息（行数/时长/diff统计）
  attention: boolean; // 是否需要关注（错误时）
  resultSummary?: string;
  previewDetails?: boolean;
}

/**
 * 三层工具视图组件
 */
export class ThreeLayerToolView implements Component {
  private mode: DisplayMode;
  private summary: ToolSummary;
  private details: ToolDetailLine[];
  private theme: Theme;

  constructor(mode: DisplayMode, summary: ToolSummary, details: ToolDetailLine[], theme: Theme) {
    this.mode = mode;
    this.summary = summary;
    this.details = details;
    this.theme = theme;
  }

  setMode(mode: DisplayMode): void {
    this.mode = mode;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    if (width <= 0) return [];
    const safeWidth = width;

    // === Header 行（所有模式都显示）===
    lines.push(this.renderHeader(safeWidth));

    if (this.mode === "collapsed") {
      return lines;
    }

    const branch = useAsciiChrome() ? "  L  " : "  ⎿  ";
    const detailLine = (line: ToolDetailLine, first = false) => {
      const prefix = first ? branch : "     ";
      const content =
        typeof line === "string" ? line : line(Math.max(0, safeWidth - visibleWidth(prefix)));
      return truncateToWidth(`${prefix}${content}`, safeWidth);
    };
    if (this.summary.resultSummary) {
      lines.push(detailLine(this.theme.fg("dim", this.summary.resultSummary), true));
    }
    if (this.mode === "preview" && this.summary.previewDetails === false) return lines;

    // === Preview 模式：前2 + 后2 ===
    if (this.mode === "preview") {
      const visibleLines =
        this.details.length <= 4
          ? this.details
          : [...this.details.slice(0, 2), ...this.details.slice(-2)];
      const hidden = Math.max(0, this.details.length - visibleLines.length);

      visibleLines.slice(0, 2).forEach((line, index) => {
        lines.push(detailLine(line, index === 0 && !this.summary.resultSummary));
      });

      if (hidden > 0) {
        const hiddenLine = this.theme.fg(
          "dim",
          `     ... ${hidden} more lines hidden (${keyText("app.tools.expand") || "/pituix-mode expanded"} to expand)`,
        );
        lines.push(truncateToWidth(hiddenLine, safeWidth));
      }

      visibleLines.slice(2).forEach((line) => {
        lines.push(detailLine(line));
      });

      return lines;
    }

    // === Expanded 模式：完整输出 ===
    this.details.forEach((line, index) => {
      lines.push(detailLine(line, index === 0 && !this.summary.resultSummary));
    });

    return lines;
  }

  private renderHeader(width: number): string {
    // 格式：ACTION target [STATUS] meta | ATTENTION
    const action = this.theme.bold(
      this.theme.fg(
        "toolTitle",
        this.summary.action[0].toUpperCase() + this.summary.action.slice(1).toLowerCase(),
      ),
    );
    const target = this.theme.fg("accent", this.summary.target);
    const statusLabel = this.statusLabel(this.summary.status);
    const statusText = this.statusStyle(this.summary.status, `[${statusLabel}]`);

    let suffix = statusText;
    if (this.summary.meta && (this.mode === "collapsed" || !this.summary.resultSummary)) {
      suffix += ` ${this.theme.fg("dim", this.summary.meta)}`;
    }
    if (this.summary.attention) {
      suffix += ` ${this.theme.fg("error", "! ATTENTION")}`;
    }

    // 计算固定宽度
    const actionWidth = visibleWidth(this.removeAnsi(action));
    const suffixWidth = visibleWidth(this.removeAnsi(suffix));
    const fixedWidth = actionWidth + suffixWidth + 5; // +2 for spaces

    // 动态分配 target 宽度
    if (fixedWidth < width) {
      const targetWidth = Math.max(1, width - fixedWidth);
      const truncatedTarget = truncateToWidth(target, targetWidth);
      return `${this.statusStyle(this.summary.status, useAsciiChrome() ? "*" : "⏺")} ${action}(${truncatedTarget}) ${suffix}`;
    }

    // 宽度不够：全部截断
    return truncateToWidth(
      `${statusText} ${action}(${target})${this.summary.attention ? " !" : ""}`,
      width,
      "",
    );
  }

  private statusLabel(status: ToolStatus): string {
    return status; // 直接用状态名
  }

  private statusStyle(status: ToolStatus, text: string): string {
    switch (status) {
      case "OK":
        return this.theme.fg("success", text);
      case "ERROR":
        return this.theme.fg("error", text);
      case "CANCELLED":
        return this.theme.fg("warning", text);
      case "RUNNING":
        return this.theme.fg("warning", text);
      case "QUEUED":
        return this.theme.fg("dim", text);
      default:
        return text;
    }
  }

  // 简单移除 ANSI 的辅助方法（用于宽度计算）
  private removeAnsi(text: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence pattern
    return text.replace(/\x1b\[[0-9;]*m/g, "");
  }

  invalidate(): void {}
}

// ===== 智能截断工具函数（从 CodeWhale 借鉴）=====

/**
 * 命令行智能截断
 * 最多3行，每行超过限制时截断
 */
export function truncateCommand(
  command: string,
  lineLimit: number = 3,
  charLimit: number = 120,
): string[] {
  const lines = command.split("\n").slice(0, lineLimit);
  return lines.map((line) => {
    if (line.length > charLimit) {
      return `${line.substring(0, charLimit - 3)}...`;
    }
    return line;
  });
}

/**
 * 输出智能截断
 * Live 模式：最多 lineLimit 行
 * Preview 模式：前 headLines 行 + 后 tailLines 行
 */
export function truncateOutput(
  output: string,
  mode: "live" | "preview" | "full",
  lineLimit: number = 6,
  headLines: number = 2,
  tailLines: number = 2,
): { lines: string[]; truncated: boolean; hiddenCount: number } {
  const allLines = output.split("\n");

  if (mode === "full") {
    return { lines: allLines, truncated: false, hiddenCount: 0 };
  }

  if (mode === "live") {
    if (allLines.length <= lineLimit) {
      return { lines: allLines, truncated: false, hiddenCount: 0 };
    }
    return {
      lines: allLines.slice(0, lineLimit),
      truncated: true,
      hiddenCount: allLines.length - lineLimit,
    };
  }

  // preview 模式
  if (allLines.length <= headLines + tailLines) {
    return { lines: allLines, truncated: false, hiddenCount: 0 };
  }

  const head = allLines.slice(0, headLines);
  const tail = allLines.slice(-tailLines);
  const hidden = allLines.length - headLines - tailLines;

  return {
    lines: [...head, ...tail],
    truncated: true,
    hiddenCount: hidden,
  };
}

/**
 * 文件路径智能截断
 * 优先保留文件名和扩展名
 */
export function truncatePath(path: string, maxLength: number = 56): string {
  if (path.length <= maxLength) {
    return path;
  }

  const parts = path.split("/");
  const fileName = parts[parts.length - 1];

  if (fileName.length >= maxLength - 3) {
    // 文件名太长，直接截断
    return `...${fileName.substring(fileName.length - (maxLength - 3))}`;
  }

  // 保留文件名，截断路径
  const availableForPath = maxLength - fileName.length - 4; // -4 for ".../"
  if (availableForPath <= 0) {
    return `.../${fileName}`;
  }

  const pathWithoutFile = parts.slice(0, -1).join("/");
  if (pathWithoutFile.length <= availableForPath) {
    return path;
  }

  return `...${pathWithoutFile.substring(pathWithoutFile.length - availableForPath)}/${fileName}`;
}

/**
 * Diff 统计
 */
export function diffStats(diff: string): { additions: number; removals: number } {
  let additions = 0;
  let removals = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removals += 1;
  }
  return { additions, removals };
}

/**
 * 错误摘要提取（从输出中提取关键错误信息）
 */
export function extractErrorSummary(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // 查找命令状态行
  const statusLine = [...lines]
    .reverse()
    .find((line) => /^Command (?:exited|aborted|timed out)/i.test(line));

  if (statusLine) {
    return statusLine.substring(0, 100);
  }

  // 返回第一行非空行
  return lines[0]?.substring(0, 100) || "failed";
}
