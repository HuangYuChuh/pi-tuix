import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  getKeybindings,
  Input,
  Key,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { CursorStyle, IconMode, OpenTuiConfig, SettingsLanguage } from "./config.ts";
import { useAsciiChrome } from "./icons.ts";

interface SettingItem {
  id: string;
  label: string;
  currentValue: string;
}

type Tab = "features" | "icons" | "segments" | "telemetry";

const TABS: Tab[] = ["features", "icons", "segments", "telemetry"];

const COPY = {
  en: {
    title: "Pi-TUIX Settings",
    tabs: { features: "General", icons: "Appearance", segments: "Footer", telemetry: "Telemetry" },
    labels: {
      enabled: "Enabled",
      language: "Language",
      cursorStyle: "Cursor style",
      iconMode: "Icon mode",
      cwd: "CWD",
      sessionName: "Session name",
      gitBranch: "Git branch",
      gitStatus: "Git status",
      gitCommit: "Git commit (detached)",
      runtime: "Runtime",
      context: "Context bar",
      tokens: "Tokens",
      cost: "Cost",
      extensionStatuses: "Extension status line",
      totalDuration: "Total duration",
      tokenCounts: "Token counts",
      stallDetails: "Stall details",
      costRate: "Cost rate",
    },
    values: {
      on: "On",
      off: "Off",
      languages: { en: "English", zh: "简体中文" },
      cursorStyles: { block: "Block", bar: "Bar", underline: "Underline" },
      icons: { auto: "Auto", nerd: "Nerd", ascii: "ASCII" },
    },
  },
  zh: {
    title: "Pi-TUIX 设置",
    tabs: { features: "常规", icons: "外观", segments: "Footer", telemetry: "遥测" },
    labels: {
      enabled: "启用",
      language: "语言",
      cursorStyle: "光标样式",
      iconMode: "图标模式",
      cwd: "当前目录",
      sessionName: "会话名",
      gitBranch: "Git 分支",
      gitStatus: "Git 状态",
      gitCommit: "Git 提交（分离 HEAD）",
      runtime: "运行环境",
      context: "上下文栏",
      tokens: "Token",
      cost: "费用",
      extensionStatuses: "扩展状态行",
      totalDuration: "总耗时",
      tokenCounts: "Token 数量",
      stallDetails: "停顿详情",
      costRate: "费用速率",
    },
    values: {
      on: "开启",
      off: "关闭",
      languages: { en: "English", zh: "简体中文" },
      cursorStyles: { block: "块", bar: "竖线", underline: "下划线" },
      icons: { auto: "自动", nerd: "Nerd", ascii: "ASCII" },
    },
  },
} as const;

type SettingsCopy = (typeof COPY)[SettingsLanguage];

function toggleSetting(
  config: OpenTuiConfig,
  key: keyof OpenTuiConfig["footerSegments"],
): OpenTuiConfig {
  return {
    ...config,
    footerSegments: {
      ...config.footerSegments,
      [key]: !config.footerSegments[key],
    },
  };
}

function cycleIconMode(config: OpenTuiConfig): OpenTuiConfig {
  const order: IconMode[] = ["auto", "nerd", "ascii"];
  const currentIdx = order.indexOf(config.icons.mode);
  const next = order[(currentIdx + 1) % order.length] ?? order[0];
  return { ...config, icons: { mode: next } };
}

function toggleEnabled(config: OpenTuiConfig): OpenTuiConfig {
  return { ...config, enabled: !config.enabled };
}

function toggleLanguage(config: OpenTuiConfig): OpenTuiConfig {
  return { ...config, settingsLanguage: config.settingsLanguage === "en" ? "zh" : "en" };
}

function cycleCursorStyle(config: OpenTuiConfig): OpenTuiConfig {
  const order: CursorStyle[] = ["block", "bar", "underline"];
  const currentIdx = order.indexOf(config.cursorStyle);
  const next = order[(currentIdx + 1) % order.length] ?? order[0];
  return { ...config, cursorStyle: next };
}

