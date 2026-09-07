import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  type ExtensionContext,
  parseSkillBlock,
  type SessionEntry,
  SkillInvocationMessageComponent,
  sessionEntryToContextMessages,
  type Theme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Container,
  Image,
  Spacer,
  stripTerminalSequences,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { AttachedContent, contentText } from "../../session/image-attachment-view.ts";
import {
  collectImages,
  type ImageAttachment,
  type ImageLinks,
  imageLabel,
  type PrepareImages,
} from "../../session/image-attachments.ts";
import { ReferenceUserMessage } from "../../session/message-view.ts";

type Message = Extract<SessionEntry, { type: "message" }>["message"];
type Kind = "user" | "assistant" | "tool" | "skill" | "custom" | "bash" | "compaction" | "branch";
interface Row {
  kind: Kind;
  entryId: string;
  userText?: string;
  content?: unknown;
  skill?: boolean;
  images?: readonly ImageAttachment[];
  imageSummary?: boolean;
}

function kind(component: Component): Kind | undefined {
  if (component instanceof UserMessageComponent) return "user";
  if (component instanceof AssistantMessageComponent) return "assistant";
  if (component instanceof ToolExecutionComponent) return "tool";
  if (component instanceof SkillInvocationMessageComponent) return "skill";
  if (component instanceof CustomMessageComponent) return "custom";
  if (component instanceof BashExecutionComponent) return "bash";
  if (component instanceof CompactionSummaryMessageComponent) return "compaction";
  if (component instanceof BranchSummaryMessageComponent) return "branch";
  return undefined;
}

export function hasNativeMessages(container: Container): boolean {
  return container.children.some((child) => kind(child) !== undefined);
}

/** User text is joined exactly as Pi's public user component receives it. */
function userText(message: UserMessage): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
}

/** Public message order supplies identities that the native components do not expose. */
export class LiveImagePresentation {
  private readonly tui: TUI;
  private readonly getTheme: () => Theme;
  private readonly getAscii: () => boolean;
  private readonly prepare: PrepareImages;
  private rows: Row[] = [];
  private images: ImageAttachment[] = [];
  private imageMap = new Map<string, ImageAttachment>();
  private links: ImageLinks = new Map();
  private load: AbortController | undefined;
  private loading = false;
  private closed = false;
  private entries: SessionEntry[] = [];
  private staged: Extract<SessionEntry, { type: "message" }> | undefined;
  private sequence = 0;
  private toolSignature = "";
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly sessionId: string;
  private userCache = new WeakMap<
    Row,
    {
      width: number;
      theme: Theme;
      ascii: boolean;
      links: ImageLinks;
      loading: boolean;
      lines: string[];
    }
  >();

  constructor(tui: TUI, ctx: ExtensionContext, getAscii: () => boolean, prepare: PrepareImages) {
    this.tui = tui;
    this.getTheme = () => ctx.ui.theme;
    this.getAscii = getAscii;
    this.prepare = prepare;
    this.sessionId = ctx.sessionManager.getSessionId();
    this.refresh(ctx);
  }

  refresh(ctx: ExtensionContext): void {
    if (this.closed || ctx.sessionManager.getSessionId() !== this.sessionId) return;
    this.staged = undefined;
    clearTimeout(this.settleTimer);
    this.entries = ctx.sessionManager.buildContextEntries();
    this.rebuild();
  }

  start(message: Message, ctx: ExtensionContext): void {
    if (this.closed || ctx.sessionManager.getSessionId() !== this.sessionId) return;
    if (message.role !== "user" && message.role !== "assistant") return;
    clearTimeout(this.settleTimer);
    this.entries = ctx.sessionManager.buildContextEntries();
    this.staged = {
      type: "message",
      id: `pi-tuix-live-${++this.sequence}`,
      parentId: null,
      timestamp: new Date(message.timestamp).toISOString(),
      message,
    };
    this.toolSignature = message.role === "assistant" ? this.calls(message) : "";
    this.rebuild();
  }

  update(message: AssistantMessage): void {
    if (this.closed || this.staged?.message.role !== "assistant") return;
    this.staged = { ...this.staged, message };
    const signature = this.calls(message);
    if (signature !== this.toolSignature) {
      this.toolSignature = signature;
      if (this.images.length) this.rebuild();
    }
  }

