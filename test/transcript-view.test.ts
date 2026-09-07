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
import {
  getOsc8LinkAtColumn,
  stripTerminalSequences,
  type Terminal,
  Text,
  type TUI,
  TuiAltScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  ReferenceAssistantText,
  ReferenceUserMessage,
  renderAssistantLines,
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

test("narrow assistant snapshots preserve complete text instead of clipping each row", () => {
  const source = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const response = new ReferenceAssistantText(source, theme);
  for (const width of [1, 2, 3, 4, 5, 6, 8, 24, 80, 4, 80]) {
    assert.equal(plain(response, width).replace(/[^A-Z]/g, ""), source, `width ${width}`);
    assert.ok(response.render(width).every((line) => visibleWidth(line) <= width));
  }
});

test("narrow Markdown retains wide graphemes, code content and wrapped table cells", () => {
  const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ中文🙂e\u0301TAIL";
  for (const source of [text, `**${text}**`, `\`${text}\``, `\`\`\`\n${text}\n\`\`\``]) {
    const response = new ReferenceAssistantText(source, theme);
    for (const width of [2, 3, 4, 5, 8, 24, 40, 80]) {
      assert.equal(plain(response, width).replace(/[\s⏺`]/gu, ""), text, `width ${width}`);
    }
  }
  const table = new ReferenceAssistantText(
    "| Key | Text | State |\n| --- | --- | --- |\n| Alpha | 中文🙂_abcdefghijklmnopqrstuvwxyz_END | READY |\n| Beta | English words wrap | DONE |",
    theme,
  );
  for (const width of [24, 40, 80, 100]) {
    const rows = plain(table, width)
      .split("\n")
      .filter((line) => line.includes("│"));
    const columns = [1, 2, 3].map((column) =>
      rows
        .map((line) => line.split("│")[column].trim())
        .join("")
        .replace(/\s/gu, ""),
    );
    assert.deepEqual(columns, [
      "KeyAlphaBeta",
      "Text中文🙂_abcdefghijklmnopqrstuvwxyz_ENDEnglishwordswrap",
      "StateREADYDONE",
    ]);
  }
});

test("assistant reflow preserves ANSI styling and hyperlink targets on continuation rows", () => {
  const url = "https://example.com/layout";
  const source = `\x1b[31m\x1b]8;;${url}\x07ABCDEFGHIJ\x1b]8;;\x07\x1b[39m`;
  for (const width of [1, 2, 3, 4, 5, 8]) {
    const lines = renderAssistantLines([source], width, theme, true, true);
    assert.equal(lines.map(stripTerminalSequences).join("").replace(/[\s~]/g, ""), "ABCDEFGHIJ");
    for (const line of lines) {
      const plainLine = stripTerminalSequences(line);
      assert.ok(visibleWidth(line) <= width);
      const firstLetter = plainLine.search(/[A-Z]/);
      assert.ok(firstLetter >= 0);
      assert.ok(line.includes("\x1b[31m"));
      assert.equal(getOsc8LinkAtColumn(line, firstLetter), url);
    }
  }
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
    "[Image #1] (unavailable)",
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

test("numbered attachments stay adjacent to prompts/results and preserve links across expansion and narrow widths", () => {
  const source = entries();
  const image = { type: "image" as const, data: "not-rendered", mimeType: "image/png" };
  source[0] = {
    ...base,
    type: "message",
    id: "user",
    message: {
      role: "user",
      timestamp: 0,
      content: [image, { type: "text", text: "Describe 中文🙂" }, image],
    },
  };
  const result = source[2];
  assert.ok(result.type === "message" && result.message.role === "toolResult");
  result.message.content.push(image);
  source.push({
    ...base,
    type: "custom_message",
    id: "custom",
    customType: "notice",
    content: [image],
    display: true,
  });
  const before = structuredClone(source);
  for (const ascii of [false, true]) {
    const content = new TranscriptContent(source, theme, tui, process.cwd(), ascii, {
      imageLoading: true,
    });
    assert.match(
      plain(content),
      /\[Image #1\] Describe 中文🙂 \[Image #2\].*\n {2}(?:⎿|L) {2}\[Image #1\] \(loading\.\.\.\)/,
    );
    const links = new Map([
      ["user:0", "file:///tmp/first.png"],
      ["user:2", "file:///tmp/second.png"],
      ["read-result:1", "file:///tmp/result.png"],
      ["custom:0", "file:///tmp/custom.png"],
    ]);
    content.setImageLinks(links);
    for (const expanded of [false, true, false]) {
      content.setExpanded(expanded);
      const output = plain(content);
      assert.doesNotMatch(output, /loading|unavailable|not-rendered/);
      assert.match(output, /(?:Read\(sample.ts\)|Read 1 file)[\s\S]*notice[\s\S]*\[Image\]/);
      assert.doesNotMatch(output, /Image #3|Image #4|result\.png/);
      if (expanded) assert.match(output, /Read image \(\d+ bytes\)/);
      for (const width of [0, 1, 2, 4, 6, 8, 12, 40, 80, 100]) {
        const lines = content.render(width);
        assert.ok(lines.every((line) => visibleWidth(line) <= width));
        for (const line of lines) {
          const display = stripTerminalSequences(line);
          if (display.startsWith(ascii ? "  L  [" : "  ⎿  [")) {
            const link = getOsc8LinkAtColumn(line, 5);
            assert.ok([...links.values()].includes(link ?? ""));
            assert.equal(getOsc8LinkAtColumn(line, 0), undefined);
            assert.equal(getOsc8LinkAtColumn(line, visibleWidth(line)), undefined);
          }
        }
      }
    }
    content.setImageLinks(new Map());
    assert.equal(plain(content).match(/\(unavailable\)/g)?.length, 3);
  }
  assert.deepEqual(source, before);
});

test("native fullscreen clicks activate snapshot attachment links, including after scrolling", () => {
  let receive = (_data: string) => {};
  const opened: string[] = [];
  const terminal: Terminal = {
    columns: 80,
    rows: 12,
    kittyProtocolActive: false,
    start: (input) => {
      receive = input;
    },
    stop() {},
    drainInput: async () => {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
  };
  const native = new TuiAltScreen(terminal, false, undefined, {
    openUrl: (url) => opened.push(url),
  });
  const source: SessionEntry[] = Array.from({ length: 10 }, (_, index) => ({
    ...base,
    type: "message",
    id: `user-${index}`,
    message: {
      role: "user",
      timestamp: 0,
      content: [{ type: "image", data: "fixture", mimeType: "image/png" }],
    },
  }));
  const links = new Map(
    source.map((entry, index) => [`${entry.id}:0`, `file:///tmp/image-${index}.png`]),
  );
  const content = new TranscriptContent(source, theme, native, process.cwd(), false, {
    imageLinks: links,
  });
  const view = new TranscriptView(
    content,
    theme,
    () => terminal.rows,
    () => {},
    () => false,
  );
  native.addChild(new Text("Underlying document", 0, 0));
  native.start();
  const overlay = native.showOverlay(view, {
    width: "100%",
    maxHeight: "100%",
    row: 0,
    col: 0,
    margin: 0,
  });
  try {
    for (const key of ["\x1b[H", "\x1b[F"]) {
      receive(key);
      native.renderNow();
      const lines = view.render(80);
      const row = lines.findIndex((line) => getOsc8LinkAtColumn(line, 5));
      assert.ok(row >= 0);
      const url = getOsc8LinkAtColumn(lines[row], 5);
      receive(`\x1b[<0;6;${row + 1}M`);
      receive(`\x1b[<0;6;${row + 1}m`);
      assert.equal(opened.at(-1), url);
    }
    assert.equal(opened.length, 2);
    assert.notEqual(opened[0], opened[1]);
  } finally {
    overlay.hide();
    native.stop();
  }
});

test("snapshot image preparation is cancellable and cannot redraw a dismissed modal", async () => {
  for (const fail of [false, true]) {
    let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    let resolve!: (links: ReadonlyMap<string, string>) => void;
    let reject!: (error: Error) => void;
    let signal!: AbortSignal;
    let renders = 0;
    const preparation = new Promise<ReadonlyMap<string, string>>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    registerTranscriptCommand(
      {
        registerCommand(_name, command) {
          handler = command.handler;
        },
      } as ExtensionAPI,
      () => false,
      (_entries, request) => {
        signal = request;
        return preparation;
      },
    );
    const ctx = {
      hasUI: true,
      cwd: process.cwd(),
      sessionManager: { getBranch: entries },
      ui: {
        custom: async (factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0]) => {
          const component = await factory(
            {
              terminal: { rows: 40 },
              requestRender() {
                renders++;
              },
            } as TUI,
            theme,
            { matches: () => false } as never,
            () => {},
          );
          component.handleInput?.("\x1b");
        },
      },
    } as unknown as ExtensionCommandContext;
    await handler("", ctx);
    assert.ok(signal.aborted);
    const before = renders;
    if (fail) reject(new Error("late failure"));
    else resolve(new Map());
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(renders, before);
  }
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
