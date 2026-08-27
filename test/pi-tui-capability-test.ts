import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/**
 * pi-tui 布局能力测试
 *
 * 验证：
 * 1. 多列对齐
 * 2. 进度条渲染
 * 3. 动态宽度计算
 * 4. 焦点高亮
 */

// ===== 测试 1: 多列对齐 =====
class MultiColumnTest implements Component {
  render(width: number): string[] {
    const left = "READ";
    const middle = "path/to/very/long/file/name/example.ts";
    const right = "[OK] 1,234 lines";

    const leftWidth = visibleWidth(left);
    const rightWidth = visibleWidth(right);
    const middleWidth = Math.max(1, width - leftWidth - rightWidth - 2); // -2 for spaces

    const truncatedMiddle = truncateToWidth(middle, middleWidth);

    return [`${left} ${truncatedMiddle} ${right}`];
  }

  invalidate(): void {}
}

// ===== 测试 2: 进度条渲染 =====
class ProgressBarTest implements Component {
  private progress: number; // 0-100

  constructor(progress: number) {
    this.progress = Math.max(0, Math.min(100, progress));
  }

  render(width: number): string[] {
    const barWidth = Math.max(10, width - 20); // 留20字符给文字
    const filled = Math.floor((barWidth * this.progress) / 100);
    const empty = barWidth - filled;

    const bar = "█".repeat(filled) + "░".repeat(empty);
    const label = `[${bar}] ${this.progress}%`;

    return [truncateToWidth(label, width)];
  }

  invalidate(): void {}
}

// ===== 测试 3: 焦点高亮 =====
class FocusHighlightTest implements Component {
  private focused: boolean;
  private theme: Theme;

  constructor(focused: boolean, theme: Theme) {
    this.focused = focused;
    this.theme = theme;
  }

  render(width: number): string[] {
    const content = "  BASH echo 'hello world' [RUNNING] ⚡ 2s";

    if (this.focused) {
      // 方案A: 用边框字符
      const border = this.theme.fg("borderAccent", "│");
      const line = `${border} ${truncateToWidth(content, width - 4)} ${border}`;
      return [line];
    }

    // 无焦点：正常渲染
    return [`  ${truncateToWidth(content, width - 2)}`];
  }

  invalidate(): void {}
}

// ===== 测试 4: 状态动画 =====
// biome-ignore lint/correctness/noUnusedVariables: Test example for documentation
class AnimatedStatusTest implements Component {
  private frame: number;
  private theme: Theme;
  private requestRender: () => void;
  private timer?: NodeJS.Timeout;

  constructor(theme: Theme, requestRender: () => void) {
    this.frame = 0;
    this.theme = theme;
    this.requestRender = requestRender;
  }

  startAnimation(): void {
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % 4;
      this.requestRender();
    }, 720); // 每720ms一帧（CodeWhale 的速度）
  }

  stopAnimation(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  render(width: number): string[] {
    const symbols = ["·", "◦", "•", "◦"];
    const symbol = this.theme.fg("warning", symbols[this.frame]);
    const text = `${symbol} RUNNING | Tool: bash`;

    return [truncateToWidth(text, width)];
  }

  invalidate(): void {
    this.stopAnimation();
  }
}

// ===== 测试 5: 三层展示（Collapsed/Preview/Expanded）=====
type DisplayMode = "collapsed" | "preview" | "expanded";

class ThreeLayerToolTest implements Component {
  private mode: DisplayMode;
  private theme: Theme;
  private output: string;