function toggleTelemetry(
  config: OpenTuiConfig,
  key: keyof OpenTuiConfig["telemetry"],
): OpenTuiConfig {
  return {
    ...config,
    telemetry: { ...config.telemetry, [key]: !config.telemetry[key] },
  };
}

function buildFeaturesItems(config: OpenTuiConfig, copy: SettingsCopy): SettingItem[] {
  return [
    {
      id: "enabled",
      label: copy.labels.enabled,
      currentValue: config.enabled ? copy.values.on : copy.values.off,
    },
    {
      id: "settingsLanguage",
      label: copy.labels.language,
      currentValue: copy.values.languages[config.settingsLanguage],
    },
  ];
}

function buildIconsItems(config: OpenTuiConfig, copy: SettingsCopy): SettingItem[] {
  return [
    { id: "mode", label: copy.labels.iconMode, currentValue: copy.values.icons[config.icons.mode] },
    {
      id: "cursorStyle",
      label: copy.labels.cursorStyle,
      currentValue: copy.values.cursorStyles[config.cursorStyle],
    },
  ];
}

function buildSegmentsItems(config: OpenTuiConfig, copy: SettingsCopy): SettingItem[] {
  const segs = config.footerSegments;
  const flag = (value: boolean) => (value ? copy.values.on : copy.values.off);
  return [
    {
      id: "footerStyle",
      label: config.settingsLanguage === "zh" ? "底栏布局" : "Footer layout",
      currentValue: config.footerStyle,
    },
    { id: "cwd", label: copy.labels.cwd, currentValue: flag(segs.cwd) },
    { id: "sessionName", label: copy.labels.sessionName, currentValue: flag(segs.sessionName) },
    { id: "gitBranch", label: copy.labels.gitBranch, currentValue: flag(segs.gitBranch) },
    { id: "gitStatus", label: copy.labels.gitStatus, currentValue: flag(segs.gitStatus) },
    { id: "gitCommit", label: copy.labels.gitCommit, currentValue: flag(segs.gitCommit) },
    { id: "runtime", label: copy.labels.runtime, currentValue: flag(segs.runtime) },
    { id: "context", label: copy.labels.context, currentValue: flag(segs.context) },
    { id: "tokens", label: copy.labels.tokens, currentValue: flag(segs.tokens) },
    { id: "cost", label: copy.labels.cost, currentValue: flag(segs.cost) },
    {
      id: "extensionStatuses",
      label: copy.labels.extensionStatuses,
      currentValue: flag(segs.extensionStatuses),
    },
  ];
}

function buildTelemetryItems(config: OpenTuiConfig, copy: SettingsCopy): SettingItem[] {
  const telemetry = config.telemetry;
  const flag = (value: boolean) => (value ? copy.values.on : copy.values.off);
  return [
    { id: "enabled", label: copy.labels.enabled, currentValue: flag(telemetry.enabled) },
    { id: "tps", label: "TPS", currentValue: flag(telemetry.tps) },
    { id: "ttft", label: "TTFT", currentValue: flag(telemetry.ttft) },
    { id: "duration", label: copy.labels.totalDuration, currentValue: flag(telemetry.duration) },
    { id: "tokens", label: copy.labels.tokenCounts, currentValue: flag(telemetry.tokens) },
    { id: "stalls", label: copy.labels.stallDetails, currentValue: flag(telemetry.stalls) },
    { id: "cost", label: copy.labels.costRate, currentValue: flag(telemetry.cost) },
  ];
}

function buildItems(tab: Tab, config: OpenTuiConfig): SettingItem[] {
  const copy = COPY[config.settingsLanguage];
  switch (tab) {
    case "features":
      return buildFeaturesItems(config, copy);
    case "icons":
      return buildIconsItems(config, copy);
    case "segments":
      return buildSegmentsItems(config, copy);
    case "telemetry":
      return buildTelemetryItems(config, copy);
  }
}

