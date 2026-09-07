import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { collectImages, SessionImageCache } from "../extensions/session/image-attachments.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=";
const image = (data = png, mimeType = "image/png") => ({ type: "image" as const, data, mimeType });
const entry = (id: string, content = [image()]): Extract<SessionEntry, { type: "message" }> => ({
  type: "message",
  id,
  parentId: null,
  timestamp: new Date(0).toISOString(),
  message: { role: "user", timestamp: 0, content },
});

test("only visible user attachments consume numbers, including repeated bytes", () => {
  const source: SessionEntry[] = [
    entry("one"),
    {
      type: "custom_message",
      id: "hidden",
      parentId: null,
      timestamp: new Date(0).toISOString(),
      customType: "hidden",
      content: [image()],
      display: false,
    },
    {
      ...entry("also-hidden"),
      message: {
        role: "custom",
        customType: "hidden",
        content: [image()],
        display: false,
        timestamp: 0,
      },
    },
    entry("one:two", [image(), image("invalid")]),
    {
      ...entry("tool"),
      message: {
        role: "toolResult",
        toolCallId: "read",
        toolName: "read",
        content: [image()],
        isError: false,
        timestamp: 0,
      },
    },
    {
      type: "custom_message",
      id: "visible-custom",
      parentId: null,
      timestamp: new Date(0).toISOString(),
      customType: "notice",
      content: [image()],
      display: true,
    },
    entry("after-tool"),
  ];
  const before = structuredClone(source);
  assert.deepEqual(
    collectImages(source).map(({ entryId, key, number }) => ({ entryId, key, number })),
    [
      { entryId: "one", key: "one:0", number: 1 },
      { entryId: "one:two", key: "one:two:0", number: 2 },
      { entryId: "one:two", key: "one:two:1", number: 3 },
      { entryId: "tool", key: "tool:0", number: undefined },
      { entryId: "visible-custom", key: "visible-custom:0", number: undefined },
      { entryId: "after-tool", key: "after-tool:0", number: 4 },
    ],
  );
  assert.deepEqual(source, before);
});

test("image assets preserve bytes, use private files, share duplicate content and clean up on shutdown", async () => {
  const cache = new SessionImageCache();
  const source = [entry("one"), entry("two")];
  const before = structuredClone(source);
  let path: string | undefined;
  try {
    const [links, concurrent] = await Promise.all([
      cache.prepare(source, new AbortController().signal),
      cache.prepare(source, new AbortController().signal),
    ]);
    assert.equal(links.size, 2);
    assert.deepEqual(links, concurrent);
    assert.equal(links.get("one:0"), links.get("two:0"));
    const target = links.get("one:0");
    assert.ok(target);
    const url = new URL(target);
    assert.equal(url.protocol, "file:");
    path = fileURLToPath(url);
    assert.deepEqual(await readFile(path), Buffer.from(png, "base64"));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
    assert.deepEqual(source, before);
  } finally {
    await cache.dispose();
  }
  assert.ok(path);
  await assert.rejects(access(path), { code: "ENOENT" });
  await assert.rejects(access(dirname(path)), { code: "ENOENT" });
  await assert.rejects(cache.prepare(source, new AbortController().signal), /closed/);
  await cache.dispose();
});

test("unsupported, absent, mismatched and malformed media keep labels without creating links", async () => {
  const cache = new SessionImageCache();
  const invalid = [
    image(""),
    image("not base64"),
    image("\x1b]0;bad\x07"),
    image("a"),
    image(Buffer.from("<svg></svg>").toString("base64"), "image/svg+xml"),
    image(png, "image/jpeg"),
    image(png.slice(0, 12)),
    image("A".repeat(28 * 1024 * 1024 + 1)),
  ];
  try {
    const source = [entry("invalid", invalid), entry("valid")];
    const links = await cache.prepare(source, new AbortController().signal);
    assert.deepEqual([...links.keys()], ["valid:0"]);
    assert.equal(collectImages(source).at(-1)?.number, invalid.length + 1);
  } finally {
    await cache.dispose();
  }
});

test("aborted preparations reject before and during file I/O and shutdown waits for pending work", async () => {
  for (const when of ["before", "during", "shutdown"] as const) {
    const cache = new SessionImageCache();
    const controller = new AbortController();
    if (when === "before") controller.abort();
    const pending = cache.prepare([entry("one")], controller.signal);
    const rejected = assert.rejects(
      pending,
      when === "shutdown" ? /closed/ : { name: "AbortError" },
    );
    if (when === "during") controller.abort();
    if (when === "shutdown") await cache.dispose();
    await rejected;
    await cache.dispose();
  }
});

test("malformed text blocks in imported image messages do not break attachment collection", () => {
  const source = {
    ...entry("imported"),
    message: { role: "user", timestamp: 0, content: [null, { type: "text", text: 42 }, image()] },
  } as unknown as SessionEntry;
  const images = collectImages([source]);
  assert.equal(images.length, 1);
  assert.equal(images[0].number, 1);
});
