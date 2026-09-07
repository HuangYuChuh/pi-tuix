import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  initTheme,
  type SessionInfo,
  SessionManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { collectImages } from "../extensions/session/image-attachments.ts";
import {
  IMAGE_NUMBERS_ENTRY_TYPE,
  imageContentFingerprint,
} from "../extensions/session/image-number-metadata.ts";
import { ReferenceAssistantText } from "../extensions/session/message-view.ts";
import {
  loadSessionMetadata,
  loadSessionPreview,
  parseSessionPreview,
  SessionPreviewContent,
} from "../extensions/session/session-preview.ts";
import { COMPLETION_ENTRY_TYPE } from "../extensions/stream/completion-entry.ts";
import { complexMarkdown } from "./fixtures/markdown-layout.ts";

initTheme("dark", false);
const theme = {
  fg: (_color: string, text: string) => `\x1b[37m${text}\x1b[39m`,
  bg: (_color: string, text: string) => `\x1b[48;5;236m${text}\x1b[49m`,
  bold: (text: string) => text,
} as Theme;
const assistant = (
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage => ({
  role: "assistant",
  content,
  stopReason,
  timestamp: 1700000000000,
  api: "anthropic-messages",
  provider: "fixture",
  model: "recorded-model",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});
function fixture() {
  const manager = SessionManager.inMemory("/snapshot-project");
  manager.appendThinkingLevelChange("high");
  manager.appendMessage({
    role: "user",
    timestamp: 0,
    content: [
      { type: "text", text: "Inspect the recorded conversation 中文" },
      { type: "image", mimeType: "image/png", data: "not-decoded" },
    ],
  });
  for (const id of ["read-one", "read-two"]) {
    manager.appendMessage(
      assistant(
        [
          {
            type: "toolCall",
            id,
            name: "read",
            arguments: { path: "/must-never-be-read/sample.ts" },
          },
        ],
        "toolUse",
      ),
    );
    manager.appendMessage({
      role: "toolResult",
      toolCallId: id,
      toolName: "read",
      content: [{ type: "text", text: "const one = 1;\nconst two = 2;" }],
      isError: false,
      timestamp: 0,
    });
  }
  manager.appendMessage(
    assistant(
      [
        {
          type: "toolCall",
          id: "edit",
          name: "edit",
          arguments: { path: "sample.ts", edits: [{ oldText: "one = 1", newText: "one = 3" }] },
        },
      ],
      "toolUse",
    ),
  );
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "edit",
    toolName: "edit",
    content: [{ type: "text", text: "Applied" }],
    details: { diff: "-1 const one = 1;\n+1 const one = 3;", firstChangedLine: 1 },
    isError: false,
    timestamp: 0,
  });
  manager.appendMessage(
    assistant([{ type: "text", text: "# Recorded response\n\nThe edit is complete." }]),
  );
  manager.appendCustomEntry(COMPLETION_ENTRY_TYPE, {
    version: 1,
    durationMs: 2300,
    finishedAt: 1700000000000,
    outcome: "done",
    failedTools: 0,
  });
  const session: SessionInfo = {
    path: "/not-opened.jsonl",
    id: manager.getSessionId(),
    cwd: manager.getCwd(),
    created: new Date(0),
    modified: new Date(0),
    firstMessage: "Inspect",
    allMessagesText: "Inspect",
    messageCount: 9,
  };
  const json = () =>
    [manager.getHeader(), ...manager.getEntries()]
      .map((record) => JSON.stringify(record))
      .join("\n");
  return { manager, session, json };
}