function handleSettingChange(tab: Tab, itemId: string, config: OpenTuiConfig): OpenTuiConfig {
  if (tab === "features") {
    if (itemId === "enabled") return toggleEnabled(config);
    if (itemId === "settingsLanguage") return toggleLanguage(config);
  }
  if (tab === "icons") {
    if (itemId === "mode") return cycleIconMode(config);
    if (itemId === "cursorStyle") return cycleCursorStyle(config);
  }
  if (tab === "segments") {
    if (itemId === "footerStyle")
      return { ...config, footerStyle: config.footerStyle === "compact" ? "detailed" : "compact" };
    return toggleSetting(config, itemId as keyof OpenTuiConfig["footerSegments"]);
  }
  if (tab === "telemetry") {
    return toggleTelemetry(config, itemId as keyof OpenTuiConfig["telemetry"]);
  }
  return config;
}

/** Searchable settings page rendered from Pi-TUIX preferences only. */
export class SettingsUi {
  private tab: Tab = "features";
  private config: OpenTuiConfig;
  private readonly theme: Theme;
  private readonly onChange: (config: OpenTuiConfig) => void;
  private readonly onClose: () => void;
  private readonly getRows: () => number;
  private readonly search = new Input();
  private focus: "search" | "list" | "tabs" = "search";
  private selected = 0;
  private selectedByTab = new Map<Tab, string>();
  focused = true;

  constructor(
    theme: Theme,
    config: OpenTuiConfig,
    onChange: (config: OpenTuiConfig) => void,
    onClose: () => void,
    getRows = () => 24,
  ) {
    this.theme = theme;
    this.config = config;
    this.onChange = onChange;
    this.onClose = onClose;
    this.getRows = getRows;
  }

  private items(): SettingItem[] {
    const query = this.search.getValue().trim().toLocaleLowerCase();
    return buildItems(this.tab, this.config).filter((item) =>
      `${item.label} ${item.id} ${item.currentValue}`.toLocaleLowerCase().includes(query),
    );
  }

  private switchTab(offset: number): void {
    const selectedId = this.items()[this.selected]?.id;
    if (selectedId) this.selectedByTab.set(this.tab, selectedId);
    this.tab = TABS[(TABS.indexOf(this.tab) + offset + TABS.length) % TABS.length];
    this.search.setValue("");
    this.selected = Math.max(
      0,
      this.items().findIndex((item) => item.id === this.selectedByTab.get(this.tab)),
    );
    this.focus = "tabs";
  }

  private changeSelected(): void {
    const item = this.items()[this.selected];
    if (!item) return;
    this.config = handleSettingChange(this.tab, item.id, this.config);
    this.onChange(this.config);
    // A value change can remove the row from a value-based filter.
    this.selected = Math.min(this.selected, Math.max(0, this.items().length - 1));
  }

