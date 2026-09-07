import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { renameSession } from "../extensions/session/rename-session.ts";

async function fixture(dir: string) {
  const manager = SessionManager.create(dir, dir);
  manager.appendMessage({ role: "user", content: "Original request", timestamp: 0 });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Original response" }],
    stopReason: "stop",
    timestamp: 0,
    api: "anthropic-messages",
    provider: "fixture",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  manager.appendSessionInfo("Original name");
  const [session] = await SessionManager.list(dir, dir);
  return { manager, session };
}

test("confirmed saved-session rename uses Pi's metadata entry and preserves original bytes and model context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pituix-rename-"));
  try {
    const { session, manager } = await fixture(dir);
    const before = await readFile(session.path, "utf8");
    const context = manager.buildSessionContext();
    await renameSession(session, "  Renamed\n中文  ", new AbortController().signal);
    const after = await readFile(session.path, "utf8");
    assert.ok(after.startsWith(before), "existing records retain their exact bytes");
    const added = after
      .slice(before.length)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(added.length, 1);
    assert.equal(added[0].type, "session_info");
    assert.equal(added[0].name, "Renamed 中文");
    const reopened = SessionManager.open(session.path);
    assert.equal(reopened.getSessionId(), session.id);
    assert.equal(reopened.getSessionName(), "Renamed 中文");
    assert.deepEqual(reopened.buildSessionContext(), context);
    assert.deepEqual(
      (await SessionManager.list(dir, dir)).map((item) => item.name),
      ["Renamed 中文"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cancelled, blank, missing, replaced and future-format rename requests never create or rewrite files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pituix-rename-reject-"));
  try {
    const { session } = await fixture(dir);
    const before = await readFile(session.path, "utf8");
    const time = (await stat(session.path)).mtimeMs;
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(renameSession(session, "Changed", cancelled.signal), /abort/i);
    await assert.rejects(
      renameSession(session, " \n ", new AbortController().signal),
      /Enter a session name/,
    );
    await assert.rejects(
      renameSession({ ...session, id: "wrong-id" }, "Changed", new AbortController().signal),
      /header/,
    );
    const missing = join(dir, "missing.jsonl");
    await assert.rejects(
      renameSession({ ...session, path: missing }, "Changed", new AbortController().signal),
      /ENOENT/,
    );
    assert.equal((await readdir(dir)).length, 1);
    assert.equal(await readFile(session.path, "utf8"), before);
    assert.equal((await stat(session.path)).mtimeMs, time);
    const records = before
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    records[0].version = 999;
    const future = records.map((record) => JSON.stringify(record)).join("\n");
    await writeFile(session.path, future);
    await assert.rejects(
      renameSession(session, "Changed", new AbortController().signal),
      /newer Pi/,
    );
    assert.equal(await readFile(session.path, "utf8"), future);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("active-session rename uses the live setter and rejects stale identity without opening a file", async () => {
  const names: string[] = [];
  const session = { id: "active-id", path: "/must-not-be-opened.jsonl" } as SessionInfo;
  const active = {
    id: session.id,
    path: session.path,
    setName: (name: string) => names.push(name),
  };
  await renameSession(session, " New name ", new AbortController().signal, active);
  assert.deepEqual(names, ["New name"]);
  await assert.rejects(
    renameSession(session, "Other", new AbortController().signal, { ...active, id: "replacement" }),
    /active session has changed/,
  );
  assert.deepEqual(names, ["New name"]);
});

test("confirmed legacy rename delegates format migration to Pi and preserves the conversation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pituix-rename-legacy-"));
  try {
    const { session, manager } = await fixture(dir);
    const context = manager.buildSessionContext();
    const records = (await readFile(session.path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    records[0].version = 2;
    await writeFile(
      session.path,
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
    await renameSession(session, "Legacy renamed", new AbortController().signal);
    const reopened = SessionManager.open(session.path);
    assert.equal(reopened.getSessionId(), session.id);
    assert.equal(reopened.getSessionName(), "Legacy renamed");
    assert.deepEqual(reopened.buildSessionContext(), context);
    assert.equal(reopened.getHeader()?.version, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
