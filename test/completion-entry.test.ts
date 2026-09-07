import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSessionContext,
  type CustomEntry,
  type EntryRenderer,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Spacer,
  Text,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
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
  assert.deepEqual(readCompletionEntry({ ...data, gitBranch: "feat/历史" }), {
    ...data,
    gitBranch: "feat/历史",
  });
  for (const gitBranch of [null, 1, "", "\x1b[31mbranch", "main\nnext", "x".repeat(1025)])
    assert.deepEqual(readCompletionEntry({ ...data, gitBranch }), data);
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
  assert.deepEqual(renderer(entry, { expanded: false }, theme)?.render(100), []);
  enabled = true;
  assert.ok(renderer(entry, { expanded: true }, theme));
  assert.equal(renderer({ ...entry, data: { version: 9 } }, { expanded: false }, theme), undefined);
});

test("disabled startup hides host entry spacing and restores history without a session rebuild", async () => {
  let enabled = false;
  let renderer: EntryRenderer | undefined;
  const runtime = registerCompletionEntries(
    {
      registerEntryRenderer: (_name, value) => {
        renderer = value as EntryRenderer;
      },
    } as ExtensionAPI,
    () => enabled,
    () => true,
  );
  const theme = { fg: (_color: string, value: string) => value } as Theme;
  const history = new Container();
  const before = new Text("Before", 0, 0);
  const after = new Text("After", 0, 0);
  const hostEntry = () => {
    const component = renderer?.(entry, { expanded: false }, theme);
    assert.ok(component, "a disabled renderer must still keep its host entry mounted");
    const host = new Container();
    host.addChild(new Spacer(1));
    host.addChild(component);
    return host;
  };
  const saved = hostEntry();
  history.children = [before, saved, after];
  const root = new Container();
  root.addChild(history);
  const tui = Object.assign(root, { requestRender() {} }) as unknown as TUI;
  let widget: (Component & { dispose?: () => void }) | undefined;
  const ctx = {
    mode: "tui",
    ui: {
      setWidget(_key: string, factory: ((ui: TUI) => Component) | undefined) {
        widget?.dispose?.();
        widget = factory?.(tui);
      },
    },
  } as unknown as ExtensionContext;
  runtime.attach(ctx);
  await Promise.resolve();
  assert.deepEqual(widget?.render(100), []);
  assert.deepEqual(
    history.render(100).map((line) => line.trimEnd()),
    ["Before", "After"],
  );
  enabled = true;
  runtime.refresh();
  await Promise.resolve();
  const showing = history.render(100);
  assert.equal(showing.length, 4);
  assert.equal(showing[1].trim(), "");
  assert.match(showing[2], /^\* Worked/);
  const wrapper = history.children[1];
  assert.ok(wrapper instanceof Container);
  assert.equal(wrapper.children[0], saved, "host source identity stays mounted");
  history.addChild(hostEntry());
  await Promise.resolve();
  assert.equal(history.render(100).length, 6, "entries appended later are also composed");
  enabled = false;
  runtime.refresh();
  await Promise.resolve();
  assert.deepEqual(
    history.render(100).map((line) => line.trimEnd()),
    ["Before", "After"],
  );
  history.children.reverse();
  runtime.detach(ctx);
  assert.equal(history.children[2], saved, "cleanup preserves later host reordering");
  assert.equal(root.children[0], history);
});
