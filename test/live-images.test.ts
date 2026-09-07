import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  type ExtensionContext,
  getMarkdownTheme,
  initTheme,
  SessionManager,
  type Theme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  Container,
  getCapabilities,
  getOsc8LinkAtColumn,
  Image,
  Markdown,
  ScrollView,
  Spacer,
  setCapabilities,
  stripTerminalSequences,
  type Terminal,
  Text,
  type TUI,
  TuiAltScreen,
  VStack,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { collectImages, type PrepareImages } from "../extensions/session/image-attachments.ts";
import {
  IMAGE_NUMBERS_ENTRY_TYPE,
  imageContentFingerprint,
} from "../extensions/session/image-number-metadata.ts";
import { LiveImagePresentation } from "../extensions/shell/open-tui/live-images.ts";
import {
  LiveDocumentPresentation,
  LiveMessageMirror,
  MarkdownObservation,
} from "../extensions/shell/open-tui/live-transcript.ts";

initTheme("dark", false);
const theme = {
  fg: (_color: string, text: string) => `\x1b[37m${text}\x1b[39m`,
  bg: (_color: string, text: string) => `\x1b[48;5;236m${text}\x1b[49m`,
} as Theme;
const image = { type: "image" as const, data: "fixture", mimeType: "image/png" };
const user = (content: UserMessage["content"]): UserMessage => ({
  role: "user",
  content,
  timestamp: 0,
});
const assistant = (
  content: AssistantMessage["content"] = [{ type: "text", text: "reply" }],
): AssistantMessage => ({
  role: "assistant",
  content,
  timestamp: 0,
  stopReason: "stop",
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
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
const plain = (lines: string[]) => lines.map(stripTerminalSequences).join("\n");
function setup(
  prepare: PrepareImages = async (entries) =>
    new Map(
      collectImages(entries).map((item) => [
        item.key,
        `file:///tmp/image-${item.number ?? "tool"}.png`,
      ]),
    ),
  providedTui?: TUI,
) {
  const manager = SessionManager.inMemory("/fixture");
  const observation = new MarkdownObservation();
  let renders = 0;
  const mirror = new LiveMessageMirror(
    observation,
    () => theme,
    () => false,
  );
  const tui =
    providedTui ??
    ({
      requestRender() {
        renders++;
      },
      invalidate() {
        mirror.invalidate();
      },
    } as TUI);
  const ctx = { ui: { theme }, sessionManager: manager } as unknown as ExtensionContext;
  const chat = new Container();
  const view = new LiveImagePresentation(tui, ctx, () => false, prepare);
  mirror.setImages(chat, view);
  const nativeUser = (text: string) => {
    const component = new UserMessageComponent(text);
    const box = new Box(1, 1);
    const markdown = new Markdown(text, 0, 0, getMarkdownTheme(), undefined, {
      transform: (source, availableWidth) =>
        observation.transform(source, { messageType: "user", isStreaming: false, availableWidth }),
    });
    box.addChild(markdown);
    component.clear();
    component.addChild(box);
    return { component, markdown };
  };
  const nativeAssistant = () => {
    const component = new AssistantMessageComponent();
    component.clear();
    component.addChild(new Spacer(1));
    component.addChild(new Text("Native assistant", 0, 0));
    return component;
  };
  return {
    manager,
    ctx,
    view,
    mirror,
    chat,
    nativeUser,
    nativeAssistant,
    render: (width = 80) => mirror.render(chat, width),
    get renders() {
      return renders;
    },
  };
}

test("live image numbering keeps exact annotations before and after native persistence", async () => {
  const h = setup();
  const text = "Literal [Image #300] [Image #301]";
  const message = user([{ type: "text", text }, image]);
  h.manager.appendCustomEntry(IMAGE_NUMBERS_ENTRY_TYPE, {
    version: 1,
    timestamp: 0,
    fingerprint: imageContentFingerprint(message.content),
    numbers: [301],
  });
  h.view.start(message, h.ctx);
  h.chat.addChild(h.nativeUser(text).component);
  try {
    for (const width of [12, 24, 80, 100]) {
      const lines = h.render(width);
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
      assert.doesNotMatch(plain(lines), /\[Image #1\]/);
    }
    await tick();
    assert.match(plain(h.render()), /Literal \[Image #300\] \[Image #301\]/);
    assert.match(plain(h.render()), /⎿.*\[Image #301\]/);
    h.manager.appendMessage(message);
    h.view.end(message, h.ctx);
    await tick();
    assert.match(plain(h.render()), /⎿.*\[Image #301\]/);
    assert.doesNotMatch(plain(h.render()), /pi-tuix-image-numbers|fingerprint/);
  } finally {
    h.view.dispose();
  }
});

test("live images preserve chronological image-only prompts, repeated user text, tool links and native children", async () => {
  const h = setup();
  h.manager.appendMessage(user([image, { type: "text", text: "same 中文🙂" }]));
  h.manager.appendMessage(assistant());
  h.manager.appendMessage(user([image]));
  h.manager.appendMessage(
    assistant([{ type: "toolCall", id: "read", name: "fixture", arguments: {} }]),
  );
  h.manager.appendMessage({
    role: "toolResult",
    toolCallId: "read",
    toolName: "fixture",
    content: [image],
    isError: false,
    timestamp: 0,
  });
  h.manager.appendMessage(user([{ type: "text", text: "same 中文🙂" }, image]));
  const tool = new ToolExecutionComponent(
    "fixture",
    "read",
    {},
    undefined,
    undefined,
    {} as TUI,
    "/fixture",
  );
  tool.clear();
  tool.addChild(new Text("Native tool result", 0, 0));
  h.chat.children = [
    new Text("Native notice", 0, 0),
    h.nativeUser("same 中文🙂").component,
    h.nativeAssistant(),
    h.nativeAssistant(),
    tool,
    new Spacer(1),
    h.nativeUser("same 中文🙂").component,
  ];
  const children = [...h.chat.children];
  const source = structuredClone(h.manager.getEntries());
  h.view.refresh(h.ctx);
  await tick();
  const output = plain(h.render());
  assert.match(
    output,
    /Native notice[\s\S]*❯ \[Image #1\] same 中文🙂[\s\S]*Native assistant[\s\S]*❯ \[Image #2\][\s\S]*Native assistant[\s\S]*Native tool result *\n {2}⎿ {2}\[Image\][\s\S]*❯ same 中文🙂 \[Image #3\]/,
  );
  assert.equal(output.match(/\[Image #2\]/g)?.length, 2);
  assert.doesNotMatch(output, /loading|unavailable|fixture/);
  for (const width of [0, 1, 2, 4, 8, 16, 40, 80, 100]) {
    const lines = h.render(width);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
    if (width >= 16) {
      const links = lines.map((line) => getOsc8LinkAtColumn(line, 5)).filter(Boolean);
      assert.deepEqual(
        links,
        [1, 2, "tool", 3].map((index) => `file:///tmp/image-${index}.png`),
      );
    }
  }
  assert.deepEqual(h.chat.children, children);
  assert.deepEqual(h.manager.getEntries(), source);
  h.view.dispose();
  assert.doesNotMatch(plain(h.render()), /Image #/);
});

test("successful Read image summaries do not add attachment branches or consume user numbers", async () => {
  for (const isError of [false, true]) {
    const h = setup();
    h.manager.appendMessage(user([image]));
    h.manager.appendMessage(
      assistant([{ type: "toolCall", id: "read", name: "read", arguments: { path: "image.png" } }]),
    );
    h.manager.appendMessage({
      role: "toolResult",
      toolCallId: "read",
      toolName: "read",
      content: [image],
      isError,
      timestamp: 0,
    });
    h.manager.appendMessage(user([image]));
    const tool = new ToolExecutionComponent(
      "read",
      "read",
      { path: "image.png" },
      undefined,
      undefined,
      {} as TUI,
      "/fixture",
    );
    tool.clear();
    tool.addChild(new Text(isError ? "Read failed" : "Read 1 file", 0, 0));
    h.chat.children = [h.nativeAssistant(), tool];
    const source = structuredClone(h.manager.getEntries());
    h.view.refresh(h.ctx);
    await tick();
    const output = plain(h.render());
    assert.match(output, /❯ \[Image #1\][\s\S]*Read [\s\S]*❯ \[Image #2\]/);
    assert.doesNotMatch(output, /Image #3/);
    if (isError) assert.match(output, /Read failed *\n {2}⎿ {2}\[Image\]/);
    else assert.doesNotMatch(output, /\[Image\]/);
    assert.deepEqual(h.manager.getEntries(), source);
    h.view.dispose();
  }
});

test("unmatched component order, changed user text and new unknown layouts never receive guessed image links", async () => {
  const h = setup();
  h.manager.appendMessage(user([image, { type: "text", text: "original" }]));
  const native = h.nativeUser("original");
  h.chat.addChild(native.component);
  h.view.refresh(h.ctx);
  await tick();
  assert.match(plain(h.render()), /Image #1/);
  native.markdown.setText("Changed by another extension");
  assert.doesNotMatch(h.render().join(""), /Image #|file:\/\//);
  native.markdown.setText("original");
  h.chat.addChild(h.nativeUser("Extra native user").component);
  assert.doesNotMatch(h.render().join(""), /Image #|file:\/\//);
  const nested = new Container();
  nested.addChild(native.component);
  h.chat.children = [nested];
  assert.doesNotMatch(h.render().join(""), /Image #|file:\/\//);
  h.view.dispose();
});

test("live message events show attachments before persistence and settle without duplicates during streaming", async () => {
  const h = setup();
  const input = user([{ type: "text", text: "" }, image]);
  h.view.start(input, h.ctx);
  assert.match(plain(h.render()), /❯ \[Image #1\]/);
  assert.equal(h.manager.getEntries().length, 0);
  h.view.end(input, h.ctx);
  h.manager.appendMessage(input);
  const reply = assistant([]);
  h.view.start(reply, h.ctx);
  h.chat.addChild(h.nativeAssistant());
  h.view.update({ ...reply, content: [{ type: "text", text: "stream" }] });
  assert.equal(plain(h.render()).match(/❯ \[Image #1\]/g)?.length, 1);
  const final = assistant();
  h.view.end(final, h.ctx);
  h.manager.appendMessage(final);
  await tick();
  assert.equal(plain(h.render()).match(/❯ \[Image #1\]/g)?.length, 1);
  assert.match(h.render().join(""), /file:\/\/\/tmp\/image-1.png/);
  assert.ok(h.render().join("").includes("\x1b]133;A\x07"));
  assert.equal(h.manager.getEntries().filter((entry) => entry.type === "message").length, 2);
  h.view.dispose();
});

test("branch projection removes abandoned attachments and late preparation cannot redraw after disposal", async () => {
  const requests: { signal: AbortSignal; resolve: (links: ReadonlyMap<string, string>) => void }[] =
    [];
  const h = setup(
    (_entries, signal) => new Promise((resolve) => requests.push({ signal, resolve })),
  );
  const first = h.manager.appendMessage(user([image]));
  h.view.refresh(h.ctx);
  const second = h.manager.appendMessage(user([image]));
  h.view.refresh(h.ctx);
  assert.ok(requests[0].signal.aborted);
  requests[0].resolve(new Map([[`${first}:0`, "file:///tmp/stale.png"]]));
  requests[1].resolve(
    new Map([
      [`${first}:0`, "file:///tmp/first.png"],
      [`${second}:0`, "file:///tmp/second.png"],
    ]),
  );
  await tick();
  assert.doesNotMatch(h.render().join(""), /stale/);
  assert.match(h.render().join(""), /second.png/);
  h.manager.branch(first);
  h.view.refresh(h.ctx);
  assert.doesNotMatch(plain(h.render()), /Image #2/);
  h.view.dispose();
  const renders = h.renders;
  requests[2].resolve(new Map([[`${first}:0`, "file:///tmp/closed.png"]]));
  await tick();
  assert.ok(requests.every(({ signal }) => signal.aborted));
  assert.equal(h.renders, renders);
});

test("native bitmap children are replaced only when public composition matches and their state remains unchanged", async () => {
  const capabilities = getCapabilities();
  setCapabilities({ ...capabilities, images: "kitty" });
  const h = setup();
  try {
    h.manager.appendMessage(
      assistant([{ type: "toolCall", id: "image-tool", name: "fixture", arguments: {} }]),
    );
    h.manager.appendMessage({
      role: "toolResult",
      toolCallId: "image-tool",
      toolName: "fixture",
      content: [image],
      isError: false,
      timestamp: 0,
    });
    const tool = new ToolExecutionComponent(
      "fixture",
      "image-tool",
      {},
      undefined,
      undefined,
      {} as TUI,
      "/fixture",
    );
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=";
    const bitmap = new Image(png, image.mimeType, { fallbackColor: (text) => text });
    tool.clear();
    tool.addChild(new Text("Native tool", 0, 0));
    tool.addChild(new Spacer(1));
    tool.addChild(bitmap);
    const before = tool.render(80);
    assert.ok(before.join("").includes("\x1b_G"));
    const children = [...tool.children];
    h.chat.children = [h.nativeAssistant(), tool];
    h.view.refresh(h.ctx);
    await tick();
    const output = plain(h.render());
    assert.match(output, /Native tool *\n {2}⎿ {2}\[Image\]/);
    assert.doesNotMatch(output, /image\/png|Image: /);
    for (const width of [1, 2, 4, 16, 80]) {
      const lines = h.render(width);
      assert.ok(!lines.join("").includes("\x1b_G"));
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
    }
    assert.deepEqual(tool.children, children);
    assert.deepEqual(tool.render(80), before);
    h.view.dispose();
  } finally {
    h.view.dispose();
    setCapabilities(capabilities);
  }
});

test("media locates late-mounted messages beside resource text without decorating an unrelated container", async () => {
  const h = setup();
  const resources = new Container();
  resources.addChild(new Text("Loaded resources", 0, 0));
  h.mirror.setImages([resources, h.chat], h.view);
  h.manager.appendMessage(user([image]));
  h.view.refresh(h.ctx);
  await tick();
  assert.equal(plain(h.mirror.render(resources, 80)).trim(), "Loaded resources");
  assert.match(plain(h.render()), /^❯ \[Image #1\]/);
  h.manager.appendMessage(assistant());
  h.chat.addChild(h.nativeAssistant());
  h.view.refresh(h.ctx);
  assert.match(plain(h.render()), /Image #1[\s\S]*Native assistant/);
  h.view.dispose();
});

test("native fullscreen search, prompt navigation and link activation share the image-bearing main document", async () => {
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
  const tui = new TuiAltScreen(terminal, false, undefined, {
    openUrl: (url) => opened.push(url),
    copyOnSelect: false,
  });
  const h = setup(undefined, tui);
  for (let index = 0; index < 10; index++) {
    h.manager.appendMessage(user([image]));
    h.manager.appendMessage(assistant());
    h.chat.addChild(h.nativeAssistant());
  }
  h.view.refresh(h.ctx);
  await tick();
  const document = new LiveDocumentPresentation(h.chat, h.mirror);
  const editor = { render: () => ["Original editor"], invalidate() {}, handleInput() {} };
  tui.addChild(document);
  tui.addChild(editor);
  tui.setFocus(editor);
  tui.setLayoutRoot(
    new VStack([
      {
        component: new ScrollView(document, { primary: true, follow: "end", scrollbar: "hidden" }),
        basis: 0,
        grow: 1,
        minSize: 1,
      },
      { component: editor, basis: "auto", grow: 0, shrink: 0 },
    ]),
  );
  tui.start();
  try {
    tui.renderNow();
    receive("\x1b[H");
    tui.renderNow();
    receive("\x1b[102;6u");
    receive("Image #8");
    tui.renderNow();
    const matched = tui.viewportTop;
    assert.ok(matched > 0);
    receive("\x1b");
    tui.renderNow();
    assert.equal(tui.viewportTop, matched);
    assert.equal(tui.getFocusedComponent(), editor);
    const lines = document.render(80);
    const row = lines.findIndex(
      (line) => getOsc8LinkAtColumn(line, 5) === "file:///tmp/image-8.png",
    );
    const screenRow = row - tui.viewportTop + 1;
    assert.ok(screenRow > 0 && screenRow < terminal.rows);
    receive(`\x1b[<0;6;${screenRow}M`);
    receive(`\x1b[<0;6;${screenRow}m`);
    assert.deepEqual(opened, ["file:///tmp/image-8.png"]);
    receive("\x1b[H");
    tui.renderNow();
    receive("\x1b[1;5B");
    tui.renderNow();
    assert.ok(tui.viewportTop > 0, "native next-prompt navigation includes image-only prompts");
  } finally {
    h.view.dispose();
    tui.stop();
  }
});
