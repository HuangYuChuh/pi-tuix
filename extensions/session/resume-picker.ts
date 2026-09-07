import { basename } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionInfo,
  SessionManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
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

/** A read-only view of public SessionInfo records. Loading and switching live in the command. */
export class ResumePicker {
  focused = true;
  private readonly search = new Input();
  private readonly options: {
    theme: Theme;
    ascii: boolean;
    cwd: string;
    currentPath?: string;
    getRows: () => number;
    now?: () => number;
    done: (path: string | undefined) => void;
    onScopeChange: (all: boolean) => void;
  };
  private sessions: readonly SessionInfo[] = [];
  private filtered: readonly SessionInfo[] = [];
  private selected = 0;
  private searching = false;
  private preview = false;
  private previewOffset = 0;
  private all = false;
  private loading = true;
  private error: string | undefined;
  private finished = false;
  private pageSize = 5;
  private previewCache: { path: string; width: number; lines: string[] } | undefined;

  constructor(options: ResumePicker["options"]) {
    this.options = options;
  }

  setSessions(sessions: readonly SessionInfo[]): void {
    if (this.finished) return;
    const selectedPath = this.filtered[this.selected]?.path;
    this.previewCache = undefined;
    const unique = new Map(sessions.map((session) => [session.path, session]));
    this.sessions = [...unique.values()].sort(
      (a, b) => b.modified.getTime() - a.modified.getTime(),
    );
    this.loading = false;
    this.error = undefined;
    this.filter();
    const index = this.filtered.findIndex((session) => session.path === selectedPath);
    if (index >= 0) this.selected = index;
  }

  setError(error: unknown): void {
    if (this.finished) return;
    this.loading = false;
    this.error = `Could not load sessions: ${plain(String(error))}`;
    this.sessions = [];
    this.filter();
  }

  private filter(): void {
    const words = this.search.getValue().toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    this.filtered = words.length
      ? this.sessions.filter((session) => {
          const text =
            `${title(session)} ${session.cwd} ${session.allMessagesText}`.toLocaleLowerCase();
          return words.every((word) => text.includes(word));
        })
      : this.sessions;
    this.selected = Math.min(this.selected, Math.max(0, this.filtered.length - 1));
    this.previewOffset = 0;
  }