  constructor(mode: DisplayMode, theme: Theme, output: string) {
    this.mode = mode;
    this.theme = theme;
    this.output = output;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const outputLines = this.output.split("\n");

    // Header（所有模式都显示）
    const header =
      this.theme.bold("READ") +
      " " +
      this.theme.fg("accent", "src/index.ts") +
      " " +
      this.theme.fg("success", "[OK]") +
      " " +
      `${outputLines.length} lines`;
    lines.push(truncateToWidth(header, width));

    if (this.mode === "collapsed") {
      // Collapsed: 只有 header
      return lines;
    }

    if (this.mode === "preview") {
      // Preview: 前2行 + 中间省略 + 后2行
      const head = outputLines.slice(0, 2);
      const tail = outputLines.slice(-2);
      const hidden = outputLines.length - 4;

      head.forEach((line) => {
        lines.push(truncateToWidth(`  ${this.theme.fg("toolOutput", line)}`, width));
      });

      if (hidden > 0) {
        lines.push(this.theme.fg("dim", `  ... ${hidden} lines hidden ...`));
      }

      tail.forEach((line) => {
        lines.push(truncateToWidth(`  ${this.theme.fg("toolOutput", line)}`, width));
      });

      return lines;
    }

    // Expanded: 全部输出
    outputLines.forEach((line) => {
      lines.push(truncateToWidth(`  ${this.theme.fg("toolOutput", line)}`, width));
    });

    return lines;
  }

  invalidate(): void {}
}

// ===== 测试执行 =====
export function runPiTuiCapabilityTests(theme: Theme, width: number): void {
  console.log("=== Pi-TUI 能力测试 ===\n");

  // 测试1: 多列对齐
  console.log("【测试1: 多列对齐】");
  const multiCol = new MultiColumnTest();
  console.log(multiCol.render(width).join("\n"));
  console.log();

  // 测试2: 进度条
  console.log("【测试2: 进度条】");
  [0, 33, 67, 100].forEach((progress) => {
    const bar = new ProgressBarTest(progress);
    console.log(bar.render(width).join("\n"));
  });
  console.log();

  // 测试3: 焦点高亮
  console.log("【测试3: 焦点高亮】");
  const focused = new FocusHighlightTest(true, theme);
  const unfocused = new FocusHighlightTest(false, theme);
  console.log("有焦点:", focused.render(width).join("\n"));
  console.log("无焦点:", unfocused.render(width).join("\n"));
  console.log();

  // 测试4: 状态动画（需要在真实环境测试）
  console.log("【测试4: 状态动画】");
  console.log("（需要在 Pi 环境中测试，此处跳过）");
  console.log();

  // 测试5: 三层展示
  console.log("【测试5: 三层展示】");
  const sampleOutput = Array.from(
    { length: 20 },
    (_, i) => `Line ${i + 1}: Some content here`,
  ).join("\n");

  ["collapsed", "preview", "expanded"].forEach((mode) => {
    console.log(`\n--- ${mode.toUpperCase()} ---`);
    const tool = new ThreeLayerToolTest(mode as DisplayMode, theme, sampleOutput);
    console.log(tool.render(width).join("\n"));
  });
}

// ===== 测试结论 =====
export interface CapabilityTestResult {
  multiColumn: boolean;
  progressBar: boolean;
  focusHighlight: boolean;
  animation: boolean;
  threeLayer: boolean;
  notes: string[];
}

export function evaluateCapabilities(): CapabilityTestResult {
  return {
    multiColumn: true, // ✅ visibleWidth + truncateToWidth 完全支持
    progressBar: true, // ✅ Unicode 字符可用
    focusHighlight: true, // ✅ 边框字符 + theme.fg() 可实现
    animation: true, // ⚠️ 需要 requestRender() + timer，可行但需测试
    threeLayer: true, // ✅ 完全可实现
    notes: [
      "✅ 多列对齐：visibleWidth 和 truncateToWidth 完美支持 ANSI 计算",
      "✅ 进度条：Unicode 块字符渲染正常",
      "✅ 焦点高亮：用边框字符 + theme color 实现，无需 ratatui Style",
      "⚠️ 动画：需要 setInterval + requestRender，待实际环境验证帧率",
      "✅ 三层展示：完全可行，逻辑简单",
      "",
      "结论：pi-tui 的 Component API 足够实现 CodeWhale 的核心 UI 模式",
      "唯一风险：动画帧率和性能，需要在 Pi 环境中实测",
    ],
  };
}
