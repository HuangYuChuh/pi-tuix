import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { loadSessionPreview } from "./session-preview.ts";

export interface ActiveSessionName {
  path: string | undefined;
  id: string;
  setName: (name: string) => void;
}

/** Rename only after confirmation; Pi owns the entry and any legacy migration. */
export async function renameSession(
  session: SessionInfo,
  name: string,
  signal: AbortSignal,
  active?: ActiveSessionName,
): Promise<void> {
  const next = name.replace(/[\r\n]/g, " ").trim();
  if (!next) throw new Error("Enter a session name");
  signal.throwIfAborted();
  if (session.path === active?.path) {
    if (session.id !== active.id) throw new Error("The active session has changed");
    active.setName(next);
    return;
  }
  // Validate identity/format without rewriting first. In particular, open()
  // alone would initialize a missing file as a new session.
  await loadSessionPreview(session, signal);
  signal.throwIfAborted();
  const manager = SessionManager.open(session.path);
  if (manager.getSessionId() !== session.id)
    throw new Error("Session header does not match the selected session");
  manager.appendSessionInfo(next);
}
