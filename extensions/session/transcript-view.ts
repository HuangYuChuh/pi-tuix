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
  stripTerminalSequences,
  Text,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { useAsciiChrome } from "../shell/open-tui/icons.ts";
import { COMPLETION_ENTRY_TYPE, readCompletionEntry } from "../stream/completion-entry.ts";
import { renderRunCompletion } from "../stream/run-presentation.ts";
import {
  createThreeLayerBashDefinition,
  createThreeLayerEditDefinition,
  createThreeLayerReadDefinition,
  createThreeLayerWriteDefinition,
  type ToolRendererMode,
} from "../tools/renderers-v2.ts";
import { ToolGroupRuntime } from "../tools/tool-groups.ts";
import { AttachedContent, contentText } from "./image-attachment-view.ts";
import {
  collectImages,
  type ImageAttachment,
  type ImageLinks,
  type PrepareImages,
} from "./image-attachments.ts";
import { messageText, ReferenceAssistantText, ReferenceUserMessage } from "./message-view.ts";

type Message = Extract<SessionEntry, { type: "message" }>["message"];

/** Display-only snapshot. No session mutations, provider calls or tool execution. */
export class TranscriptContent implements Component {
  private readonly entries: readonly SessionEntry[];
  private readonly theme: Theme;
  private readonly tui: TUI;
  private readonly cwd: string;
  private readonly ascii: boolean;
  private readonly options: {
    groupTools?: boolean;
    showMessageMetadata?: boolean;
    imageLinks?: ImageLinks;
    imageLoading?: boolean;
  };
  private readonly images: ReadonlyMap<string, ImageAttachment>;
  private components: Component[] = [];
  private expanded = false;
  private cache: { width: number; lines: string[] } | undefined;

  constructor(
    entries: readonly SessionEntry[],
    theme: Theme,
    tui: TUI,
    cwd: string,
    ascii = false,
    options: TranscriptContent["options"] = {},
  ) {
    this.entries = structuredClone(entries);
    this.theme = theme;
    this.tui = tui;
    this.cwd = cwd;
    this.ascii = ascii;
    this.options = { ...options };
    this.images = new Map(collectImages(this.entries).map((image) => [image.key, image]));
    this.rebuild();
  }

  setExpanded(expanded: boolean): void {
    if (expanded === this.expanded) return;
    this.expanded = expanded;
    this.rebuild();
  }

  setImageLinks(links: ImageLinks): void {
    this.options.imageLinks = links;
    this.options.imageLoading = false;
    this.rebuild();
  }

  private label(text: string, error = false): Component {
    return new Text(this.theme.fg(error ? "error" : "muted", messageText(text)), 0, 0);
  }

  private withAttachments(component: Component, entryId: string): Component {
    const images = [...this.images.values()].filter((image) => image.entryId === entryId);
    return images.length
      ? new AttachedContent(
          component,
          images,
          this.options.imageLinks ?? new Map(),
          this.theme,
          this.ascii,
          this.options.imageLoading ?? false,
        )
      : component;
  }

  private rebuild(): void {
    this.cache = undefined;
    this.components = [];
    const groups = new ToolGroupRuntime();
    groups.reset(this.cwd);
    for (const entry of this.entries) groups.recordEntry(entry);
    const mode: ToolRendererMode = {
      enabled: true,
      ascii: () => this.ascii,
      config: {
        defaultMode: "preview",
        autoExpand: true,
        maxPreviewLines: 4,
        highlightErrors: true,
      },
      ...(this.options.groupTools === false ? {} : { groups }),
    };
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
    const results = new Map<string, { message: ToolResultMessage; entryId: string }>();
    for (const entry of this.entries) {
      if (entry.type === "message" && entry.message.role === "toolResult")
        results.set(entry.message.toolCallId, { message: entry.message, entryId: entry.id });
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
        component.updateResult(result.message);
      }
      component.setExpanded(this.expanded);
      tools.set(call.id, component);
      this.components.push(
        result && !(call.name === "read" && !result.message.isError)
          ? this.withAttachments(component, result.entryId)
          : component,
      );
    };
    const addMessage = (message: Message, entryId: string) => {
      if (message.role === "user") {
        this.components.push(
          this.withAttachments(
            new ReferenceUserMessage(
              contentText(message.content, entryId, this.images),
              this.theme,
              this.ascii,
            ),
            entryId,
          ),
        );
      } else if (message.role === "assistant") {
        let metadata: string | undefined;
        if (this.options.showMessageMetadata) {
          const model = messageText(message.model || "");
          const time =
            typeof message.timestamp === "number" &&
            Number.isFinite(new Date(message.timestamp).getTime())
              ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
                  .format(message.timestamp)
                  .replace(/\s/g, " ")
              : "";
          metadata = [time, model].filter(Boolean).join(" ");
        }
        for (const block of message.content) {
          if (block.type === "text" && block.text.trim()) {
            this.components.push(
              new ReferenceAssistantText(block.text, this.theme, this.ascii, false, metadata),
            );
            metadata = undefined;
          } else if (block.type === "thinking" && block.thinking.trim())
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
          this.components.push(
            this.withAttachments(
              new Text(messageText(contentText(message.content, entryId, this.images)), 2, 0),
              entryId,
            ),
          );
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
            this.withAttachments(
              new ReferenceAssistantText(
                contentText(message.content, entryId, this.images),
                this.theme,
                this.ascii,
              ),
              entryId,
            ),
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
      if (entry.type === "message") addMessage(entry.message, entry.id);
      else if (entry.type === "custom" && entry.customType === COMPLETION_ENTRY_TYPE) {
        const completion = readCompletionEntry(entry.data);
        if (completion)
          this.components.push({
            render: (width) => renderRunCompletion(completion, this.theme, width, this.ascii),
            invalidate() {},
          });
      } else if (entry.type === "custom_message" && entry.display) {
        this.components.push(this.label(entry.customType));
        this.components.push(
          this.withAttachments(
            new ReferenceAssistantText(
              contentText(entry.content, entry.id, this.images),
              this.theme,
              this.ascii,
            ),
            entry.id,
          ),
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
      if (component instanceof ToolExecutionComponent)
        while (rendered.length && !stripTerminalSequences(rendered.at(-1) ?? "").trim())
          rendered.pop();
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

export function registerTranscriptCommand(
  pi: ExtensionAPI,
  ascii = useAsciiChrome,
  prepareImages?: PrepareImages,
): void {
  pi.registerCommand("pituix-transcript", {
    description: "Read the current conversation with reference message and tool layout",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      const entries = ctx.sessionManager.getBranch();
      const load = new AbortController();
      let closed = false;
      try {
        await ctx.ui.custom<void>(
          (tui, theme, keys, done) => {
            const content = new TranscriptContent(entries, theme, tui, ctx.cwd, ascii(), {
              imageLoading: Boolean(prepareImages),
            });
            // Prepare asynchronously outside render; Escape remains responsive.
            if (prepareImages)
              void prepareImages(entries, load.signal)
                .catch(() => new Map<string, string>())
                .then((links) => {
                  if (closed || load.signal.aborted) return;
                  content.setImageLinks(links);
                  tui.requestRender();
                });
            const view = new TranscriptView(
              content,
              theme,
              () => tui.terminal.rows,
              () => {
                closed = true;
                load.abort();
                done(undefined);
              },
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
      } finally {
        closed = true;
        load.abort();
      }
    },
  });
}
