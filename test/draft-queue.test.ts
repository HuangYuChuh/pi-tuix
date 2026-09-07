import assert from "node:assert/strict";
import test from "node:test";
import { DraftQueue } from "../extensions/shell/open-tui/draft-queue.ts";

const draft = { raw: "", expanded: "" };
const imageInput = {
  type: "input" as const,
  source: "interactive" as const,
  text: "owned token",
  streamingBehavior: "followUp" as const,
};

test("public empty-queue observations discard stale inputs before another input or delivery", () => {
  const queue = new DraftQueue();
  for (const emptyEvent of ["input", "delivery"]) {
    queue.observe(imageInput, "[Image #1]", [], false);
    if (emptyEvent === "delivery") queue.delivered("another message", [], false);
    else queue.observe({ ...imageInput, text: "[Image #1]" }, "[Image #1]", [], false);
    assert.deepEqual(queue.restore("[Image #1]", draft), { text: "[Image #1]", unmatched: false });
  }
});

test("observation bounds discard partial matches and recover after clear", () => {
  for (const overflow of ["count", "characters"]) {
    const queue = new DraftQueue();
    queue.observe(imageInput, "[Image #1]", [], false);
    if (overflow === "count") {
      for (let index = 0; index < 256; index++)
        queue.observe({ ...imageInput, text: "x" }, "x", [], true);
    } else queue.observe({ ...imageInput, text: "x".repeat(8 * 1024 * 1024) }, "x", [], true);
    assert.deepEqual(queue.restore("[Image #1]", draft), { text: "[Image #1]", unmatched: true });
    queue.observe(imageInput, "[Image #1]", [], false);
    assert.deepEqual(queue.restore("[Image #1]", draft), { text: "owned token", unmatched: false });
  }
});

test("indistinguishable delivered payloads retire steering observations before follow-ups", () => {
  const queue = new DraftQueue();
  const images = [{ type: "image" as const, mimeType: "image/png", data: "same bytes" }];
  queue.observe(imageInput, "[Image #1]", images, false);
  queue.observe(
    { ...imageInput, text: "[Image #1]", streamingBehavior: "steer" },
    "[Image #1]",
    images,
    true,
  );
  queue.delivered("[Image #1]", images, true);
  assert.deepEqual(queue.restore("[Image #1]", draft), { text: "owned token", unmatched: false });
});
