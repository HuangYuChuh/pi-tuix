import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  initTheme,
  type SessionEntry,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import {
  ReferenceAssistantText,
  ReferenceUserMessage,
} from "../extensions/session/message-view.ts";
import {
  registerTranscriptCommand,
  TranscriptContent,
  TranscriptView,
} from "../extensions/session/transcript-view.ts";
import { COMPLETION_ENTRY_TYPE } from "../extensions/stream/completion-entry.ts";

initTheme("dark", false);
const theme = {
  fg: (_color: string, value: string) => `\x1b[37m${value}\x1b[39m`,
  bg: (_color: string, value: string) => `\x1b[48;2;55;55;55m${value}\x1b[49m`,
  bold: (value: string) => `\x1b[1m${value}\x1b[22m`,
} as Theme;
const tui = { requestRender() {} } as TUI;
const plain = (component: { render(width: number): string[] }, width = 100) =>
  component.render(width).map(stripTerminalSequences).join("\n");
const base = { timestamp: new Date(0).toISOString(), parentId: null };

test("snapshot history retains completion rows in order and ignores invalid or foreign metadata", () => {
  const history: SessionEntry[] = [
    {
      ...base,
      id: "a",
      type: "message",
      message: { role: "user", content: "First request", timestamp: 0 },
    },
    {
      ...base,
      id: "b",
      type: "custom",
      customType: COMPLETION_ENTRY_TYPE,
      data: {
        version: 1,
        durationMs: 2300,
        finishedAt: 1700000000000,
        outcome: "done",
        failedTools: 0,
      },
    },
    {
      ...base,
      id: "c",
      type: "message",
      message: { role: "user", content: "Second request", timestamp: 0 },
    },
    {
      ...base,
      id: "d",
      type: "custom",
      customType: COMPLETION_ENTRY_TYPE,
      data: {
        version: 1,
        durationMs: 4100,
        finishedAt: 1700000005000,
        outcome: "cancelled",
        failedTools: 0,
      },
    },
    { ...base, id: "e", type: "custom", customType: COMPLETION_ENTRY_TYPE, data: { version: 999 } },
    { ...base, id: "f", type: "custom", customType: "foreign", data: { secret: "never display" } },
  ];
  const original = structuredClone(history);
  const content = new TranscriptContent(history, theme, tui, "/fixture");
  const output = plain(content);
  assert.match(output, /First request[\s\S]*Worked for 2s[\s\S]*Second request[\s\S]*Interrupted/);
  assert.equal(output.match(/Worked for/g)?.length, 1);
  assert.doesNotMatch(output, /never display|999/);
  content.setExpanded(true);
  assert.match(plain(content), /Worked for 2s[\s\S]*Interrupted/);
  for (const width of [1, 4, 12, 40, 80, 100])
    assert.ok(content.render(width).every((line) => visibleWidth(line) <= width));
  assert.deepEqual(history, original);
});
const assistant = (
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage => ({
  role: "assistant",
  content,
  stopReason,
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
function entries(): SessionEntry[] {
  return [
    {
      ...base,
      type: "message",
      id: "user",
      message: { role: "user", content: "Please update the fixture.", timestamp: 0 },
    },
    {
      ...base,
      type: "message",
      id: "assistant",
      message: assistant(
        [
          { type: "text", text: "I will inspect the file." },
          { type: "toolCall", id: "read-1", name: "read", arguments: { path: "sample.ts" } },
        ],
        "toolUse",
      ),
    },
    {
      ...base,
      type: "message",
      id: "read-result",
      message: {
        role: "toolResult",
        toolCallId: "read-1",
        toolName: "read",
        content: [{ type: "text", text: "const sample = 1;" }],
        isError: false,
        timestamp: 0,
      },
    },
    {
      ...base,
      type: "message",
      id: "edit",
      message: assistant(
        [
          {
            type: "toolCall",
            id: "edit-1",
            name: "edit",
            arguments: {
              path: "sample.ts",
              edits: [{ oldText: "sample = 1", newText: "sample = 2" }],
            },
          },
        ],
        "toolUse",
      ),
    },
    {
      ...base,
      type: "message",
      id: "edit-result",
      message: {
        role: "toolResult",
        toolCallId: "edit-1",
        toolName: "edit",
        content: [{ type: "text", text: "Applied" }],
        details: { diff: "-1 const sample = 1;\n+1 const sample = 2;", firstChangedLine: 1 },
        isError: false,
        timestamp: 0,
      },
    },
    {
      ...base,
      type: "message",
      id: "final",
      message: assistant([
        { type: "thinking", thinking: "Private fixture reasoning" },
        { type: "text", text: "# Done\n\n- Updated **sample.ts**\n- Kept the existing API" },
      ]),
    },
  ];
}

test("reference message rows retain raw prompts and render Markdown before adding assistant prefixes", () => {
  const user = new ReferenceUserMessage("# literal heading\n- literal list", theme);
  assert.match(plain(user, 40), /^❯ # literal heading\s*\n {2}- literal list/);
  assert.equal(user.render(40).length, 2);
  assert.ok(user.render(40).every((line) => visibleWidth(line) === 40));
  const response = new ReferenceAssistantText(
    "# Heading\n\n- **bold** text\n\n```ts\nconst x = 1;\n```",
    theme,
  );
  const rendered = plain(response, 50);
  assert.match(rendered, /^⏺ Heading/);
  assert.doesNotMatch(rendered, /# Heading|\*\*bold\*\*/);
  assert.match(rendered, / {2}.*bold text/);
  assert.match(rendered, /const x = 1/);
});

test("reference message bodies bound ANSI and wide glyphs without interpreting terminal controls", () => {
  const source = "中文🙂 é \x1b]0;untrusted\x07\x1b[2J\x1b[31mred\x1b[0m\n\t".repeat(4);
  for (const ascii of [false, true]) {
    for (const component of [
      new ReferenceUserMessage(source, theme, ascii),
      new ReferenceAssistantText(source, theme, ascii),
    ]) {
      for (const width of [0, 1, 2, 3, 4, 8, 16, 40, 80, 100]) {
        const lines = component.render(width);
        assert.ok(
          lines.every((line) => visibleWidth(line) <= width),
          `${width}: ${lines}`,
        );
        assert.ok(
          lines.every(
            (line) =>
              !line.includes("\x1b]0;") && !line.includes("\x1b[2J") && !line.includes("\x1b[31m"),
          ),
        );
        if (ascii) assert.doesNotMatch(lines.join("\n"), /[❯⏺∴]/);
      }
    }
  }
});

test("transcript preserves message/tool order, expands recorded results and never mutates the snapshot source", () => {
  const source = entries();
  const before = structuredClone(source);
  const content = new TranscriptContent(source, theme, tui, process.cwd());
  const output = plain(content);
  assert.ok(output.indexOf("Please update") < output.indexOf("I will inspect"));
  assert.ok(output.indexOf("I will inspect") < output.indexOf("Read(sample.ts)"));
  assert.ok(output.indexOf("Read(sample.ts)") < output.indexOf("Update(sample.ts)"));
  assert.ok(output.indexOf("Update(sample.ts)") < output.indexOf("⏺ Done"));
  assert.match(output, /Read 1 lines/);
  assert.doesNotMatch(output, /const sample = 1;.*\n.*Read/);
  assert.match(output, /Thinking \(expand to view\)/);
  assert.doesNotMatch(output, /Private fixture reasoning/);
  content.setExpanded(true);
  assert.match(plain(content), /const sample = 1;/);
  assert.match(plain(content), /Private fixture reasoning/);
  content.setExpanded(false);
  assert.equal(plain(content), output);
  content.invalidate();
  assert.equal(plain(content), output);
  assert.deepEqual(source, before);
  const message = source[0];
  if (message.type === "message" && message.message.role === "user")
    message.message.content = "Changed after snapshot";
  content.invalidate();
  assert.doesNotMatch(plain(content), /Changed after snapshot/);
});

test("transcript labels errors, cancellation, orphan results, media and public custom/summary messages", () => {
  const source: SessionEntry[] = [
    {
      ...base,
      id: "media",
      type: "message",
      message: {
        role: "user",
        content: [{ type: "image", data: "not-decoded", mimeType: "image/png" }],
        timestamp: 0,
      },
    },
    {
      ...base,
      id: "orphan",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "missing",
        toolName: "mcp_fixture",
        content: [{ type: "text", text: "Tool failed" }],
        isError: true,
        timestamp: 0,
      },
    },
    {
      ...base,
      id: "error",
      type: "message",
      message: { ...assistant([], "error"), errorMessage: "Provider unavailable" },
    },
    { ...base, id: "aborted", type: "message", message: assistant([], "aborted") },
    { ...base, id: "length", type: "message", message: assistant([], "length") },
    {
      ...base,
      id: "hidden",
      type: "custom_message",
      customType: "private",
      content: "Hidden custom message",
      display: false,
    },
    {
      ...base,
      id: "shown",
      type: "custom_message",
      customType: "notice",
      content: "Visible custom message",
      display: true,
    },
    {
      ...base,
      id: "summary",
      type: "compaction",
      summary: "Saved compaction",
      firstKeptEntryId: "media",
      tokensBefore: 100,
    },
    {
      ...base,
      id: "bash",
      type: "message",
      message: {
        role: "bashExecution",
        command: "fixture",
        output: "Cancelled output",
        exitCode: undefined,
        cancelled: true,
        truncated: true,
        timestamp: 0,
      },
    },
  ];
  const output = plain(new TranscriptContent(source, theme, tui, process.cwd()));
  for (const expected of [
    "[image: image/png]",
    "mcp_fixture result [ERROR] (call unavailable)",
    "Tool failed",
    "Error: Provider unavailable",
    "Interrupted",
    "truncated before completion",
    "Visible custom message",
    "Saved compaction",
    "[CANCELLED]",
    "Output truncated",
  ])
    assert.ok(output.includes(expected), expected);
  assert.doesNotMatch(output, /not-decoded|Hidden custom message/);
});

test("transcript viewport keeps navigation bounded, expands once per binding and returns without editing sessions", () => {
  const source = entries();
  let closed = 0;
  const content = new TranscriptContent(source, theme, tui, process.cwd());
  const view = new TranscriptView(
    content,
    theme,
    () => 12,
    () => closed++,
    (data) => data === "\x0f",
  );
  assert.match(plain(view), /Kept the existing API/);
  view.handleInput("\x1b[H");
  assert.match(plain(view), /Please update/);
  view.handleInput("\x1b[6~");
  assert.doesNotMatch(plain(view), /Please update/);
  view.handleInput("\x0f");
  view.handleInput("\x1b[F");
  assert.match(plain(view), /Private fixture reasoning/);
  view.handleInput("\x1b");
  view.handleInput("\x1b");
  assert.equal(closed, 1);
});

test("transcript content and viewport fit tiny, narrow and short terminals after expansion and invalidation", () => {
  for (const rows of [1, 2, 3, 4, 8, 24, 40]) {
    const content = new TranscriptContent(entries(), theme, tui, process.cwd(), true);
    const view = new TranscriptView(
      content,
      theme,
      () => rows,
      () => {},
      (data) => data === "\x0f",
    );
    for (const input of ["", "\x1b[H", "\x0f", "\x1b[F"]) {
      if (input) view.handleInput(input);
      for (const width of [0, 1, 2, 3, 4, 16, 24, 40, 80, 100]) {
        view.invalidate();
        const lines = view.render(width);
        assert.ok(lines.length <= rows);
        assert.ok(
          lines.every((line) => visibleWidth(line) <= width),
          `${rows}x${width}`,
        );
      }
    }
  }
});

test("transcript command uses only a read-only branch and public custom UI, with no registered executors", async () => {
  let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  registerTranscriptCommand({
    registerCommand(name, command) {
      assert.equal(name, "pituix-transcript");
      handler = command.handler;
    },
  } as ExtensionAPI);
  let branchReads = 0;
  let closes = 0;
  const ctx = {
    hasUI: true,
    cwd: process.cwd(),
    sessionManager: {
      getBranch() {
        branchReads++;
        return entries();
      },
    },
    ui: {
      async custom(
        factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0],
        options: unknown,
      ) {
        assert.deepEqual(options, {
          overlay: true,
          overlayOptions: { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0 },
        });
        const component = await factory(
          { ...tui, terminal: { rows: 40 } } as TUI,
          theme,
          { matches: () => false } as never,
          () => closes++,
        );
        assert.match(plain(component), /Please update/);
        component.handleInput?.("\x1b");
      },
    },
  } as unknown as ExtensionCommandContext;
  await handler("", ctx);
  assert.equal(branchReads, 1);
  assert.equal(closes, 1);
  await handler("", { ...ctx, hasUI: false });
  assert.equal(branchReads, 1);
});

test("reference prompt markers use measured truecolor, indexed fallback and the host no-color theme", () => {
  const savedNoColor = process.env.NO_COLOR;
  const savedForceColor = process.env.FORCE_COLOR;
  try {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    const reference = { ...theme, name: "pi-tuix-dark", getColorMode: () => "truecolor" } as Theme;
    assert.ok(
      new ReferenceUserMessage("one\ntwo", reference)
        .render(20)[0]
        .includes("\x1b[38;2;80;80;80m❯ "),
    );
    assert.ok(!new ReferenceUserMessage("one\ntwo", reference).render(20)[1].includes("80;80;80"));
    const indexed = { ...reference, getColorMode: () => "256color" } as Theme;
    assert.ok(new ReferenceUserMessage("one", indexed).render(20)[0].includes("\x1b[38;5;239m"));
    process.env.NO_COLOR = "1";
    assert.ok(!new ReferenceUserMessage("one", reference).render(20)[0].includes("80;80;80"));
    process.env.FORCE_COLOR = "1";
    assert.ok(new ReferenceUserMessage("one", reference).render(20)[0].includes("80;80;80"));
  } finally {
    if (savedNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = savedNoColor;
    if (savedForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = savedForceColor;
  }
});
