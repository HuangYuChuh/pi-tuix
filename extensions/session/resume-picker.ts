import { basename } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  keyText,
  type SessionInfo,
  SessionManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  CURSOR_MARKER,
  getKeybindings,
  Input,
  Key,
  matchesKey,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { readGitBranch } from "./git-branch.ts";
import { renameSession } from "./rename-session.ts";
import {
  loadSessionMetadata,
  loadSessionPreview,
  type SessionMetadata,
  SessionPreviewContent,
  type SessionPreviewSnapshot,
} from "./session-preview.ts";

interface PreviewComponent extends Component {
  setExpanded?(expanded: boolean): void;
}

function plain(value: string): string {
  return stripTerminalSequences(value).replace(/\p{Cc}/gu, (char) =>
    char === "\n" ? "\n" : char === "\t" ? " " : "",
  );
}

function title(session: SessionInfo): string {
  return plain(session.name || session.firstMessage || "Untitled session").replace(/\s+/g, " ");
}

function age(date: Date, now: number): string {
  const elapsed = now - date.getTime();
  if (!Number.isFinite(elapsed)) return "Unknown time";
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function compactAge(date: Date, now: number): string {
  const elapsed = now - date.getTime();
  if (!Number.isFinite(elapsed)) return "Unknown time";
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function formatSessionSize(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0) return;
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)}${units[unit]}`;
}

/** Session presentation and input state. All I/O lives in the command. */
export class ResumePicker {
  focused = true;
  private readonly search = new Input();
  private rename = new Input();
  private readonly options: {
    theme: Theme;
    ascii: boolean;
    cwd: string;
    currentPath?: string;
    getRows: () => number;
    now?: () => number;
    done: (path: string | undefined) => void;
    onScopeChange: (all: boolean) => void;
    onPreviewChange?: (session: SessionInfo | undefined) => void;
    expandKey?: (data: string) => boolean;
    renameKey?: (data: string) => boolean;
    renameHint?: string;
    onRename?: (session: SessionInfo, name: string) => void;
    onRenameCancel?: () => void;
  };
  private sessions: readonly SessionInfo[] = [];
  private filtered: readonly SessionInfo[] = [];
  private selected = 0;
  private searching = false;
  private preview = false;
  private previewOffset = 0;
  private previewContent: PreviewComponent | undefined;
  private previewLoading = false;
  private previewError: string | undefined;
  private previewExpanded = false;
  private all = false;
  private branchOnly = false;
  private branchReady = false;
  private currentBranch: string | undefined;
  private renaming: SessionInfo | undefined;
  private saving = false;
  private renameError: string | undefined;
  private loading = true;
  private error: string | undefined;
  private finished = false;
  private pageSize = 5;
  private previewCache: { path: string; width: number; lines: string[] } | undefined;
  private readonly metadata = new Map<string, SessionMetadata>();

  constructor(options: ResumePicker["options"]) {
    this.options = options;
  }

  /** Read candidates outside render; the command owns asynchronous I/O. */
  metadataCandidates(): readonly SessionInfo[] {
    if (this.finished || this.loading) return [];
    if (this.branchOnly) return this.currentBranch ? this.sessions : [];
    const count = Math.max(1, Math.min(200, Math.ceil(this.options.getRows())));
    const start = Math.max(
      0,
      Math.min(this.selected - Math.floor(count / 2), this.filtered.length - count),
    );
    return this.filtered.slice(start, start + count);
  }

  setMetadata(path: string, metadata: SessionMetadata): void {
    if (this.finished) return;
    this.metadata.set(path, { byteSize: metadata.byteSize, gitBranch: metadata.gitBranch });
    if (this.branchOnly) this.filter(true);
  }

  setCurrentBranch(branch: string | undefined): void {
    if (this.finished) return;
    this.currentBranch = branch;
    this.branchReady = true;
    this.filter(true);
  }

  applyRename(path: string, name: string): void {
    if (this.finished) return;
    this.sessions = this.sessions.map((session) =>
      session.path === path ? { ...session, name } : session,
    );
    const previous = this.metadata.get(path);
    if (previous) this.metadata.set(path, { gitBranch: previous.gitBranch });
    this.filter(true);
    if (this.renaming?.path === path) this.closeRename();
  }

  setRenameError(path: string, error: unknown): void {
    if (this.finished || this.renaming?.path !== path) return;
    this.saving = false;
    this.renameError = `Could not rename session: ${plain(String(error))}`;
  }

  private closeRename(): void {
    this.renaming = undefined;
    this.saving = false;
    this.renameError = undefined;
  }

  setSessions(sessions: readonly SessionInfo[]): void {
    if (this.finished) return;
    this.previewCache = undefined;
    const unique = new Map(sessions.map((session) => [session.path, session]));
    this.sessions = [...unique.values()].sort(
      (a, b) => b.modified.getTime() - a.modified.getTime(),
    );
    this.loading = false;
    this.error = undefined;
    this.filter(true);
  }

  setError(error: unknown): void {
    if (this.finished) return;
    this.loading = false;
    this.error = `Could not load sessions: ${plain(String(error))}`;
    this.sessions = [];
    this.filter();
  }

  setPreview(path: string, content: PreviewComponent): void {
    if (this.finished || !this.preview || this.filtered[this.selected]?.path !== path) return;
    this.previewContent = content;
    content.setExpanded?.(this.previewExpanded);
    this.previewLoading = false;
    this.previewError = undefined;
    this.previewCache = undefined;
  }

  setPreviewError(path: string, error: unknown): void {
    if (this.finished || !this.preview || this.filtered[this.selected]?.path !== path) return;
    this.previewLoading = false;
    this.previewError = `Could not load preview: ${plain(String(error))}`;
    this.previewCache = undefined;
  }

  private closePreview(): void {
    this.preview = false;
    this.previewContent = undefined;
    this.previewCache = undefined;
    this.options.onPreviewChange?.(undefined);
  }

  private filter(preserveSelection = false): void {
    const selectedPath = this.filtered[this.selected]?.path;
    const words = this.search.getValue().toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    this.filtered = this.sessions.filter((session) => {
      if (
        this.branchOnly &&
        (!this.currentBranch || this.metadata.get(session.path)?.gitBranch !== this.currentBranch)
      )
        return false;
      const text =
        `${title(session)} ${session.cwd} ${session.allMessagesText}`.toLocaleLowerCase();
      return words.every((word) => text.includes(word));
    });
    const index = preserveSelection
      ? this.filtered.findIndex((session) => session.path === selectedPath)
      : -1;
    if (index >= 0) this.selected = index;
    this.selected = Math.min(this.selected, Math.max(0, this.filtered.length - 1));
    if (!preserveSelection) this.previewOffset = 0;
    if (this.preview && selectedPath !== this.filtered[this.selected]?.path) this.closePreview();
  }

  handleInput(data: string): void {
    if (this.finished) return;
    const keys = getKeybindings();
    if (this.renaming) {
      if (keys.matches(data, "tui.select.cancel")) {
        this.options.onRenameCancel?.();
        this.closeRename();
      } else if (!this.saving && keys.matches(data, "tui.select.confirm")) {
        const name = this.rename
          .getValue()
          .replace(/[\r\n]/g, " ")
          .trim();
        if (!name) return;
        if (name === this.renaming.name) this.closeRename();
        else {
          this.saving = true;
          this.renameError = undefined;
          this.options.onRename?.(this.renaming, name);
        }
      } else if (!this.saving) this.rename.handleInput(data);
      return;
    }
    if (keys.matches(data, "tui.select.cancel")) {
      if (this.preview) this.closePreview();
      else if (this.searching && this.search.getValue()) {
        this.search.setValue("");
        this.selected = 0;
        this.filter();
      } else if (this.searching) this.searching = false;
      else {
        this.finished = true;
        this.options.done(undefined);
      }
      return;
    }
    const up = keys.matches(data, "tui.select.up");
    const down = keys.matches(data, "tui.select.down");
    const pageUp = keys.matches(data, "tui.select.pageUp");
    const pageDown = keys.matches(data, "tui.select.pageDown");
    const confirm = keys.matches(data, "tui.select.confirm");
    if (this.preview) {
      const wheel = data.startsWith("\x1b") ? /^\[<(64|65);\d+;\d+M$/.exec(data.slice(1)) : null;
      if (data === " ") this.closePreview();
      else if (this.options.expandKey?.(data)) {
        this.previewExpanded = !this.previewExpanded;
        this.previewContent?.setExpanded?.(this.previewExpanded);
        this.previewCache = undefined;
      } else if (matchesKey(data, Key.home)) this.previewOffset = 0;
      else if (matchesKey(data, Key.end)) this.previewOffset = Number.MAX_SAFE_INTEGER;
      else if (wheel)
        this.previewOffset = Math.max(0, this.previewOffset + (wheel[1] === "64" ? -3 : 3));
      else if (up || down || pageUp || pageDown) {
        this.previewOffset = Math.max(
          0,
          this.previewOffset + (up ? -1 : down ? 1 : pageUp ? -this.pageSize : this.pageSize),
        );
      } else if (confirm) this.choose();
      return;
    }
    if (this.searching) {
      if (confirm || down) {
        if (!this.loading && this.filtered.length) this.searching = false;
      } else {
        this.search.handleInput(data);
        this.selected = 0;
        this.filter();
      }
      return;
    }
    if (matchesKey(data, Key.ctrl("a")) && !this.loading) {
      this.all = !this.all;
      this.loading = true;
      this.error = undefined;
      this.options.onScopeChange(this.all);
    } else if (matchesKey(data, Key.ctrl("b"))) {
      this.branchOnly = !this.branchOnly;
      this.filter(true);
    } else if (this.options.renameKey?.(data) && this.options.onRename && !this.loading) {
      this.renaming = this.filtered[this.selected];
      this.rename = new Input();
      // Public paste handling initializes both text and the trailing cursor.
      this.rename.handleInput(
        `\x1b[200~${plain(this.renaming?.name ?? "").replace(/\s+/g, " ")}\x1b[201~`,
      );
    } else if (confirm) this.choose();
    else if ((up || down || pageUp || pageDown) && !this.loading && this.filtered.length) {
      const count = this.filtered.length;
      this.selected = pageUp
        ? Math.max(0, this.selected - this.pageSize)
        : pageDown
          ? Math.min(count - 1, this.selected + this.pageSize)
          : (this.selected + (up ? -1 : 1) + count) % count;
    } else if (data === " " && !this.loading && this.filtered.length) {
      this.preview = true;
      this.previewOffset = 0;
      this.previewExpanded = false;
      this.previewContent = undefined;
      this.previewError = undefined;
      this.previewLoading = Boolean(this.options.onPreviewChange);
      this.previewCache = undefined;
      this.options.onPreviewChange?.(this.filtered[this.selected]);
    } else if (data === "/" || data.startsWith("\x1b[200~") || /^[^\p{Cc}]+$/u.test(data)) {
      this.searching = true;
      if (data !== "/") this.search.handleInput(data);
      this.selected = 0;
      this.filter();
    }
  }

  private choose(): void {
    const session = this.filtered[this.selected];
    if (this.loading || !session) return;
    this.finished = true;
    this.options.done(session.path);
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const { theme, ascii } = this.options;
    const rows = Math.max(1, Math.floor(this.options.getRows()));
    const compact = rows < 14;
    const panelRows = compact ? rows : Math.min(rows, 20);
    const inset = width >= 16 ? "   " : "";
    const inner = Math.max(1, width - inset.length * 2);
    const accent = (text: string) => theme.fg("mdLink", text);
    const muted = (text: string) => theme.fg("muted", text);
    const clip = (line: string) => truncateToWidth(line, width, "");
    const finishPanel = (lines: string[]) =>
      [...lines, ...Array<string>(Math.max(0, panelRows - lines.length)).fill("")]
        .slice(0, panelRows)
        .map(clip);
    const separator = ascii ? " | " : " · ";
    const metadata = (session: SessionInfo, preview = false) => {
      const details = this.metadata.get(session.path);
      const now = (this.options.now ?? Date.now)();
      return [
        preview ? compactAge(session.modified, now) : age(session.modified, now),
        ...(preview
          ? [`${session.messageCount} message${session.messageCount === 1 ? "" : "s"}`]
          : []),
        ...(details?.gitBranch ? [plain(details.gitBranch).replace(/\s+/g, " ")] : []),
        ...(!preview && formatSessionSize(details?.byteSize)
          ? [formatSessionSize(details?.byteSize)]
          : []),
        ...(this.all && session.cwd ? [plain(session.cwd)] : []),
      ].join(separator);
    };
    const count =
      !this.searching && !this.renaming && this.filtered.length > 1
        ? ` (${this.selected + 1} of ${this.filtered.length})`
        : "";
    const heading = compact
      ? [`${inset}${accent(theme.bold(this.preview ? "Session preview" : "Resume session"))}`]
      : [
          accent((ascii ? "-" : "▔").repeat(width)),
          `${inset}${accent(theme.bold(this.preview ? "Session preview" : `Resume session${count}`))}`,
        ];
    const selected = this.filtered[this.selected];
    if (this.preview && selected) {
      const previewInset = width >= 8 ? "  " : "";
      const bodyWidth = Math.max(1, width - previewInset.length * 2);
      if (this.previewCache?.path !== selected.path || this.previewCache.width !== bodyWidth) {
        this.previewCache = {
          path: selected.path,
          width: bodyWidth,
          lines: this.previewContent
            ? this.previewContent.render(bodyWidth)
            : [
                accent(theme.bold("Session preview")),
                accent(title(selected)),
                "",
                ...(this.previewLoading
                  ? [muted("Loading conversation...")]
                  : this.previewError
                    ? [theme.fg("error", this.previewError)]
                    : plain(selected.allMessagesText || selected.firstMessage || "No message text")
                        .split("\n")
                        .flatMap((line) => wrapTextWithAnsi(line, bodyWidth))),
              ],
        };
      }
      const lines = [
        ...this.previewCache.lines,
        muted((ascii ? "-" : "─").repeat(bodyWidth)),
        muted(`  ${metadata(selected, true)}`),
        muted(`  Enter to resume${separator}Esc to return`),
      ];
      const top = rows >= 3 ? [accent((ascii ? "-" : "▔").repeat(width))] : [];
      const budget = Math.max(1, rows - top.length);
      this.pageSize = budget;
      this.previewOffset = Math.min(this.previewOffset, Math.max(0, lines.length - budget));
      const body = lines
        .slice(this.previewOffset, this.previewOffset + budget)
        .map((line) => `${previewInset}${truncateToWidth(line, bodyWidth, "")}`);
      const mark = (index: number, symbol: string) => {
        if (width < 8 || !body[index]) return;
        const line = truncateToWidth(body[index], width - 2, "");
        body[index] =
          line + " ".repeat(Math.max(0, width - 2 - visibleWidth(line))) + muted(symbol);
      };
      if (this.previewOffset > 0) mark(0, ascii ? "^" : "↑");
      if (this.previewOffset + budget < lines.length) mark(body.length - 1, ascii ? "v" : "↓");
      return [...top, ...body].slice(0, rows).map(clip);
    }
    this.search.focused = this.focused && this.searching;
    const queryWidth = Math.max(1, inner - 6);
    const query = this.search.getValue();
    const searchText = query
      ? this.search.focused
        ? (this.search.render(Math.max(4, queryWidth + 2))[0] ?? "").slice(2)
        : plain(query)
      : muted(this.search.focused ? `${CURSOR_MARKER}${theme.inverse("S")}earch...` : "Search...");
    const fitted = truncateToWidth(searchText, queryWidth, "");
    const frame = this.searching ? accent : muted;
    if (!compact && inner >= 8) {
      const rule = (ascii ? "-" : "─").repeat(inner - 2);
      heading.push(
        `${inset}${frame(`${ascii ? "+" : "╭"}${rule}${ascii ? "+" : "╮"}`)}`,
        `${inset}${frame(ascii ? "|" : "│")} ${ascii ? "/" : "⌕"} ${fitted}${" ".repeat(Math.max(0, queryWidth - visibleWidth(fitted)))} ${frame(ascii ? "|" : "│")}`,
        `${inset}${frame(`${ascii ? "+" : "╰"}${rule}${ascii ? "+" : "╯"}`)}`,
        `${inset}  ${muted((this.all ? "All projects" : plain(basename(this.options.cwd))) + (this.branchOnly && this.currentBranch ? separator + plain(this.currentBranch) : ""))}`,
        "",
      );
    } else heading.push(`${inset}/${fitted}`);
    if (this.renaming) {
      this.rename.focused = this.focused && !this.saving;
      const nameWidth = Math.max(1, inner - 2);
      const name = this.rename.getValue()
        ? (this.rename.render(Math.max(4, nameWidth + 2))[0] ?? "").slice(2)
        : muted(
            `${this.rename.focused ? CURSOR_MARKER + theme.inverse("E") : "E"}nter new session name`,
          );
      const body = [
        `${inset}  ${theme.bold("Rename session:")}`,
        ...(!compact ? [""] : []),
        `${inset}  ${truncateToWidth(name, nameWidth, "")}`,
        ...(this.renameError
          ? wrapTextWithAnsi(theme.fg("error", this.renameError), inner)
              .slice(0, Math.max(0, panelRows - heading.length - (compact ? 3 : 4)))
              .map((line) => inset + line)
          : []),
        `${inset}  ${muted(this.saving ? "Saving session name..." : `Enter to save${separator}Esc to cancel`)}`,
      ];
      return finishPanel(rows < 4 ? [body[compact ? 1 : 2]] : [...heading, ...body]);
    }
    const hint = this.searching
      ? `Type to search${separator}Enter to select${separator}Esc to clear`
      : `Ctrl+A to show ${this.all ? "current project" : "all projects"}${separator}Ctrl+B to ${this.branchOnly ? "show all branches" : "only show current branch"}${separator}Space to preview${this.options.onRename ? `${separator}${this.options.renameHint ?? "Ctrl+R"} to rename` : ""}${separator}Type to search${separator}Esc to cancel`;
    const hints = compact
      ? [clip(`${inset}${muted(hint)}`)]
      : wrapTextWithAnsi(muted(hint), Math.max(1, inner - 2))
          .slice(0, 3)
          .map((line) => `${inset}  ${line}`);
    const tail = !compact && panelRows >= 18 ? 2 : 0;
    const budget = Math.max(1, panelRows - heading.length - hints.length - tail);
    const rowHeight = compact ? 1 : 3;
    this.pageSize = Math.max(1, Math.min(compact ? Infinity : 3, Math.floor(budget / rowHeight)));
    const start = Math.max(
      0,
      Math.min(this.selected - Math.floor(this.pageSize / 2), this.filtered.length - this.pageSize),
    );
    const body: string[] = [];
    if (this.loading) body.push(`${inset}  ${muted("Loading sessions...")}`);
    else if (this.error) body.push(`${inset}${theme.fg("error", this.error)}`);
    else if (this.branchOnly && !this.branchReady)
      body.push(`${inset}  ${muted("Reading current Git branch...")}`);
    else if (this.branchOnly && !this.currentBranch)
      body.push(`${inset}  ${muted("Current Git branch unavailable")}`);
    else if (!this.filtered.length)
      body.push(
        `${inset}  ${muted(this.branchOnly && this.sessions.some((session) => !this.metadata.has(session.path)) ? "Reading recorded session branches..." : query || this.branchOnly ? "No matching sessions" : "No saved sessions")}`,
      );
    else
      for (let i = start; i < Math.min(this.filtered.length, start + this.pageSize); i++) {
        const session = this.filtered[i];
        const active = i === this.selected && !this.searching;
        const prefix = active
          ? `${ascii ? ">" : "❯"} `
          : i === start && start > 0
            ? `${ascii ? "^" : "↑"} `
            : i === start + this.pageSize - 1 && i < this.filtered.length - 1
              ? `${ascii ? "v" : "↓"} `
              : "  ";
        const current = session.path === this.options.currentPath ? " [current]" : "";
        const label = `${truncateToWidth(title(session), Math.max(1, inner - 2 - current.length), "")}${current}`;
        body.push(`${inset}${active ? accent(prefix + label) : prefix + label}`);
        if (!compact) body.push(`${inset}  ${muted(metadata(session))}`, "");
      }
    if (rows < 4) return (this.searching ? [`${inset}/${fitted}`] : body).slice(0, rows).map(clip);
    if (!compact) while (body.length < this.pageSize * rowHeight) body.push("");
    return finishPanel([...heading, ...body, ...hints]);
  }

  invalidate(): void {
    this.search.invalidate();
    this.rename.invalidate();
    this.previewContent?.invalidate();
    this.previewCache = undefined;
  }
}

interface SessionCatalog {
  list(cwd: string, sessionDir?: string): Promise<SessionInfo[]>;
  listAll(sessionDir?: string): Promise<SessionInfo[]>;
}

export function registerResumePicker(
  pi: ExtensionAPI,
  hooks: {
    ascii: () => boolean;
    onOpen: () => void;
    onClose: () => void;
    onResume?: (ctx: ExtensionCommandContext) => void;
  },
  catalog: SessionCatalog = SessionManager,
  readPreview: (
    session: SessionInfo,
    signal: AbortSignal,
  ) => Promise<SessionPreviewSnapshot> = loadSessionPreview,
  readMetadata: (
    session: SessionInfo,
    signal: AbortSignal,
  ) => Promise<SessionMetadata> = loadSessionMetadata,
  services: { readBranch?: typeof readGitBranch; rename?: typeof renameSession } = {},
): void {
  pi.registerCommand("pituix-resume", {
    description: "Search, filter, rename, preview and resume Pi sessions",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      const currentPath = ctx.sessionManager.getSessionFile();
      const sessionDir = ctx.sessionManager.getSessionDir();
      hooks.onOpen();
      let path: string | undefined;
      let closed = false;
      let previewLoad: AbortController | undefined;
      let renameLoad: AbortController | undefined;
      const metadataLoad = new AbortController();
      try {
        path = await ctx.ui.custom<string | undefined>(
          (tui, theme, keys, done) => {
            let current: SessionInfo[] = [];
            let all: SessionInfo[] | undefined;
            let allProjects = false;
            const requested = new Set<string>();
            const previewMetadata = new Set<string>();
            let pending: SessionInfo[] = [];
            const generations = new Map<string, number>();
            let reading = 0;
            const loadMetadata = () => {
              pending = view.metadataCandidates().filter((session) => !requested.has(session.path));
              const pump = () => {
                if (closed) return;
                while (reading < 2 && pending.length) {
                  const session = pending.shift();
                  if (!session) break;
                  requested.add(session.path);
                  const generation = generations.get(session.path);
                  reading++;
                  void readMetadata(session, metadataLoad.signal)
                    .then((metadata) => {
                      if (
                        !closed &&
                        generations.get(session.path) === generation &&
                        !previewMetadata.has(session.path)
                      )
                        view.setMetadata(session.path, metadata);
                    })
                    .catch(() => {
                      if (
                        !closed &&
                        generations.get(session.path) === generation &&
                        !previewMetadata.has(session.path)
                      )
                        view.setMetadata(session.path, {});
                    })
                    .finally(() => {
                      reading--;
                      if (!closed) {
                        tui.requestRender();
                        pump();
                      }
                    });
                }
              };
              pump();
            };
            const load = async (scope: boolean) => {
              try {
                if (scope) {
                  all ??= [
                    ...current,
                    ...(await Promise.all([catalog.listAll(), catalog.listAll(sessionDir)])).flat(),
                  ];
                } else current = await catalog.list(ctx.cwd, sessionDir);
                if (!closed) {
                  view.setSessions(scope ? (all ?? []) : current);
                  loadMetadata();
                }
              } catch (error) {
                if (!closed) view.setError(error);
              }
              if (!closed) tui.requestRender();
            };
            const view = new ResumePicker({
              theme,
              ascii: hooks.ascii(),
              cwd: ctx.cwd,
              currentPath,
              getRows: () => Math.max(1, tui.terminal.rows - 2),
              done: (selection) => {
                closed = true;
                done(selection);
              },
              onScopeChange: (scope) => {
                allProjects = scope;
                void load(allProjects);
              },
              expandKey: (data) => keys.matches(data, "app.tools.expand"),
              renameKey: (data) => keys.matches(data, "app.session.rename"),
              renameHint: keyText("app.session.rename"),
              onRenameCancel: () => renameLoad?.abort(),
              onRename: (session, name) => {
                renameLoad?.abort();
                const request = new AbortController();
                renameLoad = request;
                void (services.rename ?? renameSession)(session, name, request.signal, {
                  path: ctx.sessionManager.getSessionFile(),
                  id: ctx.sessionManager.getSessionId(),
                  setName: (value) => pi.setSessionName(value),
                })
                  .then(async () => {
                    if (closed || request.signal.aborted || renameLoad !== request) return;
                    generations.set(session.path, (generations.get(session.path) ?? 0) + 1);
                    requested.delete(session.path);
                    previewMetadata.delete(session.path);
                    view.applyRename(session.path, name);
                    // Refresh authoritative ordering and size without resuming.
                    current = current.map((item) =>
                      item.path === session.path ? { ...item, name } : item,
                    );
                    all = undefined;
                    await load(allProjects);
                  })
                  .catch((error) => {
                    if (closed || request.signal.aborted || renameLoad !== request) return;
                    view.setRenameError(session.path, error);
                    tui.requestRender();
                  });
              },
              onPreviewChange: (session) => {
                previewLoad?.abort();
                previewLoad = undefined;
                if (!session || closed) return;
                const request = new AbortController();
                previewLoad = request;
                void readPreview(session, request.signal)
                  .then((snapshot) => {
                    if (closed || request.signal.aborted || previewLoad !== request) return;
                    view.setPreview(
                      session.path,
                      new SessionPreviewContent(snapshot, theme, tui, hooks.ascii()),
                    );
                    previewMetadata.add(session.path);
                    view.setMetadata(session.path, snapshot);
                    tui.requestRender();
                  })
                  .catch((error) => {
                    if (closed || request.signal.aborted || previewLoad !== request) return;
                    view.setPreviewError(session.path, error);
                    tui.requestRender();
                  });
              },
            });
            void (services.readBranch ?? readGitBranch)(ctx.cwd, metadataLoad.signal)
              .catch(() => undefined)
              .then((branch) => {
                if (closed) return;
                view.setCurrentBranch(branch);
                loadMetadata();
                tui.requestRender();
              });
            void load(false);
            return {
              get focused() {
                return view.focused;
              },
              set focused(value: boolean) {
                view.focused = value;
              },
              render: (width) => view.render(width),
              invalidate: () => view.invalidate(),
              handleInput: (data) => {
                view.handleInput(data);
                loadMetadata();
                tui.requestRender();
              },
            };
          },
          {
            // A modal overlay owns preview navigation in both native modes;
            // fullscreen document paging otherwise runs before editor input.
            overlay: true,
            overlayOptions: { width: "100%", maxHeight: "100%", anchor: "bottom-left", margin: 0 },
          },
        );
      } finally {
        closed = true;
        previewLoad?.abort();
        renameLoad?.abort();
        metadataLoad.abort();
        hooks.onClose();
      }
      if (!path || path === currentPath) return;
      // Close the custom view before replacing the session. No captured session
      // objects are accessed after a successful switch tears down this runtime.
      let replacementContext: ExtensionCommandContext | undefined;
      try {
        const result = await ctx.switchSession(path, {
          withSession: async (replacement) => {
            replacementContext = replacement;
            hooks.onResume?.(replacement);
          },
        });
        if (result.cancelled) ctx.ui.notify("Session switch cancelled", "info");
      } catch (error) {
        (replacementContext ?? ctx).ui.notify(`Session switch failed: ${String(error)}`, "error");
      }
    },
  });
}
