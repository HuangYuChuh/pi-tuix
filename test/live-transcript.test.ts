import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
  initTheme,
  type KeybindingsManager,
  type MarkdownTransformer,
  type Theme,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  Container,
  CURSOR_MARKER,
  type EditorTheme,
  Markdown,
  ScrollView,
  Spacer,
  stripTerminalSequences,
  type Terminal,
  Text,
  type TUI,
  TuiAltScreen,
  TuiMainScreen,
  VStack,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { ReferenceAssistantText } from "../extensions/session/message-view.ts";
import { OpenTuiEditor } from "../extensions/shell/open-tui/editor.ts";
import {
  createLiveTranscript,
  LiveDocumentPresentation,
  LiveMessageMirror,
  MarkdownObservation,
} from "../extensions/shell/open-tui/live-transcript.ts";
import { complexMarkdown } from "./fixtures/markdown-layout.ts";

initTheme("dark", false);
const theme = {
  fg: (_color: string, text: string) => `\x1b[37m${text}\x1b[39m`,
  bg: (_color: string, text: string) => `\x1b[48;5;236m${text}\x1b[49m`,
} as Theme;
const plain = (lines: string[]) => lines.map(stripTerminalSequences).join("\n");

function fixture(transform?: MarkdownTransformer, outputPad = 1) {
  const observation = new MarkdownObservation();
  const mirror = new LiveMessageMirror(
    observation,
    () => theme,
    () => false,
  );
  const user = new UserMessageComponent("unused");
  // Unit imports can resolve a second development copy of pi-tui. Compose the
  // public message containers with this test's peer instance; actual Pi loading
  // and native component identities are also checked through the real TUI.
  const userMarkdown = new Markdown("# raw request", 0, 0, getMarkdownTheme(), undefined, {
    transform: (text, availableWidth) =>
      (transform ?? observation.transform)(text, {
        messageType: "user",
        isStreaming: false,
        availableWidth,
      }),
  });
  const box = new Box(1, 1);
  box.addChild(userMarkdown);
  user.clear();
  user.addChild(box);
  const assistant = new AssistantMessageComponent();
  const responseMarkdown = new Markdown(
    "# Response\n\n- **First** item",
    outputPad,
    0,
    getMarkdownTheme(),
    undefined,
    {
      transform: (text, availableWidth) =>
        (transform ?? observation.transform)(text, {
          messageType: "assistant",
          isStreaming: true,
          availableWidth,
        }),
    },
  );
  const content = new Container();
  content.addChild(new Spacer(1));
  content.addChild(responseMarkdown);
  assistant.clear();
  assistant.addChild(content);
  const document = new Container();
  document.addChild(user);
  document.addChild(assistant);
  return { observation, mirror, user, userMarkdown, assistant, responseMarkdown, document };
}

function editor(tui?: TUI) {
  const input = new OpenTuiEditor(
    tui ??
      ({
        terminal: { rows: 40, write() {} },
        requestRender() {},
        setShowHardwareCursor() {},
      } as unknown as TUI),
    { borderColor: (text: string) => text, selectList: {} } as EditorTheme,
    { matches: () => false } as unknown as KeybindingsManager,
  );
  return input;
}

