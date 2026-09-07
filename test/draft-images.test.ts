import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { type KeybindingsManager, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  type EditorTheme,
  getOsc8LinkAtColumn,
  setKeybindings,
  stripTerminalSequences,
  type TUI,
  TUI_KEYBINDINGS,
  KeybindingsManager as TuiKeys,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { contentText } from "../extensions/session/image-attachment-view.ts";
import { collectImages } from "../extensions/session/image-attachments.ts";
import { DraftImages, readPastedImage } from "../extensions/shell/open-tui/draft-images.ts";
import { OpenTuiEditor } from "../extensions/shell/open-tui/editor.ts";
import { splitPastedPaths } from "../extensions/shell/open-tui/image-paths.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAKAAAABgCAIAAAAVRe7OAAAA/klEQVR4nO3RQQ0AIRDAQDTdG00oRszJIOlOUgWddfce1XfuqNbz44ABAwYMGDDgET0/DhgwYMCAAQMeEeB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOMBjgc4HuB4gOP94QRk7Wn8KkUAAAAASUVORK5CYII=";
const bytes = Buffer.from(png, "base64");
const hostRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const hostTui = await import(pathToFileURL(hostRequire.resolve("@earendil-works/pi-tui")).href);
const keys = new TuiKeys({
  ...TUI_KEYBINDINGS,
  "app.editor.external": { defaultKeys: "ctrl+g" },
  "app.message.followUp": { defaultKeys: "alt+enter" },
  "app.message.dequeue": { defaultKeys: "alt+up" },
});
setKeybindings(keys);
hostTui.setKeybindings(keys);
const fixture = (providedImages?: DraftImages) => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-tuix-draft-"));
  const path = join(cwd, "image 中文.png");
  writeFileSync(path, bytes);
  const images = providedImages ?? new DraftImages();
  const tui = {
    terminal: { rows: 24, write() {} },
    requestRender() {},
    getShowHardwareCursor: () => false,
    setShowHardwareCursor() {},
  } as unknown as TUI;
  const editor = new OpenTuiEditor(
    tui,
    { borderColor: (text: string) => text, selectList: {} } as EditorTheme,
    keys as unknown as KeybindingsManager,
    "block",
    false,
    () => "",
    images,
    cwd,
  );
  editor.focused = true;
  const paste = (text = path) => editor.handleInput(`\x1b[200~${text}\x1b[201~`);
  return {
    cwd,
    path,
    images,
    editor,
    paste,
    close: () => rmSync(cwd, { recursive: true, force: true }),
  };
};
const plain = (editor: OpenTuiEditor, width = 100) =>
  editor.render(width).map(stripTerminalSequences).join("\n");

test("explicit pasted image paths preserve bytes; ordinary text and non-image files stay text", () => {
  const h = fixture();
  try {
    for (const path of [
      h.path,
      JSON.stringify(h.path),
      `'${h.path}'`,
      pathToFileURL(h.path).href,
      "image 中文.png",
      "image\\ 中文.png",
    ]) {
      const result = readPastedImage(path, h.cwd);
      assert.ok(result, path);
      assert.deepEqual(Buffer.from(result.image.data, "base64"), bytes);
      assert.equal(result.path, h.path);
    }
    writeFileSync(join(h.cwd, "invalid.png"), "not an image");
    mkdirSync(join(h.cwd, "directory.png"));
    for (const text of [
      "describe image.png",
      "missing.png",
      "invalid.png",
      "directory.png",
      "image 中文.png\nsecond.png",
      "image 中文.png\u0000",
    ])
      assert.equal(readPastedImage(text, h.cwd), undefined);
    h.editor.handleInput(h.path);
    assert.equal(h.editor.getText(), h.path);
    assert.equal(h.images.has(h.editor.getText()), false);
  } finally {
    h.close();
  }
});

