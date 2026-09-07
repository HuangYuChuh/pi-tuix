import type { AssistantMessage, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  keyText,
  type SessionEntry,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  getKeybindings,
  Key,
  matchesKey,
  Text,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { useAsciiChrome } from "../shell/open-tui/icons.ts";
import {
  createThreeLayerBashDefinition,
  createThreeLayerEditDefinition,
  createThreeLayerReadDefinition,
  createThreeLayerWriteDefinition,
  type ToolRendererMode,
} from "../tools/renderers-v2.ts";
import { ToolGroupRuntime } from "../tools/tool-groups.ts";
import { messageText, ReferenceAssistantText, ReferenceUserMessage } from "./message-view.ts";

type Message = Extract<SessionEntry, { type: "message" }>["message"];

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      // Binary media is deliberately labelled, never decoded or executed by this reader.
      return `[${messageText(String(part?.type ?? "attachment"))}${part?.mimeType ? `: ${messageText(String(part.mimeType))}` : ""}]`;
    })
    .join("\n");
}

/** Display-only snapshot. No session mutations, provider calls or tool execution. */
export class TranscriptContent implements Component {
  private readonly entries: readonly SessionEntry[];
  private readonly theme: Theme;
  private readonly tui: TUI;
  private readonly cwd: string;
  private readonly ascii: boolean;
  private components: Component[] = [];
  private expanded = false;
  private cache: { width: number; lines: string[] } | undefined;

  constructor(
    entries: readonly SessionEntry[],
    theme: Theme,
    tui: TUI,
    cwd: string,
    ascii = false,
  ) {
    this.entries = structuredClone(entries);
    this.theme = theme;
    this.tui = tui;
    this.cwd = cwd;
    this.ascii = ascii;
    this.rebuild();
  }

  setExpanded(expanded: boolean): void {
    if (expanded === this.expanded) return;
    this.expanded = expanded;
    this.rebuild();
  }

  private label(text: string, error = false): Component {
    return new Text(this.theme.fg(error ? "error" : "muted", messageText(text)), 0, 0);
  }

  private rebuild(): void {
    this.cache = undefined;
    this.components = [];
    const groups = new ToolGroupRuntime();
    groups.reset(this.cwd);
    for (const entry of this.entries) groups.recordEntry(entry);
    const mode: ToolRendererMode = { enabled: true, defaultMode: "preview", groups };
    const definitions = new Map<
      string,
      NonNullable<ConstructorParameters<typeof ToolExecutionComponent>[4]>
    >(
      [
        createThreeLayerReadDefinition(this.cwd, mode),
        createThreeLayerBashDefinition(this.cwd, mode),
        createThreeLayerEditDefinition(this.cwd, mode),
        createThreeLayerWriteDefinition(this.cwd, mode),
      ].map((definition) => [definition.name, definition]),
    );
    const tools = new Map<string, ToolExecutionComponent>();
    const results = new Map<string, ToolResultMessage>();
    for (const entry of this.entries) {
      if (entry.type === "message" && entry.message.role === "toolResult")
        results.set(entry.message.toolCallId, entry.message);
    }
    const addTool = (call: ToolCall) => {
      if (tools.has(call.id)) return;
      const component = new ToolExecutionComponent(
        call.name,
        call.id,
        call.arguments,
        { showImages: false },
        definitions.get(call.name),
        this.tui,
        this.cwd,
      );
      component.setArgsComplete();
      const result = results.get(call.id);
      if (result) {
        component.markExecutionStarted();
        component.updateResult(result);
      }
      component.setExpanded(this.expanded);
      tools.set(call.id, component);
      this.components.push(component);
    };
    const addMessage = (message: Message) => {
      if (message.role === "user") {
        this.components.push(
          new ReferenceUserMessage(contentText(message.content), this.theme, this.ascii),
        );
      } else if (message.role === "assistant") {
        for (const block of message.content) {
          if (block.type === "text" && block.text.trim())
            this.components.push(new ReferenceAssistantText(block.text, this.theme, this.ascii));
          else if (block.type === "thinking" && block.thinking.trim())
            this.components.push(
              this.expanded
                ? new ReferenceAssistantText(block.thinking, this.theme, this.ascii, true)
                : this.label("Thinking (expand to view)"),
            );
          else if (block.type === "toolCall") addTool(block);
        }
        this.addStopReason(message);
      } else if (message.role === "toolResult") {
        if (!tools.has(message.toolCallId)) {
          // Compaction/import can leave a result without its original call arguments.
          this.components.push(
            this.label(
              `${message.toolName} result${message.isError ? " [ERROR]" : ""} (call unavailable)`,
              message.isError,
            ),
          );
          this.components.push(new Text(messageText(contentText(message.content)), 2, 0));
        }
      } else if (message.role === "bashExecution") {
        const state = message.cancelled
          ? "CANCELLED"
          : message.exitCode === 0
            ? "OK"
            : `EXIT ${message.exitCode ?? "unknown"}`;
        this.components.push(
          this.label(
            `Bash(${message.command}) [${state}]`,
            message.cancelled || message.exitCode !== 0,
          ),
        );
        this.components.push(new Text(messageText(message.output), 2, 0));
        if (message.truncated)
          this.components.push(
            this.label(
              `Output truncated${message.fullOutputPath ? `: ${message.fullOutputPath}` : ""}`,
            ),
          );
      } else if (message.role === "custom") {
        if (message.display) {
          this.components.push(this.label(message.customType));
          this.components.push(
            new ReferenceAssistantText(contentText(message.content), this.theme, this.ascii),
          );
        }
      } else if (message.role === "branchSummary" || message.role === "compactionSummary") {
        this.components.push(
          this.label(message.role === "branchSummary" ? "Branch summary" : "Compaction summary"),
        );
        this.components.push(new ReferenceAssistantText(message.summary, this.theme, this.ascii));
      }
    };
    for (const entry of this.entries) {
      if (entry.type === "message") addMessage(entry.message);
      else if (entry.type === "custom_message" && entry.display) {
        this.components.push(this.label(entry.customType));
        this.components.push(
          new ReferenceAssistantText(contentText(entry.content), this.theme, this.ascii),
        );
      } else if (entry.type === "compaction" || entry.type === "branch_summary") {
        this.components.push(
          this.label(entry.type === "compaction" ? "Compaction summary" : "Branch summary"),
        );
        this.components.push(new ReferenceAssistantText(entry.summary, this.theme, this.ascii));
      }
    }
  }

