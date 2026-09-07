import { resolve } from "node:path";
import type { SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

interface ToolRow {
  id: string;
  name: "read" | "bash";
  target: string;
  identity: string;
  ready: boolean;
  image: boolean;
}

export interface ToolGroup {
  leader: string;
  members: readonly string[];
  summary: string;
  targets: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function displayTarget(value: string): string {
  return stripTerminalSequences(value).replace(/\s+/g, " ").trim();
}

/** Read-only transcript metadata. It neither changes messages nor schedules tools. */
export class ToolGroupRuntime {
  private cwd = process.cwd();
  private rows: (ToolRow | undefined)[] = [];
  private byId = new Map<string, ToolRow>();
  private groups = new Map<string, ToolGroup>();
  private dirty = false;

  reset(cwd: string): void {
    this.cwd = cwd;
    this.rows = [];
    this.byId.clear();
    this.groups.clear();
    this.dirty = false;
  }

  private boundary(): void {
    if (this.rows.at(-1)) this.rows.push(undefined);
  }

  recordEntry(entry: SessionEntry): void {
    if (entry.type === "message") this.recordMessage(entry.message);
    else if (["custom_message", "branch_summary", "compaction"].includes(entry.type))
      this.boundary();
  }

  recordMessage(value: unknown): readonly string[] {
    const message = object(value);
    if (!message) return [];
    if (message.role === "toolResult" && typeof message.toolCallId === "string")
      return this.complete(message.toolCallId, message, message.isError !== false);
    if (message.role !== "assistant") {
      this.boundary();
      return [];
    }
    if (!Array.isArray(message.content)) return [];
    for (const value of message.content) {
      const part = object(value);
      if (!part) continue;
      if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
        this.boundary();
      } else if (part.type === "toolCall") {
        if (typeof part.id !== "string" || this.byId.has(part.id)) continue;
        const args = object(part.arguments);
        const target = part.name === "read" ? args?.path : args?.command;
        if ((part.name !== "read" && part.name !== "bash") || typeof target !== "string") {
          this.boundary();
          continue;
        }
        const row: ToolRow = {
          id: part.id,
          name: part.name,
          target: displayTarget(target),
          identity: part.name === "read" ? resolve(this.cwd, target) : target,
          ready: false,
          image: false,
        };
        this.rows.push(row);
        this.byId.set(row.id, row);
        this.dirty = true;
      }
    }
    return [];
  }

  complete(id: string, value: unknown, isError: boolean): readonly string[] {
    const row = this.byId.get(id);
    if (!row) return [];
    const result = object(value);
    const details = object(result?.details);
    const truncated = object(details?.truncation)?.truncated === true;
    const images =
      Array.isArray(result?.content) &&
      result.content.some((part) => object(part)?.type === "image");
    const ready = !!result && !isError && !truncated && (!images || row.name === "read");
    const image = images && row.name === "read";
    if (row.ready === ready && row.image === image) return [];
    const before = this.get(id)?.members ?? [id];
    row.ready = ready;
    row.image = image;
    this.dirty = true;
    const after = this.get(id)?.members ?? [id];
    return [...new Set([...before, ...after])];
  }

  get(id: string): ToolGroup | undefined {
    if (this.dirty) this.rebuild();
    return this.groups.get(id);
  }

  private rebuild(): void {
    this.groups.clear();
    this.dirty = false;
    let run: ToolRow[] = [];
    const finish = () => {
      if (run.length >= 2 || run[0]?.image) {
        const files = new Set(run.filter((row) => row.name === "read").map((row) => row.identity));
        const commands = run.filter((row) => row.name === "bash").length;
        const counts: string[] = [];
        if (files.size) counts.push(`Read ${files.size} file${files.size === 1 ? "" : "s"}`);
        if (commands)
          counts.push(
            `${files.size ? "ran" : "Ran"} ${commands} shell command${commands === 1 ? "" : "s"}`,
          );
        const targets = new Map<string, string>();
        for (const row of run) {
          const key = `${row.name}:${row.identity}`;
          if (!targets.has(key)) targets.set(key, row.target);
        }
        const group: ToolGroup = {
          leader: run[0].id,
          members: run.map((row) => row.id),
          summary: counts.join(", "),
          targets: [...targets.values()].join("; "),
        };
        for (const row of run) this.groups.set(row.id, group);
      }
      run = [];
    };
    for (const row of this.rows) {
      if (row?.ready) run.push(row);
      else finish();
    }
    finish();
  }
}

export class GroupedToolView implements Component {
  private readonly id: string;
  private readonly fallback: Component;
  private readonly runtime: ToolGroupRuntime;
  private readonly expanded: boolean;
  private readonly theme: Theme;

  constructor(
    id: string,
    fallback: Component,
    runtime: ToolGroupRuntime,
    expanded: boolean,
    theme: Theme,
  ) {
    this.id = id;
    this.fallback = fallback;
    this.runtime = runtime;
    this.expanded = expanded;
    this.theme = theme;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const group = this.expanded ? undefined : this.runtime.get(this.id);
    if (!group) return this.fallback.render(width);
    if (group.leader !== this.id) return [];
    const status = this.theme.fg("success", "[OK]");
    const summary = this.theme.fg("dim", `  ${group.summary}`);
    const remaining = width - visibleWidth(summary) - visibleWidth(status) - 4;
    if (remaining > 0) {
      const target = this.theme.fg("dim", truncateToWidth(group.targets, remaining));
      return [`${summary} (${target}) ${status}`];
    }
    return [truncateToWidth(`${status} ${summary.trim()} (${group.targets})`, width, "")];
  }

  invalidate(): void {
    this.fallback.invalidate();
  }
}
