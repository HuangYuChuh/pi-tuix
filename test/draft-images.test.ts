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
import { IMAGE_NUMBERS_ENTRY_TYPE } from "../extensions/session/image-number-metadata.ts";
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
  "app.interrupt": { defaultKeys: "escape" },
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

test("mixed literal and owned image numbers survive submission and restart without phantom IDs", () => {
  const h = fixture();
  const resumed = fixture();
  try {
    h.editor.setText("Literal [Image #300] ");
    h.paste();
    const result = h.images.transform(
      { type: "input", source: "interactive", text: h.editor.getExpandedText() },
      false,
    );
    if (result.action !== "transform") assert.fail();
    const message = {
      role: "user" as const,
      timestamp: 123,
      content: [{ type: "text" as const, text: result.text }, ...(result.images ?? [])],
    };
    const observed = h.images.reserve(message, false);
    assert.deepEqual(observed?.numbers, [301]);
    const manager = SessionManager.inMemory("/fixture");
    manager.appendCustomEntry(IMAGE_NUMBERS_ENTRY_TYPE, observed);
    manager.appendMessage(message);
    assert.deepEqual(
      collectImages(manager.getBranch()).map(({ number, inline }) => [number, inline]),
      [[301, true]],
    );
    assert.deepEqual(manager.buildSessionContext().messages, [message]);
    assert.equal(result.images?.[0].data, png);
    h.images.observe(manager.getBranch());
    h.editor.setText("");
    h.paste();
    assert.equal(h.images.display(h.editor.getText()), "[Image #302]");
    resumed.images.seedHistory(manager.getBranch());
    resumed.paste();
    assert.equal(resumed.images.display(resumed.editor.getText()), "[Image #302]");
  } finally {
    h.close();
    resumed.close();
  }
});

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