test("saved preview keeps exact image numbers across a compaction boundary without rewriting records", () => {
  const f = fixture();
  const message = {
    role: "user" as const,
    timestamp: 456,
    content: [
      { type: "text" as const, text: "Literal [Image #300] [Image #301]" },
      { type: "image" as const, mimeType: "image/png", data: "not-decoded" },
    ],
  };
  f.manager.appendCustomEntry(IMAGE_NUMBERS_ENTRY_TYPE, {
    version: 1,
    timestamp: 456,
    fingerprint: imageContentFingerprint(message.content),
    numbers: [301],
  });
  const kept = f.manager.appendMessage(message);
  f.manager.appendCompaction("recorded summary", kept, 1000);
  const before = f.json();
  const snapshot = parseSessionPreview(before, f.session);
  assert.deepEqual(
    collectImages(snapshot.entries).map((image) => image.number),
    [301],
  );
  const view = new SessionPreviewContent(snapshot, theme, { requestRender() {} } as TUI);
  for (const width of [12, 24, 80, 100]) {
    const lines = view.render(width);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
    assert.doesNotMatch(
      lines.map(stripTerminalSequences).join("\n"),
      /pi-tuix-image-numbers|fingerprint/,
    );
  }
  assert.match(view.render(80).map(stripTerminalSequences).join("\n"), /⎿.*\[Image #301\]/);
  assert.equal(f.json(), before);
});

test("saved preview renders recorded tools separately, diffs, metadata, media labels and completion without executing", () => {
  const f = fixture();
  const snapshot = parseSessionPreview(f.json(), f.session);
  const content = new SessionPreviewContent(snapshot, theme, { requestRender() {} } as TUI);
  const render = (width = 100) => content.render(width).map(stripTerminalSequences).join("\n");
  const output = render();
  assert.match(output, /Pi-TUIX.*Pi v/);
  assert.match(output, /fixture\/recorded-model with high effort/);
  assert.match(output, /\/snapshot-project/);
  assert.equal(output.match(/Read\(/g)?.length, 2);
  assert.doesNotMatch(output, /Read 1 file|not-decoded/);
  assert.match(output, /\[Image #1\] \(unavailable\)/);
  assert.match(output, /Update\(sample.ts\)[\s\S]*one = 3/);
  assert.match(output, /\d+:\d{2} [AP]M recorded-model\n⏺.*Recorded response/);
  assert.match(output, /Worked for 2s/);
  assert.equal(snapshot.byteSize, Buffer.byteLength(f.json(), "utf8"));
  assert.equal(snapshot.gitBranch, undefined, "old sessions have no inferred checkout branch");
  assert.doesNotMatch(output, /ENOENT|must-never-be-read.*ERROR/);
  content.setExpanded(true);
  assert.match(render(), /const two = 2/);
  for (const width of [0, 1, 2, 4, 12, 40, 80, 100])
    assert.ok(content.render(width).every((line) => visibleWidth(line) <= width));
  content.invalidate();
  assert.match(render(), /Recorded response/);
});

test("saved preview shares the reference Markdown presentation at measured widths", () => {
  const manager = SessionManager.inMemory("/snapshot-project");
  manager.appendMessage(assistant([{ type: "text", text: complexMarkdown }]));
  const snapshot = {
    entries: manager.buildContextEntries(),
    cwd: manager.getCwd(),
    model: "fixture/model",
    effort: "off",
  };
  const preview = new SessionPreviewContent(snapshot, theme, {} as TUI);
  const expected = new ReferenceAssistantText(complexMarkdown, theme);
  for (const width of [24, 40, 80, 100]) {
    const lines = preview.render(width);
    const output = lines.map(stripTerminalSequences).join("\n");
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
    assert.doesNotMatch(output, /```/);
    assert.match(output, /const greeting/);
    const rows = output.split("\n");
    const top = rows.findIndex((line) => line.includes("┌"));
    const divider = rows.findIndex((line, index) => index > top && line.includes("├"));
    assert.ok(top >= 0 && divider > top);
    assert.deepEqual(
      [1, 2, 3].map((column) =>
        rows
          .slice(top + 1, divider)
          .map((line) => line.split("│")[column]?.trim() ?? "")
          .join(""),
      ),
      ["Item", "Description", "Result"],
    );
    assert.match(output, /│.*quoted paragraph/);
    for (const marker of ["Layout check", "FINAL_MARKER"])
      assert.equal(
        output.includes(marker),
        expected.render(width).map(stripTerminalSequences).join("\n").includes(marker),
      );
  }
});

test("preview uses Pi's selected-branch and compaction projection", () => {
  const f = fixture();
  const selected = f.manager.getLeafId();
  assert.ok(selected);
  f.manager.appendMessage(assistant([{ type: "text", text: "Abandoned branch" }]));
  f.manager.branch(selected);
  const kept = f.manager.appendMessage({
    role: "user",
    content: "Current branch request",
    timestamp: 0,
  });
  f.manager.appendCompaction("Earlier conversation summarized", kept, 10000);
  f.manager.appendMessage(assistant([{ type: "text", text: "Current branch response" }]));
  const snapshot = parseSessionPreview(f.json(), f.session);
  assert.deepEqual(snapshot.entries, JSON.parse(JSON.stringify(f.manager.buildContextEntries())));
  const output = new SessionPreviewContent(snapshot, theme, {} as TUI)
    .render(100)
    .map(stripTerminalSequences)
    .join("\n");
  assert.match(
    output,
    /Earlier conversation summarized[\s\S]*Current branch request[\s\S]*Current branch response/,
  );
  assert.doesNotMatch(output, /Abandoned branch|Inspect the recorded/);
});

test("preview reads and migrates legacy data only in memory; cancellation and errors leave files untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-tuix-preview-"));
  try {
    const f = fixture();
    f.session.path = join(directory, "legacy.jsonl");
    const legacy = [
      { ...f.manager.getHeader(), version: 1 },
      {
        type: "message",
        timestamp: new Date(0).toISOString(),
        message: assistant([{ type: "text", text: "Legacy record" }]),
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");
    await writeFile(f.session.path, legacy);
    const before = await stat(f.session.path);
    const snapshot = await loadSessionPreview(f.session);
    assert.equal(snapshot.entries.length, 1);
    assert.ok(snapshot.entries[0].id);
    assert.equal(await readFile(f.session.path, "utf8"), legacy);
    assert.equal((await stat(f.session.path)).mtimeMs, before.mtimeMs);
    assert.deepEqual(await loadSessionMetadata(f.session, new AbortController().signal), {
      byteSize: Buffer.byteLength(legacy),
      gitBranch: undefined,
    });
    assert.deepEqual(await readdir(directory), ["legacy.jsonl"]);
    const cancel = new AbortController();
    cancel.abort();
    await assert.rejects(loadSessionPreview(f.session, cancel.signal), { name: "AbortError" });
    await assert.rejects(
      loadSessionPreview({ ...f.session, path: join(directory, "missing.jsonl") }),
      /ENOENT/,
    );
    assert.equal(await readFile(f.session.path, "utf8"), legacy);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recorded Git metadata follows public parent links, survives compaction and never reads today's checkout", () => {
  const f = fixture();
  const completion = (gitBranch?: string) =>
    f.manager.appendCustomEntry(COMPLETION_ENTRY_TYPE, {
      version: 1,
      durationMs: 10,
      finishedAt: 10,
      outcome: "done",
      failedTools: 0,
      ...(gitBranch ? { gitBranch } : {}),
    });
  const selected = completion("feat/recorded");
  completion("abandoned-git-branch");
  f.manager.branch(selected);
  const kept = f.manager.appendMessage({ role: "user", content: "Kept message", timestamp: 0 });
  f.manager.appendCompaction("Summary", kept, 10000);
  assert.equal(parseSessionPreview(f.json(), f.session).gitBranch, "feat/recorded");
  completion();
  assert.equal(
    parseSessionPreview(f.json(), f.session).gitBranch,
    undefined,
    "an unavailable later observation does not reuse an older branch",
  );
});

test("preview rejects invalid identity, future formats and cyclic ancestry before traversal", () => {
  const f = fixture();
  const header = f.manager.getHeader();
  assert.ok(header);
  const parse = (records: unknown[]) =>
    parseSessionPreview(records.map((record) => JSON.stringify(record)).join("\n"), f.session);
  assert.throws(() => parse([]), /header/);
  assert.throws(() => parse([{ ...header, id: "different" }]), /header/);
  assert.throws(() => parse([{ ...header, version: 999 }]), /newer Pi/);
  assert.throws(() => parse([header, null]), /Invalid session records/);
  assert.throws(
    () => parse([header, { type: "custom", id: "loop", parentId: "loop" }]),
    /ancestry/,
  );
  assert.throws(
    () =>
      parse([
        header,
        { type: "custom", id: "duplicate", parentId: null },
        { type: "custom", id: "duplicate", parentId: null },
      ]),
    /ancestry/,
  );
  const nullContent = parse([
    header,
    {
      type: "message",
      id: "old",
      parentId: null,
      timestamp: new Date(0).toISOString(),
      message: { ...assistant([]), content: null },
    },
  ]);
  const entry = nullContent.entries[0];
  assert.ok(entry.type === "message" && entry.message.role === "assistant");
  assert.deepEqual(entry.message.content, []);
});