test("live mirror preserves Markdown structure, raw user text and opaque host notifications/tools", () => {
  const f = fixture();
  let calls = 0;
  const opaque = {
    render() {
      calls++;
      return ["OPAQUE TOOL / NATIVE WARNING"];
    },
    invalidate() {},
  };
  f.document.addChild(opaque);
  const before = [...f.document.children];
  const text = plain(f.mirror.render(f.document, 80));
  assert.match(text, /^❯ # raw request/);
  assert.match(text, /⏺ Response/);
  assert.match(text, / {2}.*First item/);
  assert.match(text, /OPAQUE TOOL \/ NATIVE WARNING/);
  assert.equal(calls, 1);
  assert.deepEqual(f.document.children, before);
  assert.equal(f.userMarkdown.render(40).length, 1);
});

test("Markdown observation handles a host-populated cache and streamed setText without stale display", () => {
  const f = fixture();
  f.userMarkdown.render(78);
  assert.match(plain(f.mirror.render(f.user, 80)), /raw request/);
  f.userMarkdown.setText("changed 中文 request");
  f.userMarkdown.render(78);
  assert.match(plain(f.mirror.render(f.user, 80)), /changed 中文 request/);
  for (const update of ["first", "first second", "first second third"]) {
    f.responseMarkdown.setText(update);
    f.responseMarkdown.render(80);
    const result = f.mirror.render(f.assistant, 80);
    assert.match(plain(result), new RegExp(`⏺ ${update}`));
    assert.deepEqual(f.mirror.render(f.assistant, 80), result);
  }
  assert.equal(
    f.observation.transform("unchanged", {
      messageType: "user",
      availableWidth: 80,
      isStreaming: false,
    }),
    "unchanged",
  );
});

test("static message layout is reused while streaming, width, ASCII and theme changes invalidate its display", () => {
  const f = fixture();
  let paints = 0;
  let ascii = false;
  let current = {
    ...theme,
    fg: (_color: string, text: string) => {
      paints++;
      return `\x1b[31m${text}\x1b[39m`;
    },
  } as Theme;
  const mirror = new LiveMessageMirror(
    f.observation,
    () => current,
    () => ascii,
  );
  const view = new LiveDocumentPresentation(f.document, mirror);
  const initial = view.render(80);
  assert.ok(paints > 0);
  paints = 0;
  assert.deepEqual(view.render(80), initial);
  assert.equal(paints, 0);
  f.responseMarkdown.setText("new streamed text");
  assert.match(plain(view.render(80)), /⏺ new streamed text/);
  f.userMarkdown.setText("new user text");
  assert.match(plain(view.render(80)), /❯ new user text/);
  ascii = true;
  assert.match(plain(view.render(80)), /^> new user text/);
  assert.match(plain(view.render(80)), /\* new streamed text/);
  const narrow = view.render(12);
  assert.ok(narrow.every((line) => visibleWidth(line) <= 12));
  current = {
    ...current,
    fg: (_color: string, text: string) => `\x1b[32m${text}\x1b[39m`,
  } as Theme;
  assert.ok(view.render(80).join("").includes("\x1b[32m"));
  current.fg = (_color, text) => `\x1b[34m${text}\x1b[39m`;
  view.invalidate();
  assert.ok(view.render(80).join("").includes("\x1b[34m"));
});

test("message layout adapts public Markdown padding without alternating widths on static redraws", () => {
  for (const padding of [0, 1, 2, 3]) {
    const f = fixture(undefined, padding);
    f.responseMarkdown.setText("A long streamed response 中文 ".repeat(12));
    for (const width of [12, 40, 80]) {
      const first = f.mirror.render(f.assistant, width);
      assert.match(plain(first), /⏺ A long/);
      assert.ok(first.every((line) => visibleWidth(line) <= width));
      const observed = f.observation.read(f.responseMarkdown, width - 2 + padding * 2);
      assert.ok(observed);
      assert.deepEqual(f.mirror.render(f.assistant, width), first);
      assert.equal(f.observation.read(f.responseMarkdown, width - 2 + padding * 2), observed);
    }
  }
});

test("narrow assistant layouts keep every character across host padding and resizes", () => {
  const source = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const padding of [0, 1, 2, 3]) {
    const f = fixture(undefined, padding);
    f.responseMarkdown.setText(source);
    for (const width of [1, 2, 3, 4, 5, 6, 8, 24, 80, 4, 80]) {
      const lines = f.mirror.render(f.assistant, width);
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
      assert.equal(
        plain(lines).replace(/[^A-Z]/g, ""),
        source,
        `width ${width}, padding ${padding}`,
      );
    }
  }
});

