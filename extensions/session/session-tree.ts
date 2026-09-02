import type {
  ExtensionCommandContext,
  SessionEntry,
  SessionTreeNode,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  Key,
  matchesKey,
  type SelectItem,
  SelectList,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";

interface FlatNode {
  id: string;
  depth: number;
  current: boolean;
  label: string;
  description: string;
}

interface SessionTreeUi {
  render(width: number): string[];
  invalidate(): void;
  handleInput(data: string): void;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => {
      if (typeof part !== "object" || part === null) return false;
      const candidate = part as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string";
    })
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function entryText(entry: SessionEntry): string {
  if (entry.type === "message") {
    const message = entry.message as unknown as { content?: unknown };
    return contentText(message.content);
  }
  if (entry.type === "custom_message") {
    return contentText(entry.content);
  }
  if (entry.type === "branch_summary" || entry.type === "compaction") return entry.summary;
  if (entry.type === "model_change") return `${entry.provider}/${entry.modelId}`;
  if (entry.type === "thinking_level_change") return entry.thinkingLevel;
  if (entry.type === "session_info") return entry.name ?? "";
  if (entry.type === "label") return entry.label ?? "";
  return entry.type;
}

function entryLabel(entry: SessionEntry): string {
  switch (entry.type) {
    case "message":
      return entry.message.role === "user"
        ? "You"
        : entry.message.role === "assistant"
          ? "Pi"
          : entry.message.role;
    case "custom_message":
      return entry.customType;
    case "branch_summary":
      return "Branch summary";
    case "compaction":
      return "Compaction";
    case "model_change":
      return "Model";
    case "thinking_level_change":
      return "Thinking";
    case "session_info":
      return "Session";
    case "label":
      return "Label";
    default:
      return entry.type;
  }
}

export function flattenSessionTree(
  nodes: readonly SessionTreeNode[],
  currentLeafId: string | null,
  depth = 0,
  result: FlatNode[] = [],
): FlatNode[] {
  for (const node of nodes) {
    const text = entryText(node.entry) || "(empty entry)";
    const label = node.label ? `${node.label}: ${text}` : text;
    result.push({
      id: node.entry.id,
      depth,
      current: node.entry.id === currentLeafId,
      label: `${"  ".repeat(depth)}${entryLabel(node.entry)}: ${label}`,
      description: node.entry.timestamp ? new Date(node.entry.timestamp).toLocaleString() : "",
    });
    flattenSessionTree(node.children, currentLeafId, depth + 1, result);
  }
  return result;
}

class SessionTreeView implements SessionTreeUi {
  private readonly container: Box;
  private readonly onClose: () => void;
  private readonly onNavigate: (entryId: string) => void;
  private readonly list: SelectList;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    theme: Theme,
    nodes: FlatNode[],
    onClose: () => void,
    onNavigate: (entryId: string) => void,
  ) {
    this.onClose = onClose;
    this.onNavigate = onNavigate;
    this.container = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
    const items: SelectItem[] = nodes.map((node) => ({
      value: node.id,
      label: node.current ? `${node.label}  [current]` : node.label,
      description: node.description,
    }));
    this.list = new SelectList(items, 14, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    const currentIndex = nodes.findIndex((node) => node.current);
    if (currentIndex >= 0) this.list.setSelectedIndex(currentIndex);
    this.list.onSelect = (item) => this.onNavigate(item.value);
    this.list.onCancel = this.onClose;
    this.container.addChild(new Text(theme.bold(theme.fg("accent", "Pi-TUIX Session")), 1, 0));
    this.container.addChild(
      new Text(theme.fg("dim", "Select an entry to navigate the current session tree"), 1, 0),
    );
    this.container.addChild(this.list);
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    this.cachedWidth = width;
    this.cachedLines = this.container.render(width);
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.container.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
      this.onClose();
      return;
    }
    this.list.handleInput(data);
    this.invalidate();
  }
}

export async function openSessionTree(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) return;
  const nodes = flattenSessionTree(ctx.sessionManager.getTree(), ctx.sessionManager.getLeafId());
  if (nodes.length === 0) {
    ctx.ui.notify("The current session has no entries", "info");
    return;
  }
  await ctx.ui.custom<void>(
    (tui: TUI, theme, _kb, done) => {
      const view = new SessionTreeView(
        theme,
        nodes,
        () => done(undefined),
        (entryId) => {
          void ctx
            .navigateTree(entryId)
            .then((result) => {
              if (result.cancelled) {
                ctx.ui.notify("Session navigation cancelled", "warning");
                return;
              }
              done(undefined);
            })
            .catch((error: unknown) => {
              ctx.ui.notify(`Session navigation failed: ${String(error)}`, "error");
            });
        },
      );
      return {
        render: (width: number) => view.render(width),
        invalidate: () => view.invalidate(),
        handleInput: (data: string) => {
          view.handleInput(data);
          tui.requestRender();
        },
      };
    },
    { overlay: false },
  );
}

export function registerSessionTreeCommand(
  pi: import("@earendil-works/pi-coding-agent").ExtensionAPI,
): void {
  pi.registerCommand("pituix-session", {
    description: "Browse and navigate the current Pi session tree",
    handler: async (_args, ctx) => openSessionTree(ctx),
  });
}