  private calls(message: AssistantMessage): string {
    return JSON.stringify(
      message.content.filter((part) => part.type === "toolCall").map((part) => part.id),
    );
  }

  end(message: Message, ctx: ExtensionContext): void {
    if (this.closed || ctx.sessionManager.getSessionId() !== this.sessionId) return;
    if (this.staged?.message.role === message.role) this.staged = { ...this.staged, message };
    this.rebuild();
    clearTimeout(this.settleTimer);
    // Pi emits message_end before appending the native entry. Re-read after
    // dispatch; a following message_start replaces this pending refresh.
    this.settleTimer = setTimeout(() => this.refresh(ctx), 0);
  }

  private rebuild(): void {
    const entries = this.staged ? [...this.entries, this.staged] : this.entries;
    const images = collectImages(entries);
    const changed =
      images.length !== this.images.length ||
      images.some((image, index) => {
        const before = this.images[index];
        return (
          image.key !== before?.key ||
          image.data !== before.data ||
          image.mimeType !== before.mimeType
        );
      });
    this.images = images;
    this.imageMap = new Map(images.map((image) => [image.key, image]));
    if (!images.length) {
      this.rows = [];
      if (changed) {
        this.load?.abort();
        this.links = new Map();
        this.loading = false;
        this.tui.requestRender();
      }
      return;
    }
    const attachments = new Map<string, ImageAttachment[]>();
    for (const image of images)
      attachments.set(image.entryId, [...(attachments.get(image.entryId) ?? []), image]);
    const results = new Map<string, { entryId: string; imageSummary: boolean }>();
    for (const entry of entries)
      if (entry.type === "message" && entry.message.role === "toolResult")
        results.set(entry.message.toolCallId, {
          entryId: entry.id,
          imageSummary: entry.message.toolName === "read" && !entry.message.isError,
        });
    this.rows = [];
    for (const entry of entries) {
      for (const message of sessionEntryToContextMessages(entry)) {
        const base = { entryId: entry.id, images: attachments.get(entry.id) };
        if (message.role === "user") {
          const text = userText(message);
          const skill = parseSkillBlock(text);
          if (skill) this.rows.push({ kind: "skill", entryId: entry.id });
          const visible = skill?.userMessage ?? (skill ? "" : text);
          if (visible || base.images?.length)
            this.rows.push({
              ...base,
              kind: "user",
              userText: visible,
              content: message.content,
              skill: Boolean(skill),
            });
        } else if (message.role === "assistant") {
          this.rows.push({ kind: "assistant", entryId: entry.id });
          for (const part of message.content)
            if (part.type === "toolCall") {
              const result = results.get(part.id);
              this.rows.push({
                kind: "tool",
                entryId: result?.entryId ?? entry.id,
                images: result ? attachments.get(result.entryId) : undefined,
                imageSummary: result?.imageSummary,
              });
            }
        } else if (message.role === "bashExecution") this.rows.push({ ...base, kind: "bash" });
        else if (message.role === "custom" && message.display)
          this.rows.push({ ...base, kind: "custom" });
        else if (message.role === "compactionSummary")
          this.rows.push({ ...base, kind: "compaction" });
        else if (message.role === "branchSummary") this.rows.push({ ...base, kind: "branch" });
      }
    }
    if (changed) {
      this.load?.abort();
      this.links = new Map();
      this.loading = images.length > 0;
      if (images.length) {
        const request = new AbortController();
        this.load = request;
        void this.prepare(entries, request.signal)
          .catch(() => new Map<string, string>())
          .then((links) => {
            if (this.closed || request.signal.aborted || this.load !== request) return;
            this.links = links;
            this.loading = false;
            this.tui.invalidate();
            this.tui.requestRender();
          });
      }
    }
    if (images.length || changed) this.tui.requestRender();
  }

  private attached(content: Component, row: Row): Component {
    return new AttachedContent(
      content,
      row.images ?? [],
      this.links,
      this.getTheme(),
      this.getAscii(),
      this.loading,
    );
  }

