import { readFile } from "node:fs/promises";
import {
  buildContextEntries,
  buildSessionContext,
  CURRENT_SESSION_VERSION,
  migrateSessionEntries,
  parseSessionEntries,
  type SessionEntry,
  type SessionInfo,
  sessionEntryToContextMessages,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { renderStartupHeader } from "../shell/open-tui/header.ts";
import { messageText } from "./message-view.ts";
import { TranscriptContent } from "./transcript-view.ts";

export interface SessionPreviewSnapshot {
  entries: SessionEntry[];
  cwd: string;
  model: string;
  effort: string;
}

/** Parse and project with Pi's public helpers; migrations affect this memory copy only. */
export function parseSessionPreview(content: string, session: SessionInfo): SessionPreviewSnapshot {
  const records = parseSessionEntries(content);
  if (
    records.some(
      (record) => !record || typeof record !== "object" || typeof record.type !== "string",
    )
  )
    throw new Error("Invalid session records");
  const header = records.find((record) => record.type === "session");
  if (!header || header.id !== session.id)
    throw new Error("Session header does not match the selected session");
  if ((header.version ?? 1) > CURRENT_SESSION_VERSION)
    throw new Error("Session format requires a newer Pi version");
  migrateSessionEntries(records);
  const entries = records
    .filter((record): record is SessionEntry => record.type !== "session")
    .map((entry) =>
      entry.type === "message"
        ? { ...entry, message: sessionEntryToContextMessages(entry)[0] }
        : entry,
    );
  const seen = new Set<string>();
  for (const entry of entries) {
    // Pi files are append-only trees. Reject cycles/invalid imports before the
    // public context helper traverses them; never repair the source file.
    if (
      typeof entry.id !== "string" ||
      seen.has(entry.id) ||
      (entry.parentId !== null && !seen.has(entry.parentId))
    )
      throw new Error("Invalid session entry ancestry");
    seen.add(entry.id);
  }
  const context = buildSessionContext(entries);
  return {
    entries: buildContextEntries(entries),
    cwd: typeof header.cwd === "string" && header.cwd ? header.cwd : session.cwd,
    model:
      context.model &&
      typeof context.model.provider === "string" &&
      typeof context.model.modelId === "string"
        ? `${context.model.provider}/${context.model.modelId}`
        : "No model recorded",
    effort: typeof context.thinkingLevel === "string" ? context.thinkingLevel : "off",
  };
}

export async function loadSessionPreview(
  session: SessionInfo,
  signal?: AbortSignal,
): Promise<SessionPreviewSnapshot> {
  const content = await readFile(session.path, { encoding: "utf8", signal });
  return parseSessionPreview(content, session);
}

/** Render a saved snapshot with no access to the live session or executors. */
export class SessionPreviewContent implements Component {
  private readonly transcript: TranscriptContent;
  private readonly snapshot: SessionPreviewSnapshot;
  private readonly theme: Theme;
  constructor(snapshot: SessionPreviewSnapshot, theme: Theme, tui: TUI, ascii = false) {
    this.snapshot = snapshot;
    this.theme = theme;
    this.transcript = new TranscriptContent(snapshot.entries, theme, tui, snapshot.cwd, ascii, {
      groupTools: false,
      showMessageMetadata: true,
    });
  }

  render(width: number): string[] {
    const header = renderStartupHeader(
      messageText(this.snapshot.model),
      messageText(this.snapshot.effort),
      messageText(this.snapshot.cwd),
      this.theme,
      width,
    );
    // The preview frame supplies the leading separator and surrounding inset.
    return [...header.slice(1), ...this.transcript.render(width)];
  }

  setExpanded(expanded: boolean): void {
    this.transcript.setExpanded(expanded);
  }

  invalidate(): void {
    this.transcript.invalidate();
  }
}
