import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { collectImages } from "../extensions/session/image-attachments.ts";
import {
  IMAGE_NUMBERS_ENTRY_TYPE,
  ImageNumberObservations,
  imageContentFingerprint,
  readImageNumberData,
  withImageNumberMetadata,
} from "../extensions/session/image-number-metadata.ts";

const image = { type: "image" as const, mimeType: "image/png", data: "original-image-bytes" };
const message = {
  role: "user" as const,
  timestamp: 123,
  content: [{ type: "text" as const, text: "Literal [Image #300] [Image #301]" }, image],
};
const metadata = () => ({
  version: 1 as const,
  timestamp: message.timestamp,
  fingerprint: imageContentFingerprint(message.content) as string,
  numbers: [301],
});

test("image number metadata disambiguates literal labels without entering model context", () => {
  const manager = SessionManager.inMemory("/fixture");
  const input = structuredClone(message);
  const data = metadata();
  manager.appendCustomEntry(IMAGE_NUMBERS_ENTRY_TYPE, data);
  manager.appendCustomEntry("another-extension", { display: true });
  manager.appendMessage(input);
  const before = structuredClone(manager.getEntries());
  const images = collectImages(manager.buildContextEntries());
  assert.deepEqual(
    images.map(({ number, inline }) => [number, inline]),
    [[301, true]],
  );
  assert.deepEqual(manager.buildSessionContext().messages, [input]);
  assert.deepEqual(manager.getEntries(), before);
  assert.deepEqual(input, message);
  assert.doesNotMatch(JSON.stringify(data), /original-image-bytes|Literal|image\/png|fixture/);
});

test("metadata is bound to the next user message, timestamp, image count and exact payload", () => {
  for (const invalid of [
    { ...metadata(), timestamp: 124 },
    { ...metadata(), fingerprint: "a".repeat(64) },
    { ...metadata(), numbers: [301, 302] },
    { ...metadata(), version: 2 },
    { ...metadata(), numbers: [-1] },
  ]) {
    const manager = SessionManager.inMemory("/fixture");
    manager.appendCustomEntry(IMAGE_NUMBERS_ENTRY_TYPE, invalid);
    manager.appendMessage(message);
    assert.equal(collectImages(manager.getBranch())[0].number, 1);
  }
  const manager = SessionManager.inMemory("/fixture");
  manager.appendCustomEntry(IMAGE_NUMBERS_ENTRY_TYPE, metadata());
  manager.appendMessage({ role: "user", timestamp: 122, content: "intervening user" });
  manager.appendMessage(message);
  assert.equal(collectImages(manager.getBranch())[0].number, 1);
  assert.notEqual(imageContentFingerprint([...message.content].reverse()), metadata().fingerprint);
  assert.notEqual(imageContentFingerprint([image, image]), imageContentFingerprint([image]));
  assert.notEqual(
    imageContentFingerprint([{ ...image, mimeType: "image/gif" }]),
    imageContentFingerprint([image]),
  );
  assert.notEqual(
    imageContentFingerprint([{ type: "text", text: "ab" }]),
    imageContentFingerprint([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]),
  );
  assert.equal(
    imageContentFingerprint("abc"),
    imageContentFingerprint([{ type: "text", text: "abc" }]),
  );
  for (const malformed of [null, {}, [null], [{ type: "text", text: 3 }], [{ type: "toolCall" }]])
    assert.equal(imageContentFingerprint(malformed), undefined);
});

test("imported number metadata is bounded and copied without trusting extra fields", () => {
  for (const invalid of [
    null,
    [],
    {},
    { ...metadata(), timestamp: -1 },
    { ...metadata(), timestamp: Infinity },
    { ...metadata(), fingerprint: "A".repeat(64) },
    { ...metadata(), numbers: [] },
    { ...metadata(), numbers: [null] },
    { ...metadata(), numbers: [0] },
    { ...metadata(), numbers: [1.5] },
    { ...metadata(), numbers: [Number.MAX_SAFE_INTEGER + 1] },
    { ...metadata(), numbers: ["301"] },
    { ...metadata(), numbers: Array(65537).fill(1) },
  ])
    assert.equal(readImageNumberData(invalid), undefined);
  const source = { ...metadata(), numbers: [null, 301], ignored: "extra" };
  const result = readImageNumberData(source);
  assert.deepEqual(result, { ...metadata(), numbers: [null, 301] });
  source.numbers[1] = 1;
  assert.deepEqual(result?.numbers, [null, 301]);
});