  handleInput(data: string): void {
    if (this.finished) return;
    const keys = getKeybindings();
    if (keys.matches(data, "tui.select.cancel")) {
      if (this.preview) this.preview = false;
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
      if (data === " ") this.preview = false;
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
    const inset = width >= 16 ? "   " : "";
    const inner = Math.max(1, width - inset.length * 2);
    const accent = (text: string) => theme.fg("mdLink", text);
    const muted = (text: string) => theme.fg("muted", text);
    const clip = (line: string) => truncateToWidth(line, width, "");
    const separator = ascii ? " | " : " · ";
    const metadata = (session: SessionInfo) =>
      [
        age(session.modified, (this.options.now ?? Date.now)()),
        `${session.messageCount} message${session.messageCount === 1 ? "" : "s"}`,
        ...(this.all && session.cwd ? [plain(session.cwd)] : []),
      ].join(separator);
    const heading = compact
      ? [`${inset}${accent(theme.bold(this.preview ? "Session preview" : "Resume session"))}`]
      : [
          accent((ascii ? "-" : "▔").repeat(width)),
          `${inset}${accent(theme.bold(this.preview ? "Session preview" : "Resume session"))}`,
        ];
    const selected = this.filtered[this.selected];
    if (this.preview && selected) {
      const hints = `${inset}${muted(`Up/Down to scroll${separator}Enter to resume${separator}Esc to return`)}`;
      const bodyWidth = Math.max(1, inner - 2);
      if (this.previewCache?.path !== selected.path || this.previewCache.width !== bodyWidth) {
        this.previewCache = {
          path: selected.path,
          width: bodyWidth,
          lines: plain(selected.allMessagesText || selected.firstMessage || "No message text")
            .split("\n")
            .flatMap((line) => wrapTextWithAnsi(line, bodyWidth)),
        };
      }
      const lines = this.previewCache.lines;
      const budget = Math.max(1, rows - heading.length - (compact ? 2 : 4));
      this.pageSize = budget;
      this.previewOffset = Math.min(this.previewOffset, Math.max(0, lines.length - budget));
      const body = lines
        .slice(this.previewOffset, this.previewOffset + budget)
        .map((line) => `${inset}  ${line}`);
      if (rows < 4) return body.slice(0, rows).map(clip);
      return [
        ...heading,
        `${inset}${accent(title(selected))}`,
        ...(!compact ? [""] : []),
        ...body,
        ...(!compact ? [""] : []),
        hints,
      ]
        .slice(0, rows)
        .map(clip);
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
        `${inset}  ${muted(this.all ? "All projects" : plain(basename(this.options.cwd)))}`,
        "",
      );
    } else heading.push(`${inset}/${fitted}`);
    const hint = this.searching
      ? `Type to search${separator}Enter to select${separator}Esc to clear`
      : `Ctrl+A for ${this.all ? "current project" : "all projects"}${separator}Space to preview${separator}Type to search${separator}Enter to resume${separator}Esc to cancel`;
    const hints = compact
      ? [clip(`${inset}${muted(hint)}`)]
      : wrapTextWithAnsi(muted(hint), inner)
          .slice(0, 2)
          .map((line) => inset + line);
    const budget = Math.max(1, rows - heading.length - hints.length - (compact ? 0 : 1));
    const rowHeight = compact ? 1 : 3;
    this.pageSize = Math.max(1, Math.floor(budget / rowHeight));
    const start = Math.max(
      0,
      Math.min(this.selected - Math.floor(this.pageSize / 2), this.filtered.length - this.pageSize),
    );
    const body: string[] = [];
    if (this.loading) body.push(`${inset}  ${muted("Loading sessions...")}`);
    else if (this.error) body.push(`${inset}${theme.fg("error", this.error)}`);
    else if (!this.filtered.length)
      body.push(`${inset}  ${muted(query ? "No matching sessions" : "No saved sessions")}`);
    else
      for (let i = start; i < Math.min(this.filtered.length, start + this.pageSize); i++) {
        const session = this.filtered[i];
        const active = i === this.selected && !this.searching;
        const prefix = active ? `${ascii ? ">" : "❯"} ` : "  ";
        const current = session.path === this.options.currentPath ? " [current]" : "";
        const label = `${truncateToWidth(title(session), Math.max(1, inner - 2 - current.length), "")}${current}`;
        body.push(`${inset}${active ? accent(prefix + label) : prefix + label}`);
        if (!compact) body.push(`${inset}  ${muted(metadata(session))}`, "");
      }
    if (rows < 4) return (this.searching ? [`${inset}/${fitted}`] : body).slice(0, rows).map(clip);
    return [...heading, ...body, ...(!compact ? [""] : []), ...hints].slice(0, rows).map(clip);
  }

  invalidate(): void {
    this.search.invalidate();
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
): void {
  pi.registerCommand("pituix-resume", {
    description: "Search, preview and resume Pi sessions",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      const currentPath = ctx.sessionManager.getSessionFile();
      const sessionDir = ctx.sessionManager.getSessionDir();
      hooks.onOpen();
      let path: string | undefined;
      let closed = false;
      try {
        path = await ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
          let current: SessionInfo[] = [];
          let all: SessionInfo[] | undefined;
          const load = async (allProjects: boolean) => {
            try {
              if (allProjects) {
                all ??= [
                  ...current,
                  ...(await Promise.all([catalog.listAll(), catalog.listAll(sessionDir)])).flat(),
                ];
              } else current = await catalog.list(ctx.cwd, sessionDir);
              if (!closed) view.setSessions(allProjects ? (all ?? []) : current);
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
            getRows: () => tui.terminal.rows,
            done: (selection) => {
              closed = true;
              done(selection);
            },
            onScopeChange: (allProjects) => {
              void load(allProjects);
            },
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
              tui.requestRender();
            },
          };
        });
      } finally {
        closed = true;
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