  private addStopReason(message: AssistantMessage): void {
    if (message.stopReason === "length")
      this.components.push(this.label("Response was truncated before completion.", true));
    else if (message.stopReason === "aborted")
      this.components.push(
        this.label(`Interrupted${message.errorMessage ? `: ${message.errorMessage}` : ""}`, true),
      );
    else if (message.stopReason === "error")
      this.components.push(this.label(`Error: ${message.errorMessage || "Unknown error"}`, true));
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    if (this.cache?.width === width) return this.cache.lines;
    const lines: string[] = [];
    for (const component of this.components) {
      const rendered = [...component.render(Math.max(4, width))];
      // ToolExecutionComponent supplies its own leading spacer.
      while (rendered.length && !rendered[0].trim()) rendered.shift();
      if (!rendered.length) continue;
      if (lines.length) lines.push("");
      lines.push(...rendered.map((line) => truncateToWidth(line, width, "")));
    }
    this.cache = { width, lines };
    return lines;
  }

  invalidate(): void {
    this.cache = undefined;
    for (const component of this.components) component.invalidate();
  }
}

export class TranscriptView implements Component {
  private readonly content: TranscriptContent;
  private readonly theme: Theme;
  private readonly getRows: () => number;
  private readonly done: () => void;
  private readonly expandKey: (data: string) => boolean;
  private offset = Number.MAX_SAFE_INTEGER;
  private pageSize = 1;
  private expanded = false;
  private closed = false;

  constructor(
    content: TranscriptContent,
    theme: Theme,
    getRows: () => number,
    done: () => void,
    expandKey: (data: string) => boolean,
  ) {
    this.content = content;
    this.theme = theme;
    this.getRows = getRows;
    this.done = done;
    this.expandKey = expandKey;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const rows = Math.max(1, Math.floor(this.getRows()));
    const chrome = rows >= 4 ? 2 : 0;
    this.pageSize = Math.max(1, rows - chrome);
    const lines = this.content.render(width);
    this.offset = Math.min(this.offset, Math.max(0, lines.length - this.pageSize));
    const body = lines.slice(this.offset, this.offset + this.pageSize);
    if (!chrome) return body;
    while (body.length < this.pageSize) body.push("");
    const location = lines.length
      ? `${this.offset + 1}-${Math.min(lines.length, this.offset + this.pageSize)}/${lines.length}`
      : "Empty session";
    return [
      this.theme.fg("muted", `Conversation snapshot | ${location}`),
      ...body,
      this.theme.fg(
        "muted",
        `PgUp/PgDn scroll | Home/End | ${keyText("app.tools.expand")} ${this.expanded ? "collapse" : "expand"} | Esc return`,
      ),
    ].map((line) => truncateToWidth(line, width, ""));
  }

  handleInput(data: string): void {
    if (this.closed) return;
    const keys = getKeybindings();
    if (keys.matches(data, "tui.select.cancel")) {
      this.closed = true;
      this.done();
    } else if (this.expandKey(data)) {
      this.expanded = !this.expanded;
      this.content.setExpanded(this.expanded);
    } else if (matchesKey(data, Key.home)) this.offset = 0;
    else if (matchesKey(data, Key.end)) this.offset = Number.MAX_SAFE_INTEGER;
    else if (keys.matches(data, "tui.select.up")) this.offset = Math.max(0, this.offset - 1);
    else if (keys.matches(data, "tui.select.down")) this.offset++;
    else if (keys.matches(data, "tui.select.pageUp"))
      this.offset = Math.max(0, this.offset - this.pageSize);
    else if (keys.matches(data, "tui.select.pageDown")) this.offset += this.pageSize;
  }

  invalidate(): void {
    this.content.invalidate();
  }
}

export function registerTranscriptCommand(pi: ExtensionAPI): void {
  pi.registerCommand("pituix-transcript", {
    description: "Read the current conversation with reference message and tool layout",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      const entries = ctx.sessionManager.getBranch();
      await ctx.ui.custom<void>(
        (tui, theme, keys, done) => {
          const content = new TranscriptContent(entries, theme, tui, ctx.cwd, useAsciiChrome());
          const view = new TranscriptView(
            content,
            theme,
            () => tui.terminal.rows,
            () => done(undefined),
            (data) => keys.matches(data, "app.tools.expand"),
          );
          return {
            render: (width) => view.render(width),
            invalidate: () => view.invalidate(),
            handleInput: (data) => {
              view.handleInput(data);
              tui.requestRender();
            },
          };
        },
        {
          overlay: true,
          overlayOptions: { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0 },
        },
      );
    },
  });
}