test("image chips use native atomic cursor movement, deletion and undo without consuming deleted numbers again", () => {
  const h = fixture();
  try {
    h.editor.handleInput("Before ");
    h.paste();
    const original = h.editor.getText();
    assert.match(plain(h.editor), /Before \[Image #1\]/);
    const end = h.editor.getCursor();
    h.editor.handleInput("\x1b[D");
    assert.equal(h.editor.getCursor().col, 7);
    h.editor.handleInput("\x1b[C");
    assert.deepEqual(h.editor.getCursor(), end);
    h.editor.handleInput("\x7f");
    assert.equal(h.editor.getText(), "Before ");
    h.editor.handleInput("\x1f");
    assert.equal(h.editor.getText(), original);
    h.paste();
    h.editor.handleInput("\x7f");
    h.paste();
    assert.match(plain(h.editor), /Before \[Image #1\]\[Image #3\]/);
    h.editor.handleInput(" After");
    h.editor.handleInput("\x01");
    for (let index = 0; index < 7; index++) h.editor.handleInput("\x1b[C");
    h.editor.handleInput("\x1b[3~");
    assert.match(plain(h.editor), /Before \[Image #3\] After/);
    h.editor.handleInput("\x1f");
    assert.match(plain(h.editor), /Before \[Image #1\]\[Image #3\] After/);
  } finally {
    h.close();
  }
});

test("split bracketed pastes, native large-paste undo and ordinary clipboard text retain their content", () => {
  const h = fixture();
  try {
    const large = "line 中文\n".repeat(100);
    h.paste(large);
    const before = h.editor.getText();
    h.editor.handleInput("\x1b[200~");
    h.editor.handleInput(h.path.slice(0, 4));
    h.editor.handleInput(`${h.path.slice(4)}\x1b[201~`);
    assert.match(h.editor.getExpandedText(), /line 中文/);
    assert.ok(h.images.paths(h.editor.getExpandedText()).includes(h.path));
    h.editor.handleInput("\x7f");
    assert.equal(h.editor.getText(), before);
    h.editor.handleInput("\x1f");
    assert.ok(h.images.paths(h.editor.getExpandedText()).includes(h.path));
    h.editor.insertTextAtCursor(" ordinary clipboard text");
    assert.match(h.editor.getExpandedText(), /ordinary clipboard text$/);
    h.editor.restoreImagePaths();
    assert.equal(h.images.has(h.editor.getText()), false);
    assert.ok(h.editor.getText().includes(h.path));
    assert.ok(h.editor.getText().includes(large));
  } finally {
    h.close();
  }
});

test("submission transforms only owned chips and preserves existing images and Pi delivery metadata", () => {
  const h = fixture();
  try {
    h.editor.handleInput("Before ");
    h.paste();
    h.paste();
    h.editor.handleInput("\x7f");
    h.paste();
    let submitted = "";
    h.editor.onSubmit = (text) => {
      submitted = text;
    };
    h.editor.handleInput("\r");
    const existing = { type: "image" as const, data: "existing", mimeType: "image/png" };
    const event = {
      type: "input" as const,
      text: submitted,
      images: [existing],
      source: "interactive" as const,
      streamingBehavior: "followUp" as const,
    };
    const before = structuredClone(event);
    const transformed = h.images.transform(event);
    assert.equal(transformed.action, "transform");
    if (transformed.action !== "transform") assert.fail();
    assert.equal(transformed.text, "Before [Image #1][Image #3]");
    assert.deepEqual(transformed.images, [
      existing,
      { type: "image", data: png, mimeType: "image/png" },
      { type: "image", data: png, mimeType: "image/png" },
    ]);
    assert.deepEqual(event, before);
    assert.deepEqual(h.images.transform({ ...event, text: "literal [Image #1]" }), {
      action: "continue",
    });
    h.editor.addToHistory(submitted);
    h.editor.handleInput("\x1b[A");
    assert.equal(h.editor.getText(), submitted);
    assert.match(plain(h.editor), /Before \[Image #1\]\[Image #3\]/);
  } finally {
    h.close();
  }
});

test("saved positional labels preserve gaps and avoid duplicate markers in conversation text", () => {
  const manager = SessionManager.inMemory("/fixture");
  const image = { type: "image" as const, data: png, mimeType: "image/png" };
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "Before [Image #2][Image #4] After" }, image, image],
    timestamp: 0,
  });
  manager.appendMessage({ role: "user", content: [image], timestamp: 0 });
  const entries = manager.getBranch();
  const before = structuredClone(entries);
  const attachments = collectImages(entries);
  assert.deepEqual(
    attachments.map((image) => image.number),
    [2, 4, 5],
  );
  const first = entries[0];
  assert.ok(first.type === "message" && first.message.role === "user");
  const rendered = contentText(
    first.message.content,
    first.id,
    new Map(attachments.map((image) => [image.key, image])),
  );
  assert.equal(rendered, "Before [Image #2][Image #4] After");
  assert.deepEqual(entries, before);
  const h = fixture();
  try {
    h.images.observe(entries);
    h.paste();
    assert.match(plain(h.editor), /Image #6/);
  } finally {
    h.close();
  }
});

test("rich draft rendering wraps whole chips and bounds Unicode, cursor and control text", () => {
  const h = fixture();
  try {
    h.editor.handleInput("中文🙂 before ");
    h.paste();
    h.editor.handleInput(" After\n".repeat(12));
    for (const width of [0, 1, 2, 3, 4, 8, 12, 20, 40, 80, 100]) {
      const lines = h.editor.render(width);
      assert.ok(
        lines.every((line) => visibleWidth(line) <= width),
        `width ${width}`,
      );
      assert.doesNotMatch(lines.join(""), /[\u{f0000}-\u{ffffd}]/u);
      if (width >= 4) assert.ok(lines.join("").includes(CURSOR_MARKER));
    }
    h.editor.setText(`${h.editor.getText()}\x1b]0;unsafe\x07`);
    assert.ok(!h.editor.render(100).join("").includes("\x1b]0;unsafe"));
  } finally {
    h.close();
  }
});

test("vertical navigation follows wrapped chip widths before native history navigation", () => {
  const h = fixture();
  try {
    h.editor.handleInput("12345678");
    h.paste();
    h.editor.handleInput("suffix");
    h.editor.render(22);
    const last = h.editor.getCursor();
    h.editor.handleInput("\x1b[A");
    assert.ok(h.editor.getCursor().col < last.col);
    h.editor.render(22);
    h.editor.handleInput("\x1b[B");
    assert.deepEqual(h.editor.getCursor(), last);
    assert.match(plain(h.editor, 22), /Image #1/);
  } finally {
    h.close();
  }
});

test("draft links prepare captured bytes outside rendering and cannot update after disposal", async () => {
  const h = fixture();
  try {
    let renders = 0;
    let signal: AbortSignal | undefined;
    let resolveLinks = (_links: Map<string, string>) => {};
    const images = new DraftImages(
      async (entries, nextSignal) => {
        signal = nextSignal;
        const image = collectImages(entries)[0];
        assert.equal(image.data, png);
        return new Promise<Map<string, string>>((resolve) => {
          resolveLinks = resolve;
        });
      },
      () => {
        renders++;
      },
    );
    const token = images.paste(h.path, h.cwd);
    assert.ok(token);
    images.dispose();
    assert.equal(signal?.aborted, true);
    resolveLinks(new Map([["pi-tuix-draft-1:0", "file:///tmp/late.png"]]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(renders, 0);
    assert.equal(images.get(token), undefined);
    assert.equal(images.paste(h.path, h.cwd), undefined);
  } finally {
    h.close();
  }
});

test("prepared draft links survive narrow rendering and disappear from restored plain input", async () => {
  const images = new DraftImages(
    async (entries) =>
      new Map(collectImages(entries).map((image) => [image.key, "file:///tmp/draft.png"])),
  );
  const h = fixture(images);
  try {
    h.paste();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const lines = h.editor.render(100);
    assert.equal(getOsc8LinkAtColumn(lines[1], 2), "file:///tmp/draft.png");
    for (const width of [1, 2, 3, 4, 8, 16, 40, 100])
      assert.ok(h.editor.render(width).every((line) => visibleWidth(line) <= width));
    h.editor.restoreImagePaths();
    assert.equal(
      h.editor.render(100).some((line) => getOsc8LinkAtColumn(line, 2) === "file:///tmp/draft.png"),
      false,
    );
  } finally {
    images.dispose();
    h.close();
  }
});

test("follow-up reads retain image payloads while external editing exposes restorable labels", () => {
  const h = fixture();
  try {
    h.editor.handleInput("Before ");
    h.paste();
    const raw = h.editor.getText();
    let followed = "";
    h.editor.onAction("app.message.followUp", () => {
      followed = h.editor.getExpandedText();
    });
    h.editor.handleInput("\x1b\r");
    assert.equal(followed, raw);
    assert.equal(
      h.images.transform({
        type: "input",
        text: followed,
        source: "interactive",
        streamingBehavior: "followUp",
      }).action,
      "transform",
    );
    let external = "";
    h.editor.onAction("app.editor.external", () => {
      external = h.editor.getExpandedText();
    });
    h.editor.handleInput("\x07");
    assert.equal(external, "Before [Image #1]");
    h.editor.setText(`${external} After`);
    assert.equal(h.editor.getText(), `${raw} After`);
    assert.match(plain(h.editor), /Before \[Image #1\] After/);
    h.editor.handleInput("\x07");
    h.editor.setText("Removed image");
    assert.equal(h.images.has(h.editor.getText()), false);
  } finally {
    h.close();
  }
});

test("taking back a native queue restores owned chips and leaves literal labels alone otherwise", () => {
  const h = fixture();
  try {
    h.paste();
    const original = h.editor.getText();
    const input = h.images.transform({ type: "input", text: original, source: "interactive" });
    assert.equal(input.action, "transform");
    if (input.action !== "transform") assert.fail();
    h.editor.setText("");
    let restored = false;
    h.editor.onQueueRestored = () => {
      assert.equal(h.editor.getText(), original);
      restored = true;
    };
    h.editor.onAction("app.message.dequeue", () => h.editor.setText(input.text));
    h.editor.handleInput("\x1b[1;3A");
    assert.equal(restored, true);
    assert.equal(h.editor.getText(), original);
    assert.equal(
      h.images.transform({ type: "input", text: h.editor.getExpandedText(), source: "interactive" })
        .action,
      "transform",
    );
    h.editor.setText("literal [Image #1]");
    assert.equal(h.images.has(h.editor.getText()), false);
  } finally {
    h.close();
  }
});

test("incoming user media reserves numbers before persistence without advancing tool-image numbers", () => {
  const h = fixture();
  try {
    const image = { type: "image" as const, data: png, mimeType: "image/png" };
    h.images.reserve({ role: "user", content: [image], timestamp: 0 });
    h.images.reserve({
      role: "toolResult",
      toolCallId: "read",
      toolName: "read",
      content: [image],
      isError: false,
      timestamp: 0,
    });
    h.paste();
    assert.match(plain(h.editor), /Image #2/);
    h.images.reserve({
      role: "user",
      content: [{ type: "text", text: "[Image #2]" }, image],
      timestamp: 0,
    });
    h.paste();
    assert.match(plain(h.editor), /Image #2.*Image #3/);
  } finally {
    h.close();
  }
});

test("terminal text cannot impersonate an existing internal image token", () => {
  const h = fixture();
  try {
    h.paste();
    const token = h.editor.getText();
    h.editor.setText("");
    h.paste(token);
    assert.equal(h.editor.getText(), "[Image #1]");
    assert.equal(
      h.images.transform({ type: "input", text: h.editor.getText(), source: "interactive" }).action,
      "continue",
    );
    h.editor.setText("");
    h.editor.handleInput(token);
    assert.equal(h.editor.getText(), "[Image #1]");
  } finally {
    h.close();
  }
});

test("multiple dropped paths become ordered image chips in one native undo step", () => {
  const h = fixture();
  try {
    const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const second = join(h.cwd, "second.gif");
    writeFileSync(second, Buffer.from(gif, "base64"));
    h.editor.handleInput("Before ");
    h.paste(`${h.path.replaceAll(" ", "\\ ")}\r\n${second}\t${JSON.stringify(h.path)}`);
    const raw = h.editor.getText();
    assert.equal(h.images.display(raw), "Before [Image #1] [Image #2] [Image #3]");
    const sent = h.images.transform({ type: "input", text: raw, source: "interactive" });
    assert.equal(sent.action, "transform");
    if (sent.action !== "transform") assert.fail();
    assert.deepEqual(
      sent.images?.map(({ data, mimeType }) => [data, mimeType]),
      [
        [png, "image/png"],
        [gif, "image/gif"],
        [png, "image/png"],
      ],
    );
    h.editor.handleInput("\x1f");
    assert.equal(h.editor.getText(), "Before ");
    h.paste(`${JSON.stringify(h.path)} ${JSON.stringify(h.path)}`);
    assert.equal(h.images.display(h.editor.getText()), "Before [Image #4] [Image #5]");
    h.editor.handleInput("\x7f");
    assert.equal(h.images.display(h.editor.getText()), "Before [Image #4] ");
    h.editor.handleInput("\x1f");
    assert.equal(h.images.display(h.editor.getText()), "Before [Image #4] [Image #5]");
    for (const width of [1, 3, 8, 20, 40, 100])
      assert.ok(h.editor.render(width).every((line) => visibleWidth(line) <= width));
  } finally {
    h.close();
  }
});

test("file-list parsing preserves quoted paths and never expands shell expressions", () => {
  const input = String.raw`'/tmp/one two.png' /tmp/three\ four.png "file:///tmp/five%20six.png" ~/seven.png /tmp/\$TOKEN.png '/tmp/$(command).png'`;
  const paths = splitPastedPaths(input);
  assert.deepEqual(
    paths?.map(({ path }) => path),
    [
      "/tmp/one two.png",
      "/tmp/three four.png",
      "file:///tmp/five%20six.png",
      "~/seven.png",
      "/tmp/$TOKEN.png",
      "/tmp/$(command).png",
    ],
  );
  for (const text of [
    "/tmp/one.png please",
    "Compare /tmp/one.png /tmp/two.png",
    "one.png two.png",
    "'/tmp/unclosed.png /tmp/two.png",
    "/tmp/one.png /tmp/dangling\\",
    "/tmp/one.png\x1b /tmp/two.png",
    Array(65).fill("/tmp/one.png").join(" "),
    `/tmp/${"a".repeat(64 * 1024)}.png /tmp/two.png`,
  ])
    assert.equal(splitPastedPaths(text), undefined);
});

test("mixed file drops retain unavailable and non-image paths without losing the valid image", () => {
  const h = fixture();
  try {
    const note = join(h.cwd, "note.txt");
    const invalid = join(h.cwd, "invalid.png");
    const missing = join(h.cwd, "missing.png");
    writeFileSync(note, "text file");
    writeFileSync(invalid, "not a PNG");
    h.paste([h.path, note, invalid, missing].map((path) => JSON.stringify(path)).join(" "));
    assert.equal(
      h.images.display(h.editor.getText()),
      `[Image #1] ${JSON.stringify(note)} ${JSON.stringify(invalid)} ${JSON.stringify(missing)}`,
    );
    const sent = h.images.transform({
      type: "input",
      text: h.editor.getText(),
      source: "interactive",
    });
    assert.equal(sent.action, "transform");
    if (sent.action !== "transform") assert.fail();
    assert.equal(sent.images?.length, 1);
    assert.equal(sent.images?.[0].data, png);
    h.editor.restoreImagePaths();
    for (const path of [h.path, note, invalid, missing])
      assert.ok(h.editor.getText().includes(path));
  } finally {
    h.close();
  }
});

test("ordinary prose, malformed lists and excessive file drops stay unchanged and consume no numbers", () => {
  const h = fixture();
  try {
    for (const text of [
      `Compare ${JSON.stringify(h.path)} please`,
      `${JSON.stringify(h.path)} '/unclosed.png`,
      Array(65).fill(JSON.stringify(h.path)).join(" "),
    ]) {
      h.paste(text);
      assert.equal(h.editor.getExpandedText(), text);
      assert.equal(h.images.has(h.editor.getText()), false);
      h.editor.setText("");
    }
    h.paste();
    assert.equal(h.images.display(h.editor.getText()), "[Image #1]");
    assert.equal(readPastedImage(h.path, h.cwd, bytes.length - 1), undefined);
    assert.equal(readPastedImage(h.path, h.cwd, bytes.length)?.image.data, png);
  } finally {
    h.close();
  }
});