test("saved repeated image references share positional numbers without changing legacy payloads", () => {
  const manager = SessionManager.inMemory("/fixture");
  const image = { type: "image" as const, data: png, mimeType: "image/png" };
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "[Image #7] [Image #4] [Image #7]" }, image, image],
    timestamp: 0,
  });
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "[Image #9] [Image #9]" }, image, image],
    timestamp: 0,
  });
  manager.appendMessage({ role: "user", content: [image], timestamp: 0 });
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "[Image #12] [Image #12] [Image #13]" }, image],
    timestamp: 0,
  });
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "[Image #0] [Image #0]" }, image],
    timestamp: 0,
  });
  const entries = manager.getBranch();
  const before = structuredClone(entries);
  const images = collectImages(entries);
  assert.deepEqual(
    images.map((image) => image.number),
    [7, 4, 9, 9, 10, 11, 12],
  );
  assert.deepEqual(
    images.map((image) => image.inline),
    [true, true, true, true, false, false, false],
  );
  const first = entries[0];
  assert.ok(first.type === "message" && first.message.role === "user");
  assert.equal(
    contentText(
      first.message.content,
      first.id,
      new Map(images.map((image) => [image.key, image])),
    ),
    "[Image #7] [Image #4] [Image #7]",
  );
  assert.deepEqual(entries, before);
  const h = fixture();
  try {
    h.images.reserve(
      {
        role: "user",
        content: [{ type: "text", text: "[Image #9] [Image #9]" }, image],
        timestamp: 0,
      },
      false,
    );
    h.paste();
    assert.equal(h.images.display(h.editor.getText()), "[Image #10]");
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
    const input = h.images.transform({
      type: "input",
      text: original,
      source: "interactive",
      streamingBehavior: "followUp",
    });
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

test("external editing shares repeated labels with one attachment until the final reference is deleted", () => {
  const h = fixture();
  try {
    h.paste();
    h.editor.handleInput(" literal [Image #1]");
    let external = "";
    h.editor.onAction("app.editor.external", () => {
      external = h.editor.getExpandedText();
    });
    h.editor.handleInput("\x07");
    assert.equal(external, "[Image #1] literal [Image #1]");
    h.editor.setText(`${external} edited`);
    const submit = () =>
      h.images.transform(
        { type: "input", text: h.editor.getExpandedText(), source: "interactive" },
        false,
      );
    let input = submit();
    assert.equal(input.action, "transform");
    if (input.action !== "transform") assert.fail();
    assert.equal(input.text, `${external} edited`);
    assert.deepEqual(input.images, [{ type: "image", data: png, mimeType: "image/png" }]);
    h.editor.handleInput("\x01");
    h.editor.handleInput("\x1b[3~");
    input = submit();
    assert.equal(input.action, "transform");
    if (input.action !== "transform") assert.fail();
    assert.equal(input.text, " literal [Image #1] edited");
    assert.equal(input.images?.length, 1);
    h.editor.handleInput("\x05");
    h.editor.handleInput("\x15");
    assert.equal(submit().action, "continue");
    h.editor.handleInput("\x1f");
    assert.equal(submit().action, "transform");
    for (const width of [8, 20, 40, 80, 100])
      assert.ok(h.editor.render(width).every((line) => visibleWidth(line) <= width));
    h.editor.restoreImagePaths();
    assert.equal(h.images.has(h.editor.getText()), false);
    assert.ok(h.editor.getText().includes(h.path));
  } finally {
    h.close();
  }
});

test("external references retain identity order, separate same-byte pastes and untouched native images", () => {
  const h = fixture();
  try {
    h.paste();
    const old = h.editor.getText();
    h.editor.setText("");
    h.paste();
    h.paste();
    let external = "";
    h.editor.onAction("app.editor.external", () => {
      external = h.editor.getExpandedText();
    });
    h.editor.handleInput("\x07");
    assert.equal(external, "[Image #2][Image #3]");
    h.editor.setText(`[Image #3] [Image #2] [Image #3] old [Image #1] ${old}`);
    const existing = { type: "image" as const, mimeType: "image/png", data: png };
    const event = {
      type: "input" as const,
      source: "interactive" as const,
      text: h.editor.getExpandedText(),
      images: [existing, existing],
    };
    const before = structuredClone(event);
    const input = h.images.transform(event, false);
    assert.equal(input.action, "transform");
    if (input.action !== "transform") assert.fail();
    assert.equal(input.text, "[Image #3] [Image #2] [Image #3] old [Image #1] [Image #1]");
    assert.deepEqual(input.images, [existing, existing, existing, existing]);
    assert.deepEqual(
      [...h.editor.getText()]
        .filter((token) => h.images.get(token))
        .map((token) => h.images.get(token)?.number),
      [3, 2, 3],
    );
    assert.deepEqual(event, before);
    h.editor.handleInput("\x07");
    h.editor.setText("all references removed");
    assert.equal(
      h.images.transform({ ...event, text: h.editor.getExpandedText() }, false).action,
      "continue",
    );
  } finally {
    h.close();
  }
});

test("failed external editing cannot attach an old image to a later text replacement", () => {
  const h = fixture();
  try {
    h.paste();
    h.editor.onAction("app.editor.external", () => {
      h.editor.getExpandedText();
    });
    h.editor.handleInput("\x07");
    // Native failure supplies no setText result and leaves the draft untouched.
    h.editor.handleInput("\x7f");
    h.editor.setText("later [Image #1]");
    assert.equal(h.images.has(h.editor.getText()), false);
    assert.equal(
      h.images.transform(
        { type: "input", source: "interactive", text: h.editor.getExpandedText() },
        false,
      ).action,
      "continue",
    );
  } finally {
    h.close();
  }
});

test("typed references before owned chips keep image bytes aligned with visible attachment numbers", () => {
  const h = fixture();
  try {
    const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const path = join(h.cwd, "second.gif");
    writeFileSync(path, Buffer.from(gif, "base64"));
    h.paste();
    h.paste(path);
    h.editor.setText(`[Image #2] ${h.editor.getText()}`);
    const result = h.images.transform(
      { type: "input", source: "interactive", text: h.editor.getExpandedText() },
      false,
    );
    assert.equal(result.action, "transform");
    if (result.action !== "transform") assert.fail();
    assert.equal(result.text, "[Image #2] [Image #1][Image #2]");
    assert.deepEqual(
      result.images?.map(({ data }) => data),
      [gif, png],
    );
    const manager = SessionManager.inMemory("/fixture");
    manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: result.text }, ...(result.images ?? [])],
      timestamp: 0,
    });
    assert.deepEqual(
      collectImages(manager.getBranch()).map(({ number, mimeType }) => [number, mimeType]),
      [
        [2, "image/gif"],
        [1, "image/png"],
      ],
    );
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

