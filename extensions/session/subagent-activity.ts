import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type SubagentStatus = "running" | "completed" | "failed";

export interface SubagentActivity {
  id: string;
  agent: string;
  task: string;
  status: SubagentStatus;
}

export interface SubagentActivityState {
  available: boolean;
  activities: readonly SubagentActivity[];
}

const READY_EVENT = "subagents:rpc:v1:ready";
const STARTED_EVENT = "subagent:async-started";
const COMPLETE_EVENT = "subagent:async-complete";
const MAX_ACTIVITIES = 4;
const MAX_TEXT = 120;

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_TEXT) : fallback;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function createSubagentActivityState(): SubagentActivityState {
  return { available: false, activities: [] };
}

export interface SubagentActivityObserver {
  getState: () => SubagentActivityState;
  reset: () => void;
  dispose: () => void;
  setOnChange: (handler: (() => void) | undefined) => void;
}

export function createSubagentActivityObserver(pi: ExtensionAPI): SubagentActivityObserver {
  const state = createSubagentActivityState();
  const activities = new Map<string, SubagentActivity>();
  const unsubscribers: Array<() => void> = [];
  let onChange: (() => void) | undefined;
  let anonymousSequence = 0;

  const publish = () => {
    state.activities = Array.from(activities.values()).slice(-MAX_ACTIVITIES);
    onChange?.();
  };
  const subscribe = (event: string, handler: (data: unknown) => void) => {
    const events = pi.events;
    if (!events || typeof events.on !== "function") return;
    unsubscribers.push(events.on(event, handler));
  };

  subscribe(READY_EVENT, () => {
    state.available = true;
    publish();
  });
  subscribe(STARTED_EVENT, (data) => {
    const value = object(data);
    state.available = true;
    const id = text(value?.id ?? value?.runId, `anonymous-${++anonymousSequence}`);
    activities.set(id, {
      id,
      agent: text(value?.agent, "subagent"),
      task: text(value?.goal ?? value?.task, "working"),
      status: "running",
    });
    publish();
  });
  subscribe(COMPLETE_EVENT, (data) => {
    const value = object(data);
    state.available = true;
    const explicitId = text(value?.id ?? value?.runId, "");
    const id =
      explicitId ||
      Array.from(activities.keys()).find((key) => key.startsWith("anonymous-")) ||
      `anonymous-${++anonymousSequence}`;
    const previous = activities.get(id);
    const success =
      value?.success === true ||
      value?.state === "complete" ||
      value?.status === "completed" ||
      value?.status === "complete";
    activities.set(id, {
      id,
      agent: previous?.agent ?? text(value?.agent, "subagent"),
      task: previous?.task ?? text(value?.summary, "finished"),
      status: success ? "completed" : "failed",
    });
    publish();
  });

  return {
    getState: () => state,
    reset: () => {
      activities.clear();
      anonymousSequence = 0;
      publish();
    },
    setOnChange: (handler) => {
      onChange = handler;
    },
    dispose: () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      unsubscribers.length = 0;
      onChange = undefined;
    },
  };
}
