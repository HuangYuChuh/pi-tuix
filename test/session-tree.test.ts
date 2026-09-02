import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTreeNode } from "@earendil-works/pi-coding-agent";
import { flattenSessionTree } from "../extensions/session/session-tree.ts";

function node(
  entry: { type: string; id: string; [key: string]: unknown },
  children: SessionTreeNode[] = [],
): SessionTreeNode {
  return { entry: entry as unknown as SessionTreeNode["entry"], children };
}

test("flattenSessionTree preserves hierarchy and marks the active leaf", () => {
  const tree = [
    node(
      {
        type: "message",
        id: "user-1",
        timestamp: "2026-01-01T10:00:00.000Z",
        message: { role: "user", content: "Inspect the project" },
      },
      [
        node({
          type: "message",
          id: "assistant-1",
          timestamp: "2026-01-01T10:01:00.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "I will inspect it." }] },
        }),
      ],
    ),
  ];

  assert.deepEqual(
    flattenSessionTree(tree, "assistant-1").map(({ id, depth, current, label }) => ({
      id,
      depth,
      current,
      label,
    })),
    [
      { id: "user-1", depth: 0, current: false, label: "You: Inspect the project" },
      { id: "assistant-1", depth: 1, current: true, label: "  Pi: I will inspect it." },
    ],
  );
});

test("flattenSessionTree handles non-text agent messages and metadata entries", () => {
  const tree = [
    node({
      type: "message",
      id: "bash-1",
      timestamp: "2026-01-01T10:00:00.000Z",
      message: {
        role: "bashExecution",
        command: "pwd",
        output: "C:/project",
        exitCode: 0,
        cancelled: false,
        truncated: false,
      },
    }),
    node({
      type: "model_change",
      id: "model-1",
      timestamp: "2026-01-01T10:01:00.000Z",
      provider: "openai",
      modelId: "gpt-5",
    }),
    node({
      type: "custom_message",
      id: "custom-1",
      timestamp: "2026-01-01T10:02:00.000Z",
      customType: "progress",
      content: [],
      display: true,
    }),
  ];

  const flattened = flattenSessionTree(tree, null);
  assert.equal(flattened[0]?.label, "bashExecution: (empty entry)");
  assert.equal(flattened[1]?.label, "Model: openai/gpt-5");
  assert.equal(flattened[2]?.label, "progress: (empty entry)");
});
