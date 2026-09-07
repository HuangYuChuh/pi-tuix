import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSessionContext,
  type CustomEntry,
  type EntryRenderer,
  type ExtensionAPI,
  type SessionEntry,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  COMPLETION_ENTRY_TYPE,
  readCompletionEntry,
  registerCompletionEntries,
} from "../extensions/stream/completion-entry.ts";

const data = {
  version: 1,
  durationMs: 2300,
  finishedAt: 1700000000000,
  outcome: "done",
  failedTools: 0,
};
const entry: CustomEntry = {
  type: "custom",
  id: "completion",
  parentId: "user",
  timestamp: new Date(0).toISOString(),
  customType: COMPLETION_ENTRY_TYPE,
  data,
};

test("completion metadata rejects malformed imports and unsupported schema versions", () => {
  assert.deepEqual(readCompletionEntry(data), data);
  for (const invalid of [
    undefined,
    null,
    [],
    "text",
    {},
    { ...data, version: 2 },
    { ...data, durationMs: -1 },
    { ...data, durationMs: Infinity },
    { ...data, finishedAt: NaN },
    { ...data, finishedAt: 1e20 },
    { ...data, finishedAt: "today" },
    { ...data, failedTools: -1 },
    { ...data, failedTools: 1.5 },
    { ...data, failedTools: Infinity },
    { ...data, outcome: "unknown" },
  ])
    assert.equal(readCompletionEntry(invalid), undefined);
});

test("public Pi context building excludes completion metadata and follows the selected branch", () => {
  const user: SessionEntry = {
    type: "message",
    id: "user",
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message: { role: "user", content: "Original request", timestamp: 0 },
  };
  const history = [user, entry];
  assert.deepEqual(buildSessionContext(history).messages, [user.message]);
  assert.deepEqual(buildSessionContext(history, user.id).messages, [user.message]);
  assert.deepEqual(buildSessionContext(history).messages, buildSessionContext([user]).messages);
});

test("entry rendering is reversible, width-bounded, ASCII-aware and ignores unknown records", () => {
  let enabled = true;
  let ascii = false;
  let renderer: EntryRenderer | undefined;
  registerCompletionEntries(
    {
      registerEntryRenderer(name, value) {
        assert.equal(name, COMPLETION_ENTRY_TYPE);
        renderer = value as EntryRenderer;
      },
    } as ExtensionAPI,
    () => enabled,
    () => ascii,
  );
  assert.ok(renderer);
  const theme = { fg: (_color: string, text: string) => text } as Theme;
  const component = renderer(entry, { expanded: false }, theme);
  assert.ok(component);
  for (const width of [0, 1, 4, 12, 40, 80, 100])
    assert.ok(component.render(width).every((line) => visibleWidth(line) <= width));
  assert.match(component.render(100)[0], /^✻ Worked for 2s/);
  ascii = true;
  assert.match(component.render(100)[0], /^\* Worked for 2s/);
  enabled = false;
  assert.deepEqual(component.render(100), []);
  assert.equal(renderer(entry, { expanded: false }, theme), undefined);
  enabled = true;
  assert.ok(renderer(entry, { expanded: true }, theme));
  assert.equal(renderer({ ...entry, data: { version: 9 } }, { expanded: false }, theme), undefined);
});