test("current literal labels seed successful image pastes without consuming discarded or failed drafts", () => {
  const h = fixture();
  try {
    h.editor.handleInput("Note [Image #41] ");
    h.paste(`${h.path.replaceAll(" ", "\\ ")} ${h.path.replaceAll(" ", "\\ ")}`);
    assert.equal(h.images.display(h.editor.getText()), "Note [Image #41] [Image #42] [Image #43]");
    const input = h.images.transform(
      { type: "input", source: "interactive", text: h.editor.getExpandedText() },
      false,
    );
    assert.equal(input.action, "transform");
    if (input.action !== "transform") assert.fail();
    assert.equal(input.images?.length, 2);
    h.editor.handleInput("\x1f");
    assert.equal(h.editor.getText(), "Note [Image #41] ");
    h.editor.setText("Discard [Image #77]");
    h.editor.setText("");
    h.editor.insertTextAtCursor(h.path);
    assert.equal(h.images.display(h.editor.getText()), "[Image #44]");
    h.editor.setText("[Image #500] ");
    h.paste(join(h.cwd, "missing.png"));
    assert.equal(h.images.has(h.editor.getText()), false);
    h.editor.setText("");
    h.paste();
    assert.equal(h.images.display(h.editor.getText()), "[Image #45]");
    for (const width of [8, 20, 40, 80, 100])
      assert.ok(h.editor.render(width).every((line) => visibleWidth(line) <= width));
  } finally {
    h.close();
  }
});

test("restored history seeds from selected-branch user text but does not create image payloads", () => {
  const manager = SessionManager.inMemory("/fixture");
  const branch = manager.appendMessage({
    role: "user",
    content: "Literal [Image #90]",
    timestamp: 0,
  });
  manager.appendMessage({ role: "user", content: "Other branch [Image #900]", timestamp: 0 });
  manager.branch(branch);
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "[Image #88]" }],
    timestamp: 0,
  });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "[Image #150]" }],
    timestamp: 0,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "fixture",
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  manager.appendMessage({
    role: "toolResult",
    toolCallId: "read",
    toolName: "read",
    content: [{ type: "text", text: "[Image #250]" }],
    timestamp: 0,
    isError: false,
  });
  manager.appendCustomMessageEntry("fixture", "[Image #350]", true);
  for (const content of [null, [null, { type: "text", text: 42 }]])
    manager.appendMessage({ role: "user", content, timestamp: 0 } as unknown as Parameters<
      typeof manager.appendMessage
    >[0]);
  const entries = manager.getBranch();
  const before = structuredClone(entries);
  const h = fixture();
  try {
    h.images.seedHistory(entries);
    assert.equal(h.images.has("[Image #90]"), false);
    assert.equal(
      h.images.transform({ type: "input", source: "interactive", text: "[Image #90]" }, false)
        .action,
      "continue",
    );
    h.paste();
    assert.equal(h.images.display(h.editor.getText()), "[Image #91]");
    assert.deepEqual(entries, before);
    assert.deepEqual(manager.getBranch(), before);
  } finally {
    h.close();
  }
});

test("live text-only messages leave allocation unchanged until a new runtime seeds history", () => {
  const manager = SessionManager.inMemory("/fixture");
  const message = { role: "user" as const, content: "Literal [Image #90]", timestamp: 0 };
  manager.appendMessage(message);
  const h = fixture();
  const resumed = fixture();
  try {
    h.paste();
    h.editor.setText("");
    h.images.reserve(message, false);
    h.images.observe(manager.getBranch());
    h.paste();
    assert.equal(h.images.display(h.editor.getText()), "[Image #2]");
    resumed.images.seedHistory(manager.getBranch());
    resumed.paste();
    assert.equal(resumed.images.display(resumed.editor.getText()), "[Image #91]");
  } finally {
    h.close();
    resumed.close();
  }
});

test("invalid numbering text stays literal and exhausted safe IDs cannot create duplicate attachments", () => {
  const h = fixture();
  try {
    h.editor.setText("[Image #0] [Image #-9] [Image #9007199254740992] ");
    h.paste();
    assert.ok(h.images.display(h.editor.getText()).endsWith("[Image #1]"));
    h.editor.setText("[Image #9007199254740990] ");
    h.paste();
    assert.ok(h.images.display(h.editor.getText()).endsWith("[Image #9007199254740991]"));
    h.editor.setText("");
    h.paste();
    assert.equal(h.editor.getText(), h.path);
    assert.equal(h.images.has(h.editor.getText()), false);
  } finally {
    h.close();
  }
});