  /** Unknown or incomplete native sequences keep their original output. */
  render(
    chat: Container,
    width: number,
    render: (component: Component, width: number) => string[],
    readUser: (component: UserMessageComponent, width: number) => string | undefined,
  ): string[] | undefined {
    if (this.closed || !this.images.length) return undefined;
    const native = chat.children.filter((component) => kind(component));
    const visible = this.rows.filter((row) => row.kind !== "user" || row.userText);
    if (
      native.length !== visible.length ||
      native.some((component, index) => kind(component) !== visible[index].kind)
    )
      return undefined;
    for (let index = 0; index < native.length; index++) {
      const component = native[index];
      if (
        component instanceof UserMessageComponent &&
        readUser(component, width) !== visible[index].userText
      )
        return undefined;
    }
    const bindings = new Map<Component, Row>();
    const before = new Map<Component, Row[]>();
    let cursor = 0;
    let pending: Row[] = [];
    for (const row of this.rows) {
      if (row.kind === "user" && !row.userText) pending.push(row);
      else {
        const component = native[cursor++];
        bindings.set(component, row);
        if (pending.length) before.set(component, pending);
        pending = [];
      }
    }
    const lines: string[] = [];
    let needsGap = false;
    const addMissing = (row: Row) => {
      while (lines.length && !stripTerminalSequences(lines.at(-1) ?? "").trim()) lines.pop();
      if (lines.length) lines.push("");
      lines.push(...this.renderUser(row, width));
      needsGap = true;
    };
    for (const component of chat.children) {
      for (const row of before.get(component) ?? []) addMissing(row);
      const row = bindings.get(component);
      let rendered =
        row?.kind === "user" && row.images?.length
          ? this.renderUser(row, width)
          : render(component, width);
      if (row?.images?.length && row.kind !== "user") {
        // Render only the host's public children when they reproduce its output
        // exactly, then omit native bitmap rows in favor of summaries/links.
        if (
          component instanceof ToolExecutionComponent &&
          component.children.some((child) => child instanceof Image)
        ) {
          const childLines = (child: Component) =>
            child
              .render(Math.max(4, width))
              .map((line) => (width < 4 ? truncateToWidth(line, width, "") : line));
          const children = component.children.flatMap(childLines);
          if (
            children.length === rendered.length &&
            children.every((line, index) => line === rendered[index])
          ) {
            rendered = component.children.flatMap((child, index, all) =>
              child instanceof Image || (child instanceof Spacer && all[index + 1] instanceof Image)
                ? []
                : childLines(child),
            );
          }
        }
        if (!row.imageSummary) {
          const body = rendered;
          rendered = this.attached({ render: () => body, invalidate() {} }, row).render(width);
        }
      }
      if (needsGap) {
        rendered = [...rendered];
        while (rendered.length && !stripTerminalSequences(rendered[0]).trim()) rendered.shift();
        if (rendered.length) {
          lines.push("");
          needsGap = false;
        }
      }
      lines.push(...rendered);
    }
    for (const row of pending) addMissing(row);
    return lines;
  }

  private renderUser(row: Row, width: number): string[] {
    const theme = this.getTheme();
    const ascii = this.getAscii();
    const cached = this.userCache.get(row);
    if (
      cached?.width === width &&
      cached.theme === theme &&
      cached.ascii === ascii &&
      cached.links === this.links &&
      cached.loading === this.loading
    )
      return cached.lines;
    const text = row.skill
      ? [row.userText, ...(row.images ?? []).filter((image) => !image.inline).map(imageLabel)]
          .filter(Boolean)
          .join(" ")
      : contentText(row.content, row.entryId, this.imageMap);
    const content = new ReferenceUserMessage(text, theme, ascii);
    const lines = this.attached(content, row).render(width);
    if (lines.length) {
      lines[0] = `\x1b]133;A\x07${lines[0]}`;
      lines[lines.length - 1] += "\x1b]133;B\x07\x1b]133;C\x07";
    }
    this.userCache.set(row, {
      width,
      theme,
      ascii,
      links: this.links,
      loading: this.loading,
      lines,
    });
    return lines;
  }

  invalidate(): void {
    this.userCache = new WeakMap();
  }

  dispose(): void {
    this.closed = true;
    clearTimeout(this.settleTimer);
    this.load?.abort();
    this.entries = [];
    this.rows = [];
    this.images = [];
    this.imageMap.clear();
    this.links = new Map();
    this.staged = undefined;
    this.invalidate();
  }
}
