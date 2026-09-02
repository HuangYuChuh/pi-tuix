import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSubagentActivityObserver } from "../extensions/session/subagent-activity.ts";

test("subagent activity observes optional lifecycle events without RPC calls", () => {
  const handlers = new Map<string, (data: unknown) => void>();
  const rpcCalls = 0;
  const pi = {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        handlers.set(channel, handler);
        return () => handlers.delete(channel);
      },
    },
  } as unknown as ExtensionAPI;
  const observer = createSubagentActivityObserver(pi);
  let changes = 0;
  observer.setOnChange(() => {
    changes += 1;
  });

  handlers.get("subagents:rpc:v1:ready")?.({});
  handlers.get("subagent:async-started")?.({
    id: "run-1",
    agent: "reviewer",
    goal: "Inspect changes",
  });
  assert.deepEqual(observer.getState(), {
    available: true,
    activities: [{ id: "run-1", agent: "reviewer", task: "Inspect changes", status: "running" }],
  });

  handlers.get("subagent:async-complete")?.({ runId: "run-1", success: true });
  assert.equal(observer.getState().activities[0]?.status, "completed");
  assert.equal(changes, 3);
  assert.equal(rpcCalls, 0);

  observer.dispose();
  assert.equal(handlers.size, 0);
});

test("subagent activity records failures and resets task state per session", () => {
  const handlers = new Map<string, (data: unknown) => void>();
  const pi = {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        handlers.set(channel, handler);
        return () => handlers.delete(channel);
      },
    },
  } as unknown as ExtensionAPI;
  const observer = createSubagentActivityObserver(pi);
  handlers.get("subagents:rpc:v1:ready")?.({});
  handlers.get("subagent:async-started")?.({ runId: "run-2", task: "Run tests" });
  handlers.get("subagent:async-complete")?.({
    runId: "run-2",
    success: false,
    summary: "Tests failed",
  });

  assert.equal(observer.getState().activities[0]?.status, "failed");
  observer.reset();
  assert.equal(observer.getState().available, true);
  assert.deepEqual(observer.getState().activities, []);
});

test("subagent activity degrades cleanly when the event bus is unavailable", () => {
  const observer = createSubagentActivityObserver({} as ExtensionAPI);
  assert.deepEqual(observer.getState(), { available: false, activities: [] });
  observer.reset();
  observer.dispose();
});
