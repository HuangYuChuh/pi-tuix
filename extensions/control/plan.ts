import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth } from "@earendil-works/pi-tui";

const PLAN_WIDGET_KEY = "pituix-plan";
const MAX_PLAN_ITEMS = 12;

export interface PlanItem {
  text: string;
  completed: boolean;
}

export interface PlanRuntime {
  items: PlanItem[];
  visible: boolean;
  requestRender?: () => void;
}

export function createPlanRuntime(): PlanRuntime {
  return { items: [], visible: true };
}

function cleanStep(text: string): string {
  return text
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .replace(/^~~(.*)~~$/, "$1")
    .replace(/\s+\[DONE:\d+\]\s*$/i, "")
    .trim();
}

export function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      ),
    )
    .map((part) => part.text)
    .join("\n");
}

export function extractPlan(text: string): PlanItem[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const header =
    /^(?:#{1,6}\s*)?(?:\*\*)?(?:implementation\s+plan|plan|\u5b9e\u65bd\u8ba1\u5212|\u8ba1\u5212|\u5be6\u65bd\u8a08\u756b|\u8a08\u756b)(?:\*\*)?\s*[:\uff1a]?\s*$/i;
  const headerIndex = lines.findIndex((line) => header.test(line.trim()));
  if (headerIndex < 0) return [];

  const items: PlanItem[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (items.length > 0 && /^#{1,6}\s+/.test(line.trim())) break;
    const checkbox = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const match = checkbox ?? numbered;
    if (!match) continue;
    const raw = checkbox ? match[2] : match[1];
    if (!raw) continue;
    const completed = checkbox ? match[1]?.toLowerCase() === "x" : /^~~.*~~$/.test(raw.trim());
    items.push({ text: cleanStep(raw), completed });
    if (items.length >= MAX_PLAN_ITEMS) break;
  }
  return items;
}

export function updatePlan(runtime: PlanRuntime, message: unknown): boolean {
  const text = messageText(message);
  if (!text) return false;
  const extracted = extractPlan(text);
  let changed = false;
  if (extracted.length > 0) {
    runtime.items = extracted;
    runtime.visible = true;
    changed = true;
  }
  for (const match of text.matchAll(/\[DONE:(\d+)\]/gi)) {
    const index = Number(match[1]) - 1;
    const item = runtime.items[index];
    if (item && !item.completed) {
      item.completed = true;
      changed = true;
    }
  }
  if (changed) runtime.requestRender?.();
  return changed;
}

export function clearPlan(runtime: PlanRuntime): void {
  runtime.items = [];
  runtime.requestRender?.();
}

export class PlanWidget implements Component {
  private readonly runtime: PlanRuntime;
  private readonly theme: Theme;
  private readonly requestRender: () => void;

  constructor(runtime: PlanRuntime, theme: Theme, tui: TUI) {
    this.runtime = runtime;
    this.theme = theme;
    this.requestRender = () => tui.requestRender();
    runtime.requestRender = this.requestRender;
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const complete = this.runtime.items.filter((item) => item.completed).length;
    const header = this.theme.fg(
      "accent",
      this.theme.bold(`PLAN ${complete}/${this.runtime.items.length}`),
    );
    const lines = this.runtime.items.map((item, index) => {
      const marker = item.completed ? "[x]" : "[ ]";
      const color = item.completed ? "dim" : "muted";
      return this.theme.fg(
        color,
        truncateToWidth(` ${marker} ${index + 1}. ${item.text}`, safeWidth),
      );
    });
    return [truncateToWidth(header, safeWidth), ...lines];
  }

  invalidate(): void {}

  dispose(): void {
    if (this.runtime.requestRender === this.requestRender) this.runtime.requestRender = undefined;
  }
}

export function syncPlanWidget(ctx: ExtensionContext, runtime: PlanRuntime): void {
  if (ctx.mode !== "tui" || !runtime.visible || runtime.items.length === 0) {
    ctx.ui.setWidget(PLAN_WIDGET_KEY, undefined);
    return;
  }
  ctx.ui.setWidget(PLAN_WIDGET_KEY, (tui, theme) => new PlanWidget(runtime, theme, tui));
}