  handleInput(data: string): void {
    const keys = getKeybindings();
    const up = keys.matches(data, "tui.select.up");
    const down = keys.matches(data, "tui.select.down");
    const confirm = keys.matches(data, "tui.select.confirm");
    const cancel = keys.matches(data, "tui.select.cancel");
    if (matchesKey(data, Key.tab)) {
      this.switchTab(1);
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      this.switchTab(-1);
      return;
    }
    if (this.focus === "tabs") {
      if (matchesKey(data, Key.right)) {
        this.switchTab(1);
        return;
      }
      if (matchesKey(data, Key.left)) {
        this.switchTab(-1);
        return;
      }
      if (cancel) {
        this.onClose();
        return;
      }
      this.focus = "search";
      if (down || confirm) return;
    }
    if (this.focus === "search") {
      if (up) {
        this.focus = "tabs";
        return;
      }
      if (confirm || down) {
        if (this.items().length > 0) this.focus = "list";
        return;
      }
      if (cancel) {
        if (this.search.getValue()) {
          this.search.setValue("");
          this.selected = 0;
        } else this.focus = "list";
        return;
      }
      this.search.handleInput(data);
      this.selected = 0;
      return;
    }
    if (cancel) {
      this.onClose();
      return;
    }
    if (confirm || matchesKey(data, Key.space)) {
      this.changeSelected();
      return;
    }
    if (up) {
      if (this.selected === 0) this.focus = "search";
      else this.selected--;
      return;
    }
    if (down) {
      this.selected = Math.min(this.selected + 1, Math.max(0, this.items().length - 1));
      return;
    }
    if (data === "/") {
      this.focus = "search";
      return;
    }
    // Ordinary text always filters; q can be part of a setting search.
    this.focus = "search";
    this.search.handleInput(data);
    this.selected = 0;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const clip = (line: string) => truncateToWidth(line, width, "");
    const paint = (line: string) => this.theme.fg("mdLink", line);
    const muted = (line: string) => this.theme.fg("muted", line);
    const copy = COPY[this.config.settingsLanguage];
    const ascii = useAsciiChrome(this.config.icons.mode);
    const inset = width >= 16 ? "   " : "";
    const inner = Math.max(1, width - visibleWidth(inset) * 2);
    const tabLabels = TABS.map((tab) => {
      const label = ` ${copy.tabs[tab]} `;
      return tab === this.tab ? this.theme.inverse(this.theme.bold(label)) : muted(label);
    });
    const tabs =
      width >= 70
        ? `${paint(this.theme.bold(copy.title))}  ${tabLabels.join(" ")}`
        : `${tabLabels[TABS.indexOf(this.tab)]} ${muted(`${TABS.indexOf(this.tab) + 1}/${TABS.length}  tab: next`)}`;
    const lines = [paint((ascii ? "-" : "▔").repeat(width)), `${inset}${tabs}`, ""];
    const textWidth = Math.max(1, inner - 6);
    this.search.focused = this.focused && this.focus === "search";
    const query = this.search.getValue();
    const rows = Math.max(1, Math.floor(this.getRows()));
    let searchLine: string;
    if (!query) {
      const placeholder =
        this.config.settingsLanguage === "zh" ? "搜索设置..." : "Search settings...";
      searchLine = muted(
        this.search.focused
          ? `${CURSOR_MARKER}${this.theme.inverse(placeholder[0])}${placeholder.slice(1)}`
          : placeholder,
      );
    } else if (this.search.focused) {
      // The public Input component supplies editing, paste, scrolling and IME.
      // Its two-cell prompt is replaced with this page's search marker.
      searchLine = (this.search.render(Math.max(4, textWidth + 2))[0] ?? "").slice(2);
    } else searchLine = query;
    const fitted = truncateToWidth(searchLine, textWidth, "");
    if (inner >= 8) {
      const rule = (ascii ? "-" : "─").repeat(inner - 2);
      lines.push(
        `${inset}${paint(`${ascii ? "+" : "╭"}${rule}${ascii ? "+" : "╮"}`)}`,
        `${inset}${paint(ascii ? "|" : "│")} ${ascii ? "/" : "⌕"} ${fitted}${" ".repeat(Math.max(0, textWidth - visibleWidth(fitted)))} ${paint(ascii ? "|" : "│")}`,
        `${inset}${paint(`${ascii ? "+" : "╰"}${rule}${ascii ? "+" : "╯"}`)}`,
      );
    } else lines.push(`${inset}/${fitted}`);
    lines.push("");
    const items = this.items();
    const compact = rows < 14;
    if (compact) lines.splice(0, lines.length, `${inset}${tabs}`, `${inset}/${fitted}`);
    const hint =
      this.config.settingsLanguage === "zh"
        ? this.focus === "search"
          ? "输入筛选 · Enter/↓ 选择 · ↑ 切页 · Esc 清空"
          : "Enter/空格 更改 · / 搜索 · Tab 切页 · Esc 关闭"
        : this.focus === "search"
          ? "Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear"
          : "Enter/Space to change · / to search · Tab for tabs · Esc to close";
    const hintLines =
      compact || width < 40
        ? [truncateToWidth(muted(hint), inner, "")]
        : wrapTextWithAnsi(muted(hint), inner).slice(0, 2);
    const maxVisible = Math.max(
      1,
      Math.min(20, rows - lines.length - hintLines.length - (compact ? 0 : 3)),
    );
    const start = Math.max(
      0,
      Math.min(this.selected - Math.floor(maxVisible / 2), items.length - maxVisible),
    );
    const shown = items.slice(start, start + maxVisible);
    if (start > 0 && !compact)
      lines.push(`${inset}${muted(`${ascii ? "^" : "↑"} ${start} more above`)}`);
    for (let i = 0; i < shown.length; i++) {
      const item = shown[i];
      const selected = this.focus === "list" && start + i === this.selected;
      const prefix = selected ? `${ascii ? ">" : "❯"} ` : "  ";
      const rowWidth = Math.max(1, inner - 2);
      const labelWidth = width >= 80 ? Math.min(43, rowWidth - 10) : Math.floor(rowWidth * 0.55);
      const label = truncateToWidth(item.label, Math.max(1, labelWidth), "");
      const row =
        width < 40
          ? `${truncateToWidth(item.label, Math.max(1, rowWidth - visibleWidth(item.currentValue) - 2), "")}: ${item.currentValue}`
          : `${label}${" ".repeat(Math.max(1, labelWidth - visibleWidth(label)))}${item.currentValue}`;
      lines.push(`${inset}${selected ? paint(prefix + row) : prefix + row}`);
    }
    if (items.length === 0)
      lines.push(
        `${inset}${muted(this.config.settingsLanguage === "zh" ? "没有匹配的设置" : "No matching settings")}`,
      );
    const remaining = items.length - start - shown.length;
    if (remaining > 0 && !compact)
      lines.push(`${inset}${muted(`${ascii ? "v" : "↓"} ${remaining} more below`)}`);
    if (!compact) lines.push("");
    lines.push(...hintLines.map((line) => inset + line));
    // At heights below four rows, retain the focused control instead of chrome.
    if (rows < 4)
      return [this.focus === "list" ? (lines[2] ?? "") : `${inset}/${fitted}`].map(clip);
    return lines.slice(0, rows).map(clip);
  }