test("delivery observations match content independently of queue order and reset on take-back", () => {
  const observer = new ImageNumberObservations();
  const second = [...message.content, { type: "text", text: "follow-up" }];
  observer.remember(message.content, [301], false);
  observer.remember(second, [302], true);
  assert.deepEqual(observer.delivered(second, 124, true)?.numbers, [302]);
  assert.deepEqual(observer.delivered(message.content, 123, false), metadata());
  assert.equal(observer.delivered(message.content, 123, false), undefined);
  observer.remember(message.content, [301], false);
  assert.equal(
    observer.delivered([{ type: "text", text: "transformed" }, image], 123, false),
    undefined,
  );
  assert.equal(observer.delivered(message.content, 123, false), undefined);
  observer.remember(message.content, [301], false);
  observer.clear();
  assert.equal(observer.delivered(message.content, 123, false), undefined);
  observer.remember(message.content, [null], false);
  assert.equal(observer.delivered(message.content, 123, false), undefined);
});

test("ambiguous or overflowing observations fall back until a clear queue resets them", () => {
  const observer = new ImageNumberObservations();
  observer.remember(message.content, [301], false);
  observer.remember(message.content, [302], true);
  assert.equal(observer.delivered(message.content, 123, true), undefined);
  assert.equal(observer.delivered(message.content, 123, true), undefined);
  observer.remember(message.content, [301], true);
  observer.remember(message.content, [301], true);
  assert.deepEqual(observer.delivered(message.content, 123, true)?.numbers, [301]);
  assert.deepEqual(observer.delivered(message.content, 123, false)?.numbers, [301]);
  for (let index = 0; index < 257; index++) observer.remember(message.content, [301], true);
  assert.equal(observer.delivered(message.content, 123, true), undefined);
  observer.remember(message.content, [301], true);
  assert.equal(observer.delivered(message.content, 123, true), undefined);
  observer.remember(message.content, [301], false);
  assert.deepEqual(observer.delivered(message.content, 123, false)?.numbers, [301]);
  observer.remember(message.content, Array(65537).fill(301), false);
  assert.equal(observer.delivered(message.content, 123, true), undefined);
});

test("compaction retains only matching ancestor metadata in the presentation projection", () => {
  const manager = SessionManager.inMemory("/fixture");
  manager.appendMessage({ role: "user", timestamp: 0, content: "old" });
  const annotationId = manager.appendCustomEntry(IMAGE_NUMBERS_ENTRY_TYPE, metadata());
  const userId = manager.appendMessage(message);
  manager.appendCompaction("summary", userId, 1000);
  const context = manager.buildContextEntries();
  assert.ok(!context.some((entry) => entry.id === annotationId));
  const before = structuredClone(manager.getEntries());
  const restored = withImageNumberMetadata(context, manager.getEntries());
  assert.equal(collectImages(restored)[0].number, 301);
  assert.deepEqual(
    restored.flatMap(sessionEntryToContextMessages),
    context.flatMap(sessionEntryToContextMessages),
  );
  assert.deepEqual(withImageNumberMetadata(restored, manager.getEntries()), restored);
  assert.deepEqual(manager.getEntries(), before);
  // A foreign annotation on a sibling path cannot affect the selected message.
  manager.branch(annotationId);
  const other = { ...message, timestamp: 124 };
  const sibling = manager.appendMessage(other);
  manager.appendCompaction("summary", sibling, 1000);
  const selected = withImageNumberMetadata(manager.buildContextEntries(), manager.getEntries());
  assert.equal(collectImages(selected)[0].number, 1);
  assert.ok(!selected.some((entry) => entry.id === userId));
});