test("queue take-back never reattaches a literal label matching an older draft image", () => {
  const h = fixture();
  try {
    h.paste();
    h.editor.setText("");
    const literal = "[Image #1]";
    const event = {
      type: "input" as const,
      text: literal,
      source: "interactive" as const,
      streamingBehavior: "followUp" as const,
    };
    assert.equal(h.images.transform(event, false).action, "continue");
    h.editor.onAction("app.message.dequeue", () => h.editor.setText(literal));
    h.editor.handleInput("\x1b[1;3A");
    assert.equal(h.editor.getText(), literal);
    assert.equal(
      h.images.transform({ ...event, text: h.editor.getExpandedText() }, false).action,
      "continue",
    );
  } finally {
    h.close();
  }
});

test("queue take-back preserves lane order and real/literal collisions through editing and requeue", () => {
  const h = fixture();
  try {
    h.paste();
    const token = h.editor.getText();
    const literal = "[Image #1]";
    h.images.transform(
      { type: "input", text: token, source: "interactive", streamingBehavior: "followUp" },
      false,
    );
    h.images.transform(
      { type: "input", text: literal, source: "interactive", streamingBehavior: "steer" },
      true,
    );
    h.images.transform(
      {
        type: "input",
        text: `paragraph\n\n${token} ${literal}`,
        source: "interactive",
        streamingBehavior: "followUp",
      },
      true,
    );
    h.editor.setText(`draft ${literal}`);
    const visible = [
      literal,
      literal,
      `paragraph\n\n${literal} ${literal}`,
      h.editor.getText(),
    ].join("\n\n");
    h.editor.onAction("app.message.dequeue", () => h.editor.setText(visible));
    h.editor.handleInput("\x1b[1;3A");
    const expected = [literal, token, `paragraph\n\n${token} ${literal}`, `draft ${literal}`].join(
      "\n\n",
    );
    assert.equal(h.editor.getText(), expected);
    h.editor.handleInput(" edited");
    const input = h.images.transform(
      {
        type: "input",
        text: h.editor.getExpandedText(),
        source: "interactive",
        streamingBehavior: "followUp",
      },
      false,
    );
    assert.equal(input.action, "transform");
    if (input.action !== "transform") assert.fail();
    assert.equal(input.images?.length, 1);
    assert.ok(input.images?.every((image) => image.data === png));
    h.editor.setText("");
    h.editor.onAction("app.message.dequeue", () => h.editor.setText(input.text));
    h.editor.handleInput("\x1b[1;3A");
    assert.equal(h.editor.getText(), `${expected} edited`);
  } finally {
    h.close();
  }
});

test("delivered messages remove the matching image payload observation, even with identical labels", () => {
  for (const deliverImage of [true, false]) {
    const h = fixture();
    try {
      h.paste();
      const token = h.editor.getText();
      const literal = "[Image #1]";
      h.images.transform(
        { type: "input", text: literal, source: "interactive", streamingBehavior: "followUp" },
        false,
      );
      h.images.transform(
        { type: "input", text: token, source: "interactive", streamingBehavior: "steer" },
        true,
      );
      h.images.reserve(
        {
          role: "user",
          content: [
            { type: "text", text: literal },
            ...(deliverImage ? [{ type: "image" as const, data: png, mimeType: "image/png" }] : []),
          ],
          timestamp: 0,
        },
        true,
      );
      h.editor.setText("");
      h.editor.onAction("app.message.dequeue", () => h.editor.setText(literal));
      h.editor.handleInput("\x1b[1;3A");
      assert.equal(h.editor.getText(), deliverImage ? literal : token);
    } finally {
      h.close();
    }
  }
});

test("take-back expands the current native collapsed paste without attaching its literal labels", () => {
  const h = fixture();
  try {
    h.paste();
    const token = h.editor.getText();
    h.images.transform(
      { type: "input", text: token, source: "interactive", streamingBehavior: "followUp" },
      false,
    );
    h.editor.setText("");
    const large = "line 中文 [Image #1]\n".repeat(100);
    h.paste(large);
    h.paste();
    const expanded = h.editor.getExpandedText();
    assert.notEqual(expanded, h.editor.getText());
    h.editor.onAction("app.message.dequeue", () =>
      h.editor.setText(`[Image #1]\n\n${h.editor.getText()}`),
    );
    h.editor.handleInput("\x1b[1;3A");
    assert.equal(h.editor.getExpandedText(), `${token}\n\n${expanded}`);
    const result = h.images.transform(
      { type: "input", text: h.editor.getExpandedText(), source: "interactive" },
      false,
    );
    assert.equal(result.action, "transform");
    if (result.action !== "transform") assert.fail();
    assert.equal(result.images?.length, 2);
    assert.ok(result.text.includes(large));
  } finally {
    h.close();
  }
});