  invalidate(): void {
    this.search.invalidate();
  }
}

export function registerSettingsCommand(
  pi: ExtensionAPI,
  hooks: {
    getConfig: () => OpenTuiConfig;
    onConfigChanged: (config: OpenTuiConfig) => void;
    onOverlayOpened?: () => void;
    onOverlayClosed?: () => void;
  },
): void {
  pi.registerCommand("pituix-settings", {
    description: "Open the Pi-TUIX settings UI",
    handler: async (_args, ctx: ExtensionContext) => {
      if (!ctx.hasUI) return;
      hooks.onOverlayOpened?.();
      try {
        await ctx.ui.custom<void>(
          (tui: TUI, theme, _kb, done) => {
            const ui = new SettingsUi(
              theme,
              hooks.getConfig(),
              (config) => hooks.onConfigChanged(config),
              () => done(undefined),
              () => tui.terminal.rows,
            );
            return {
              get focused() {
                return ui.focused;
              },
              set focused(value: boolean) {
                ui.focused = value;
              },
              render: (w: number) => ui.render(w),
              invalidate: () => ui.invalidate(),
              handleInput: (data: string) => {
                ui.handleInput(data);
                tui.requestRender();
              },
            };
          },
          // Render as a full custom view so settings behave like a page, not a floating dialog.
          { overlay: false },
        );
        // The settings view is closed and focus is back on the editor. Deferred UI
        // changes (e.g. toggling the extension) run here after Pi restores focus.
      } finally {
        hooks.onOverlayClosed?.();
      }
    },
  });
}
