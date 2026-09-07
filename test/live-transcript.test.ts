import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
  initTheme,
  type KeybindingsManager,
  type Theme,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  Container,
  CURSOR_MARKER,
  type EditorTheme,
  Markdown,
  type OverlayHandle,
  type OverlayOptions,
  Spacer,
  stripTerminalSequences,
  Text,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { OpenTuiEditor } from "../extensions/shell/open-tui/editor.ts";
import {
  createLiveTranscript,
  fitLiveDock,
  LiveMessageMirror,
  LiveTranscriptView,
  MarkdownObservation,
} from "../extensions/shell/open-tui/live-transcript.ts";

initTheme("dark", false);
const theme = {
  fg: (_color: string, text: string) => `\x1b[37m${text}\x1b[39m`,
  bg: (_color: string, text: string) => `\x1b[48;5;236m${text}\x1b[49m`,
} as Theme;
const plain = (lines: string[]) => lines.map(stripTerminalSequences).join("\n");

function fixture() {
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
      observation.transform(text, { messageType: "user", isStreaming: false, availableWidth }),
  });
  const box = new Box(1, 1);
  box.addChild(userMarkdown);
  user.clear();
  user.addChild(box);
  const assistant = new AssistantMessageComponent();
  const responseMarkdown = new Markdown(
    "# Response\n\n- **First** item",
    1,
    0,
    getMarkdownTheme(),
    undefined,
    {
      transform: (text, availableWidth) =>
        observation.transform(text, {
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

function editor() {
  const input = new OpenTuiEditor(
    {
      terminal: { rows: 40, write() {} },
      requestRender() {},
      setShowHardwareCursor() {},
    } as unknown as TUI,
    { borderColor: (text: string) => text, selectList: {} } as EditorTheme,
    { matches: () => false } as unknown as KeybindingsManager,
  );
  return input;
}

function viewport(rows = 24) {
  const f = fixture();
  const input = editor();
  input.focused = true;
  const inputContainer = new Container();
  inputContainer.addChild(input);
  const queue = new Container();
  queue.addChild(new Text("FOLLOW-UP QUEUED", 0, 0));
  const status = new Container();
  status.addChild(new Text("Working 3s", 0, 0));
  const footer = new Container();
  footer.addChild(new Text("MODEL / CONTEXT", 0, 0));
  const tui = {
    children: [f.document, queue, status, inputContainer, footer],
    terminal: { rows },
    requestRender() {},
  } as unknown as TUI;
  const view = new LiveTranscriptView(tui, input, f.mirror);
  return { ...f, input, tui, view, queue, status };
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

test("live viewport retains native queue/status/editor/footer and follows streamed output only at the end", () => {
  const h = viewport(12);
  h.responseMarkdown.setText(Array.from({ length: 45 }, (_, i) => `Line ${i}`).join("\n\n"));
  let text = plain(h.view.render(80));
  for (const label of ["Line 44", "FOLLOW-UP QUEUED", "Working 3s", "MODEL / CONTEXT"])
    assert.ok(text.includes(label), label);
  h.view.handleInput("\x1b[5~");
  text = plain(h.view.render(80));
  assert.doesNotMatch(text, /Line 44/);
  h.responseMarkdown.setText(Array.from({ length: 50 }, (_, i) => `Line ${i}`).join("\n\n"));
  assert.doesNotMatch(plain(h.view.render(80)), /Line 49/);
  h.view.handleInput("\x1b[<65;1;2M");
  assert.notEqual(plain(h.view.render(80)), text);
  for (let i = 0; i < 30; i++) h.view.handleInput("\x1b[6~");
  assert.match(plain(h.view.render(80)), /Line 49/);
  h.view.handleInput("hello 中文");
  assert.equal(h.input.getText(), "hello 中文");
  h.view.handleInput("\x1b[H");
  assert.doesNotMatch(plain(h.view.render(80)), /Line 49/);
  h.view.followLatest();
  assert.match(plain(h.view.render(80)), /Line 49/);
});

test("live prompt navigation follows public message boundaries without editing the draft", () => {
  const h = viewport(10);
  for (const name of ["second", "third"]) {
    const user = new UserMessageComponent("unused");
    // Use the same public observation callback for this viewport.
    const markdown = new Markdown(`${name} request`, 0, 0, getMarkdownTheme(), undefined, {
      transform: (text, availableWidth) =>
        h.observation.transform(text, { messageType: "user", isStreaming: false, availableWidth }),
    });
    const box = new Box(1, 1);
    box.addChild(markdown);
    user.clear();
    user.addChild(box);
    h.document.addChild(new Text("spacer\n".repeat(12), 0, 0));
    h.document.addChild(user);
  }
  h.document.addChild(new Text("tail\n".repeat(12), 0, 0));
  h.input.setText("unsent draft");
  h.view.render(80);
  for (const expected of ["third request", "second request", "raw request"]) {
    h.view.handleInput("\x1b[1;5A");
    assert.match(plain(h.view.render(80)).split("\n")[0], new RegExp(expected));
  }
  h.view.handleInput("\x1b[1;5B");
  assert.match(plain(h.view.render(80)).split("\n")[0], /second request/);
  assert.equal(h.input.getText(), "unsent draft");
});

test("live viewport adapts resized ANSI/CJK messages and prioritizes the cursor in a crowded dock", () => {
  const h = viewport();
  h.responseMarkdown.setText("中文🙂 é\n\n".repeat(15));
  h.input.setText("第一行\n第二行\n第三行");
  h.queue.addChild(new Text("Queued\n".repeat(30), 0, 0));
  for (const rows of [1, 2, 3, 4, 8, 24, 40]) {
    Object.defineProperty(h.tui.terminal, "rows", { value: rows, configurable: true });
    for (const width of [0, 1, 2, 3, 4, 12, 40, 80, 100]) {
      const lines = h.view.render(width);
      assert.ok(lines.length <= rows, `${width}x${rows}`);
      assert.ok(
        lines.every((line) => visibleWidth(line) <= width),
        `${width}x${rows}`,
      );
      if (width >= 4) assert.ok(lines.join("").includes(CURSOR_MARKER), `cursor ${width}x${rows}`);
    }
  }
  assert.deepEqual(
    fitLiveDock([["queue"], ["rule", `${CURSOR_MARKER}draft`, "rule"], ["footer"]], 1, 2),
    [`${CURSOR_MARKER}draft`, "footer"],
  );
});

test("live viewport rejects unrecognized host layout instead of hiding content", () => {
  const h = viewport();
  assert.equal(h.view.supportsLayout(), true);
  h.tui.children = [new Text("Unrecognized host layout", 0, 0)];
  assert.equal(h.view.supportsLayout(), false);
  assert.deepEqual(h.view.render(80), []);
});

test("live mounting yields to native focus, resumes after a dialog, and cannot reopen after cleanup", async () => {
  let transformer: unknown;
  const runtime = createLiveTranscript({
    registerMarkdownTransformer(value) {
      transformer = value;
    },
  } as ExtensionAPI);
  assert.equal(typeof transformer, "function");
  const h = viewport();
  let view: (Component & { focused?: boolean }) | undefined;
  let options: OverlayOptions | undefined;
  let focusCount = 0;
  let hidden = false;
  let focused = false;
  const handle = {
    isFocused: () => focused,
    focus() {
      focusCount++;
      focused = true;
      if (view) view.focused = true;
    },
    hide() {
      hidden = true;
      focused = false;
    },
  } as OverlayHandle;
  h.tui.showOverlay = (component, opts) => {
    view = component;
    options = opts ?? {};
    return handle;
  };
  Object.defineProperty(h.tui, "mode", { value: "fullscreen", configurable: true });
  const dispose = runtime.mount(h.tui, h.input, { ui: { theme } } as ExtensionContext, () => false);
  await Promise.resolve();
  assert.equal(focusCount, 1);
  assert.ok(view);
  assert.ok(options);
  assert.equal(options.visible?.(80, 24), true);
  view.focused = false;
  focused = false;
  assert.equal(options.visible?.(80, 24), false);
  h.input.focused = true;
  await Promise.resolve();
  assert.equal(focusCount, 2);
  h.input.focused = false;
  h.input.focused = true;
  dispose();
  await Promise.resolve();
  assert.equal(hidden, true);
  assert.equal(focusCount, 2);
  assert.equal(options.visible?.(80, 24), false);
  Object.defineProperty(h.tui, "mode", { value: "regular" });
  runtime.mount(h.tui, h.input, { ui: { theme } } as ExtensionContext, () => false)();
  assert.equal(focusCount, 2);
});