test("complex Markdown stays consistent between live messages and snapshots across resizes", () => {
  const snapshot = new ReferenceAssistantText(complexMarkdown, theme);
  for (const padding of [0, 1, 2, 3]) {
    const f = fixture(undefined, padding);
    f.responseMarkdown.setText(complexMarkdown);
    for (const width of [2, 4, 5, 8, 12, 24, 40, 80, 100, 40, 100]) {
      const lines = f.mirror.render(f.assistant, width);
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
      assert.deepEqual(
        plain(lines).trim(),
        plain(snapshot.render(width)).trim(),
        `width ${width}, padding ${padding}`,
      );
      assert.deepEqual(f.mirror.render(f.assistant, width), lines);
    }
  }
});

test("unknown message shapes and absent Markdown callbacks fall back to original public renderers", () => {
  const f = fixture();
  const native = new UserMessageComponent("Native fallback");
  assert.equal(plain(f.mirror.render(native, 80)), plain(native.render(80)));
  const uncaptured = new Markdown("No transform registered", 0, 0, getMarkdownTheme());
  assert.equal(f.observation.read(uncaptured, 40), undefined);
  const custom = new Container();
  custom.addChild(new Text("Extension-owned component", 0, 0));
  assert.match(plain(f.mirror.render(custom, 40)), /Extension-owned/);
});