test("unknown transformed queued text stays text and reports missing image recovery once", () => {
  const h = fixture();
  try {
    h.paste();
    h.images.transform(
      {
        type: "input",
        text: h.editor.getText(),
        source: "interactive",
        streamingBehavior: "followUp",
      },
      false,
    );
    h.editor.setText("");
    const large = "retained current draft\n".repeat(100);
    h.paste(large);
    const expanded = h.editor.getExpandedText();
    let warnings = 0;
    h.editor.onQueueRestoreUnmatched = () => {
      warnings++;
    };
    h.editor.onAction("app.message.dequeue", () =>
      h.editor.setText(`changed [Image #1]\n\n${h.editor.getText()}`),
    );
    h.editor.handleInput("\x1b[1;3A");
    assert.equal(h.editor.getExpandedText(), `changed [Image #1]\n\n${expanded}`);
    assert.equal(h.images.has(h.editor.getText()), false);
    assert.equal(warnings, 1);
    h.editor.setText("");
    h.editor.onAction("app.message.dequeue", () => h.editor.setText("[Image #1]"));
    h.editor.handleInput("\x1b[1;3A");
    assert.equal(warnings, 1);
    assert.equal(h.editor.getText(), "[Image #1]");
  } finally {
    h.close();
  }
});

test("interrupt delegates the native escape handler and restores queued chips, while help only closes", () => {
  const h = fixture();
  try {
    h.paste();
    const token = h.editor.getText();
    h.images.transform(
      { type: "input", text: token, source: "interactive", streamingBehavior: "followUp" },
      false,
    );
    h.editor.setText("");
    let aborted = 0;
    h.editor.onEscape = () => {
      h.editor.setText("[Image #1]");
      aborted++;
    };
    h.editor.handleInput("?");
    h.editor.handleInput("\x1b");
    assert.equal(aborted, 0);
    h.editor.handleInput("\x1b");
    assert.equal(aborted, 1);
    assert.equal(h.editor.getText(), token);
    for (const width of [12, 40, 80, 100])
      assert.ok(h.editor.render(width).every((line) => visibleWidth(line) <= width));
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

test("literal image labels move and delete atomically while submission remains text only", () => {
  const h = fixture();
  try {
    const text = "Before [Image #999] After";
    h.editor.handleInput(text);
    h.editor.handleInput("\x01");
    for (let index = 0; index < 7; index++) h.editor.handleInput("\x1b[C");
    assert.equal(h.editor.getCursor().col, 7);
    h.editor.handleInput("\x1b[C");
    assert.equal(h.editor.getCursor().col, 19);
    h.editor.handleInput("\x7f");
    assert.equal(h.editor.getText(), "Before  After");
    assert.deepEqual(h.editor.getCursor(), { line: 0, col: 7 });
    h.editor.handleInput("\x1f");
    assert.equal(h.editor.getText(), text);
    assert.equal(h.editor.getCursor().col, 19);
    h.editor.handleInput("\x1b[D");
    assert.equal(h.editor.getCursor().col, 7);
    h.editor.handleInput("\x1b[3~");
    assert.equal(h.editor.getText(), "Before  After");
    h.editor.handleInput("\x1f");
    assert.equal(h.editor.getText(), text);
    assert.equal(h.editor.getCursor().col, 7);
    assert.equal(h.images.has(text), false);
    assert.deepEqual(h.images.transform({ type: "input", text, source: "interactive" }), {
      action: "continue",
    });
    let submitted = "";
    h.editor.onSubmit = (value) => {
      submitted = value;
    };
    h.editor.handleInput("\r");
    assert.equal(submitted, text);
    h.paste();
    assert.equal(h.images.display(h.editor.getText()), "[Image #1]");
  } finally {
    h.close();
  }
});

test("fresh history labels retain native browsing, draft restoration and one-step edit undo", () => {
  const h = fixture();
  try {
    const history = "Before [Image #2][Image #4] After";
    h.editor.addToHistory("Older prompt");
    h.editor.addToHistory(history);
    h.editor.setText("Current draft");
    h.editor.handleInput("\x01");
    h.editor.handleInput("\x1b[A");
    assert.equal(h.editor.getText(), history);
    h.editor.handleInput("\x1b[A");
    assert.equal(h.editor.getText(), "Older prompt");
    h.editor.handleInput("\x1b[B");
    assert.equal(h.editor.getText(), history);
    h.editor.handleInput("\x1b[B");
    assert.equal(h.editor.getText(), "Current draft");
    h.editor.handleInput("\x01");
    h.editor.handleInput("\x1b[A");
    h.editor.handleInput("\x05");
    for (let index = 0; index < 6; index++) h.editor.handleInput("\x1b[D");
    h.editor.handleInput("\x7f");
    assert.equal(h.editor.getText(), "Before [Image #2] After");
    h.editor.handleInput("\x1f");
    assert.equal(h.editor.getText(), history);
    assert.equal(h.images.has(h.editor.getText()), false);
  } finally {
    h.close();
  }
});

test("literal label layout keeps Unicode, narrow widths and vertical cursor positions intact", () => {
  const h = fixture();
  try {
    const text = "中文🙂 12345678[Image #12]suffix";
    h.editor.setText(text);
    for (const width of [1, 2, 3, 4, 8, 14, 22, 40, 100]) {
      const lines = h.editor.render(width);
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
      assert.doesNotMatch(lines.join(""), /[\u{f0000}-\u{ffffd}]/u);
    }
    h.editor.setText("12345678[Image #12]suffix");
    h.editor.render(22);
    const end = h.editor.getCursor();
    h.editor.handleInput("\x1b[A");
    const up = h.editor.getCursor();
    assert.ok(up.col <= 8 || up.col >= 19);
    h.editor.handleInput("\x1b[B");
    assert.deepEqual(h.editor.getCursor(), end);
    assert.equal(h.editor.getText(), "12345678[Image #12]suffix");
  } finally {
    h.close();
  }
});

test("literal label edits retain real image identities and native collapsed-paste undo", () => {
  const h = fixture();
  try {
    h.paste();
    const image = h.editor.getText();
    h.editor.handleInput(" [Image #1]");
    h.editor.handleInput("\x7f");
    assert.equal(h.editor.getText(), `${image} `);
    h.editor.handleInput("\x1f");
    assert.equal(h.editor.getText(), `${image} [Image #1]`);
    const transformed = h.images.transform({
      type: "input",
      text: h.editor.getText(),
      source: "interactive",
    });
    assert.equal(transformed.action, "transform");
    if (transformed.action !== "transform") assert.fail();
    assert.equal(transformed.images?.length, 1);
    assert.equal(transformed.images?.[0].data, png);
    const large = "pasted line\n".repeat(20);
    h.paste(large);
    h.editor.handleInput(" [Image #999]");
    const expanded = h.editor.getExpandedText();
    h.editor.handleInput("\x7f");
    assert.ok(h.editor.getExpandedText().includes(large));
    h.editor.handleInput("\x1f");
    assert.equal(h.editor.getExpandedText(), expanded);
  } finally {
    h.close();
  }
});

test("word movement and remapped arrows cannot strand the cursor inside a literal label", () => {
  const h = fixture();
  const bindings = keys.getUserBindings();
  try {
    h.editor.setText("中文\nBefore [Image #12]");
    h.editor.handleInput("\x1bb");
    assert.deepEqual(h.editor.getCursor(), { line: 1, col: 7 });
    h.editor.handleInput("\x1bf");
    assert.deepEqual(h.editor.getCursor(), { line: 1, col: 18 });
    keys.setUserBindings({ "tui.editor.cursorLeft": "h", "tui.editor.cursorRight": "l" });
    h.editor.handleInput("h");
    assert.deepEqual(h.editor.getCursor(), { line: 1, col: 7 });
    h.editor.handleInput("l");
    assert.deepEqual(h.editor.getCursor(), { line: 1, col: 18 });
    h.editor.handleInput("\x7f");
    assert.equal(h.editor.getText(), "中文\nBefore ");
    assert.deepEqual(h.editor.getCursor(), { line: 1, col: 7 });
    h.editor.handleInput("\x1f");
    assert.equal(h.editor.getText(), "中文\nBefore [Image #12]");
  } finally {
    keys.setUserBindings(bindings);
    h.close();
  }
});