function harness(mode: "regular" | "fullscreen" = "fullscreen", rows = 24) {
  let transform: MarkdownTransformer | undefined;
  const runtime = createLiveTranscript({
    registerMarkdownTransformer(value) {
      transform = value;
    },
  } as ExtensionAPI);
  const f = fixture(transform);
  // Keep Pi's original document/chat references, as the actual host does.
  const chat = new Container();
  chat.children = f.document.children;
  f.document.children = [chat];
  let receive = (_data: string) => {};
  let copied = "";
  const writes: string[] = [];
  const terminal: Terminal = {
    columns: 80,
    rows,
    kittyProtocolActive: false,
    start(onInput) {
      receive = onInput;
    },
    stop() {},
    drainInput: async () => {},
    write: (data) => {
      writes.push(data);
    },
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
  };
  const tui =
    mode === "fullscreen"
      ? new TuiAltScreen(terminal, false, undefined, {
          copyOnSelect: false,
          copySelection: async (text) => {
            copied = text;
            return true;
          },
        })
      : new TuiMainScreen(terminal);
  const input = editor(tui);
  const inputContainer = new Container();
  inputContainer.addChild(input);
  const queue = new Container();
  queue.addChild(new Text("FOLLOW-UP QUEUED", 0, 0));
  const status = new Container();
  status.addChild(new Text("Working 3s", 0, 0));
  const footer = new Container();
  footer.addChild(new Text("MODEL / CONTEXT", 0, 0));
  const dock = new Container();
  dock.children = [queue, status, inputContainer, footer];
  tui.addChild(f.document);
  for (const child of dock.children) tui.addChild(child);
  if (tui instanceof TuiAltScreen) {
    tui.setLayoutRoot(
      new VStack([
        {
          component: new ScrollView(f.document, {
            primary: true,
            follow: "end",
            scrollbar: "hidden",
          }),
          basis: 0,
          grow: 1,
          minSize: 1,
        },
        { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
      ]),
    );
  }
  tui.setFocus(input);
  const dispose = runtime.mount(tui, input, { ui: { theme } } as ExtensionContext, () => false);
  return {
    ...f,
    chat,
    tui,
    terminal,
    dock,
    queue,
    input,
    runtime,
    dispose,
    writes,
    copied: () => copied,
    send(data: string) {
      receive(data);
      tui.renderNow();
    },
    close() {
      dispose();
      tui.stop();
    },
  };
}

test("both native modes share live message presentation without changing dock, focus or source containers", async () => {
  for (const mode of ["regular", "fullscreen"] as const) {
    const h = harness(mode);
    const root = [...h.tui.children];
    const messages = [...h.chat.children];
    await Promise.resolve();
    try {
      assert.deepEqual(h.tui.children, root);
      assert.deepEqual(h.chat.children, messages);
      assert.ok(h.document.children[0] instanceof LiveDocumentPresentation);
      assert.equal(h.tui.getFocusedComponent(), h.input);
      assert.equal(h.tui.hasOverlay(), false);
      h.tui.start();
      h.tui.renderNow();
      const text = plain(h.writes);
      for (const label of [
        "❯ # raw request",
        "⏺ Response",
        "FOLLOW-UP QUEUED",
        "Working 3s",
        "MODEL / CONTEXT",
      ])
        assert.ok(text.includes(label), `${mode}: ${label} in ${text}`);
      h.chat.addChild(new Text("NEW HOST NOTIFICATION", 0, 0));
      assert.match(plain(h.document.render(80)), /NEW HOST NOTIFICATION/);
      h.chat.removeChild(h.assistant);
      assert.doesNotMatch(plain(h.document.render(80)), /Response/);
      h.chat.addChild(h.assistant);
      h.responseMarkdown.setText("Streaming updated 中文");
      assert.match(plain(h.document.render(80)), /⏺ Streaming updated 中文/);
      h.responseMarkdown.setText("```ts\nconst restored = true;\n```");
      assert.doesNotMatch(plain(h.document.render(80)), /```/);
      h.dispose();
      assert.deepEqual(h.document.children, [h.chat]);
      assert.equal(plain(h.document.render(80)), plain(h.chat.render(80)));
      assert.match(plain(h.document.render(80)), /```ts/);
    } finally {
      h.close();
    }
  }
});

test("native search retains its selected location after closing and mouse copy uses the decorated document", async () => {
  const h = harness();
  assert.ok(h.tui instanceof TuiAltScreen);
  h.responseMarkdown.setText(Array.from({ length: 60 }, (_, i) => `Line ${i}`).join("\n\n"));
  await Promise.resolve();
  h.tui.start();
  h.tui.renderNow();
  try {
    h.send("\x1b[H");
    assert.equal(h.tui.viewportTop, 0);
    h.send("\x1b[102;6u");
    assert.equal(h.tui.hasOverlay(), true);
    h.send("Line 31");
    assert.ok(h.tui.viewportTop > 0);
    const matchedTop = h.tui.viewportTop;
    h.send("\x1b");
    assert.equal(h.tui.viewportTop, matchedTop);
    assert.equal(h.tui.hasOverlay(), false);
    assert.equal(h.tui.getFocusedComponent(), h.input);
    const documentLines = h.document.render(80).map(stripTerminalSequences);
    const target = documentLines.findIndex((line) => line.trim() === "Line 31");
    const row = target - h.tui.viewportTop + 1;
    assert.ok(row > 0 && row <= h.terminal.rows - h.dock.render(80).length);
    h.send(`\x1b[<0;3;${row}M`);
    h.send(`\x1b[<32;10;${row}M`);
    h.send(`\x1b[<0;10;${row}m`);
    assert.equal(await h.tui.copyActiveSelectionToClipboard(), true);
    assert.equal(h.copied().trim(), "Line 31");
  } finally {
    h.close();
  }
});

test("native viewport keeps page, wheel, prompt navigation and stream following", async () => {
  const h = harness();
  assert.ok(h.tui instanceof TuiAltScreen);
  h.responseMarkdown.setText(Array.from({ length: 50 }, (_, i) => `Line ${i}`).join("\n\n"));
  await Promise.resolve();
  h.tui.start();
  h.tui.renderNow();
  try {
    const end = h.tui.viewportTop;
    h.send("\x1b[5~");
    assert.ok(h.tui.viewportTop < end);
    const page = h.tui.viewportTop;
    h.send("\x1b[<64;5;3M");
    assert.ok(h.tui.viewportTop < page);
    const scrolled = h.tui.viewportTop;
    h.responseMarkdown.setText(Array.from({ length: 55 }, (_, i) => `Line ${i}`).join("\n\n"));
    h.tui.renderNow();
    assert.equal(h.tui.viewportTop, scrolled);
    h.send("\x1b[1;5A");
    assert.equal(h.tui.viewportTop, 0);
    h.runtime.followLatest();
    h.tui.renderNow();
    assert.equal(h.tui.isFollowingOutput, true);
    assert.ok(h.tui.viewportTop > end);
    h.send("draft 中文");
    assert.equal(h.input.getText(), "draft 中文");
  } finally {
    h.close();
  }
});

test("native dialogs receive focus without a second focus observer or persistent overlay", async () => {
  const h = harness();
  await Promise.resolve();
  try {
    const dialog = new Text("NATIVE CONFIRMATION", 0, 0);
    const overlay = h.tui.showOverlay(dialog);
    assert.equal(h.tui.getFocusedComponent(), dialog);
    assert.equal(h.input.focused, false);
    overlay.hide();
    assert.equal(h.tui.getFocusedComponent(), h.input);
    assert.equal(h.input.focused, true);
    assert.equal(h.tui.hasOverlay(), false);
  } finally {
    h.close();
  }
});

test("document composition is reversible without losing later additions, removals or reordering", async () => {
  const h = harness("regular");
  const second = new Container();
  second.addChild(new Text("SECOND", 0, 0));
  h.document.addChild(second);
  await Promise.resolve();
  const later = new Text("ADDED LATER", 0, 0);
  const [firstWrapper, secondWrapper] = h.document.children;
  h.document.children = [later, secondWrapper, firstWrapper];
  h.dispose();
  assert.deepEqual(h.document.children, [later, second, h.chat]);
  const other = harness("regular");
  other.dispose();
  await Promise.resolve();
  assert.deepEqual(other.document.children, [other.chat]);
  h.close();
  other.close();
});

test("a repeated old teardown cannot detach a replacement mount's native follow behavior", async () => {
  const h = harness();
  assert.ok(h.tui instanceof TuiAltScreen);
  h.responseMarkdown.setText("Long response\n\n".repeat(60));
  await Promise.resolve();
  h.tui.start();
  h.tui.renderNow();
  h.dispose();
  const disposeReplacement = h.runtime.mount(
    h.tui,
    h.input,
    { ui: { theme } } as ExtensionContext,
    () => false,
  );
  await Promise.resolve();
  try {
    h.tui.scrollToTop();
    h.dispose();
    h.runtime.followLatest();
    h.tui.renderNow();
    assert.ok(h.tui.viewportTop > 0);
    assert.equal(h.tui.isFollowingOutput, true);
  } finally {
    disposeReplacement();
    h.close();
  }
});

test("unrecognized roots remain native and native invalidation reaches the original message components", async () => {
  const h = harness();
  h.tui.children = [new Text("UNRECOGNIZED", 0, 0)];
  await Promise.resolve();
  assert.deepEqual(h.document.children, [h.chat]);
  h.close();
  const f = fixture();
  let invalidations = 0;
  const component = {
    render: () => ["OPAQUE"],
    invalidate() {
      invalidations++;
    },
  };
  new LiveDocumentPresentation(component, f.mirror).invalidate();
  assert.equal(invalidations, 1);
});

test("document presentation preserves ANSI/CJK bounds and ordered semantic prompt zones", () => {
  const f = fixture();
  f.userMarkdown.setText("第一行🙂 é\n第二行 ".repeat(20));
  f.responseMarkdown.setText("# 中文🙂 é\n\n- More text".repeat(20));
  const content = new LiveDocumentPresentation(f.document, f.mirror);
  for (const width of [0, 1, 2, 3, 4, 12, 40, 80, 100]) {
    const lines = content.render(width);
    assert.ok(
      lines.every((line) => visibleWidth(line) <= width),
      `width ${width}`,
    );
  }
  for (const source of ["one", "one\ntwo"]) {
    f.userMarkdown.setText(source);
    const joined = f.mirror.render(f.user, 80).join("\n");
    const start = joined.indexOf("\x1b]133;A\x07");
    const end = joined.indexOf("\x1b]133;B\x07");
    const final = joined.indexOf("\x1b]133;C\x07");
    assert.ok(start >= 0 && start < end && end < final);
  }
  const input = editor();
  input.focused = true;
  input.setText("第一行\n第二行\n第三行");
  for (const width of [4, 12, 40, 80]) {
    const lines = input.render(width);
    assert.ok(
      lines.some((line) => line.includes(CURSOR_MARKER)),
      `cursor ${width}`,
    );
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
  }
});
