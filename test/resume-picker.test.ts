import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionInfo,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  type Terminal,
  Text,
  TuiAltScreen,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { PrepareImages } from "../extensions/session/image-attachments.ts";
import type { renameSession } from "../extensions/session/rename-session.ts";
import {
  formatSessionSize,
  ResumePicker,
  registerResumePicker,
} from "../extensions/session/resume-picker.ts";
import type {
  SessionMetadata,
  SessionPreviewSnapshot,
} from "../extensions/session/session-preview.ts";

const now = new Date("2026-09-07T04:00:00Z").getTime();
function session(index: number, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: `session-${index}`,
    path: `/sessions/session-${index}.jsonl`,
    cwd: "/project",
    name: `Session ${index}`,
    firstMessage: `Request ${index}`,
    allMessagesText: `Request ${index}\nResponse ${index}`,
    created: new Date(now - 600000),
    modified: new Date(now - index * 60000),
    messageCount: 2,
    ...overrides,
  };
}
const sessions = [session(1), session(2), session(3)];
const theme = {
  fg: (_color: string, text: string) => `\x1b[36m${text}\x1b[39m`,
  bg: (_color: string, text: string) => `\x1b[48;5;236m${text}\x1b[49m`,
  inverse: (text: string) => `\x1b[7m${text}\x1b[27m`,
  bold: (text: string) => text,
} as Theme;
function setup(rows = 40, ascii = false) {
  const selected: (string | undefined)[] = [];
  const scopes: boolean[] = [];
  const view = new ResumePicker({
    theme,
    ascii,
    cwd: "/project",
    currentPath: sessions[0].path,
    getRows: () => rows,
    now: () => now,
    done: (path) => selected.push(path),
    onScopeChange: (all) => scopes.push(all),
  });
  view.setSessions(sessions);
  return { view, selected, scopes };
}
const text = (view: ResumePicker, width = 100) =>
  view.render(width).map(stripTerminalSequences).join("\n");
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("resume search filters conversation text, preserves native paste editing and confirms in two steps", () => {
  const { view, selected } = setup();
  view.setSessions([session(1), session(2, { allMessagesText: "The hidden needle 中文" })]);
  assert.match(text(view), /❯ Session 1 \[current\]/);
  assert.match(text(view), /1 minute ago/);
  view.handleInput("\x1b[200~needle 中文\x1b[201~");
  assert.doesNotMatch(text(view), /Session 1/);
  assert.match(text(view), /Session 2/);
  assert.doesNotMatch(text(view), /❯ Session 2/);
  view.handleInput("\r");
  assert.match(text(view), /❯ Session 2/);
  assert.deepEqual(selected, []);
  view.handleInput("\r");
  view.handleInput("\r");
  assert.deepEqual(selected, [sessions[1].path]);
});

test("resume preview scrolls text without switching and Escape returns through search and list", () => {
  const { view, selected } = setup(12);
  view.setSessions([
    session(1, {
      allMessagesText: Array.from({ length: 30 }, (_, i) => `Line ${i}`).join("\n"),
    }),
  ]);
  view.handleInput(" ");
  assert.match(text(view), /Session preview/);
  assert.match(text(view), /Line 0\n/);
  view.handleInput("\x1b[6~");
  assert.doesNotMatch(text(view), /Line 0\n/);
  assert.deepEqual(selected, []);
  view.handleInput("\x1b");
  assert.match(text(view), /Resume session/);
  view.handleInput("absent");
  assert.match(text(view), /No matching sessions/);
  view.handleInput("\r");
  assert.deepEqual(selected, []);
  view.handleInput("\x1b");
  assert.match(text(view), /Session 1/);
  view.handleInput("\x1b");
  assert.match(text(view), /❯ Session 1/);
  view.handleInput("\x1b");
  assert.deepEqual(selected, [undefined]);
});

test("resume rows deduplicate paths, sort recent sessions, wrap navigation and select visible rows", () => {
  const { view, selected } = setup(12);
  const items = Array.from({ length: 40 }, (_, i) => session(i + 1));
  view.setSessions([...items].reverse().concat(items[1]));
  assert.match(text(view), /❯ Session 1/);
  view.handleInput("\x1b[A");
  assert.match(text(view), /❯ Session 40/);
  view.handleInput("\x1b[B");
  assert.match(text(view), /❯ Session 1/);
  view.handleInput("\x1b[6~");
  assert.match(text(view), /❯ Session 10/);
  view.handleInput("\r");
  assert.deepEqual(selected, [items[9].path]);
});

test("resume view bounds ANSI/CJK output and preview for tiny, narrow and short terminals", () => {
  for (const rows of [1, 2, 3, 4, 8, 12, 14, 24, 40]) {
    for (const ascii of [false, true]) {
      const { view } = setup(rows, ascii);
      view.setSessions(
        Array.from({ length: 30 }, (_, i) =>
          session(i + 1, {
            name: `中文条目${i} ${"title ".repeat(12)}\x1b[31mred\x1b[0m`,
            allMessagesText: "中文\x1b]0;untrusted title\x07 body\ttext\n".repeat(40),
          }),
        ),
      );
      for (const input of ["", "\x1b[A", " ", "\x1b", "/", "\x1b[200~中文\x1b[201~"]) {
        if (input) view.handleInput(input);
        for (const width of [0, 1, 2, 4, 12, 16, 24, 40, 80, 100, 120]) {
          const lines = view.render(width);
          assert.ok(lines.length <= rows, `${rows} rows, ${width} columns, ${input}`);
          assert.ok(
            lines.every((line) => visibleWidth(line) <= width),
            `${rows}x${width}: ${input}`,
          );
          assert.ok(lines.every((line) => !line.includes("\x1b]0;") && !line.includes("\x1b[31m")));
          if (ascii) assert.doesNotMatch(lines.join("\n"), /[❯⌕╭╮╰╯─▔·]/);
        }
      }
    }
  }
});

type View = { handleInput(data: string): void; render(width: number): string[] };
function harness(
  options: {
    failure?: boolean;
    cancelSwitch?: boolean;
    current?: string;
    list?: () => Promise<SessionInfo[]>;
    customFailure?: boolean;
    resumeFailure?: boolean;
    readPreview?: (session: SessionInfo, signal: AbortSignal) => Promise<SessionPreviewSnapshot>;
    readMetadata?: (session: SessionInfo, signal: AbortSignal) => Promise<SessionMetadata>;
    readBranch?: (cwd: string, signal?: AbortSignal) => Promise<string | undefined>;
    rename?: typeof renameSession;
    prepareImages?: PrepareImages;
  } = {},
) {
  let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
  const calls: string[] = [];
  const views: View[] = [];
  const loads: (string | undefined)[] = [];
  const notifications: string[] = [];
  const resumed: ExtensionCommandContext[] = [];
  const renamed: string[] = [];
  const previewReads: { session: SessionInfo; signal: AbortSignal }[] = [];
  const replacement = {
    cwd: "/new-project",
    ui: { notify: (message: string) => notifications.push(message) },
  } as unknown as ExtensionCommandContext;
  let renders = 0;
  registerResumePicker(
    {
      registerCommand(name, command) {
        assert.equal(name, "pituix-resume");
        handler = command.handler;
      },
      setSessionName: (name: string) => {
        renamed.push(name);
      },
    } as ExtensionAPI,
    {
      ascii: () => false,
      prepareImages: options.prepareImages,
      onOpen: () => calls.push("open"),
      onClose: () => calls.push("close"),
      onResume: (fresh) => {
        resumed.push(fresh);
        if (options.resumeFailure) throw new Error("resume callback failed");
      },
    },
    {
      async list(cwd, dir) {
        assert.equal(cwd, "/project");
        loads.push(dir);
        return options.list ? options.list() : sessions;
      },
      async listAll(dir) {
        loads.push(dir);
        return [session(4, { cwd: "/other" })];
      },
    },
    async (session, signal) => {
      previewReads.push({ session, signal });
      return options.readPreview
        ? options.readPreview(session, signal)
        : { entries: [], cwd: session.cwd, model: "Recorded model", effort: "off" };
    },
    options.readMetadata ?? (async () => ({})),
    { readBranch: options.readBranch ?? (async () => "main"), rename: options.rename },
  );
  const ctx = {
    hasUI: true,
    cwd: "/project",
    sessionManager: {
      getSessionFile: () => options.current ?? "/current.jsonl",
      getSessionDir: () => "/custom/sessions",
      getSessionId: () => sessions[0].id,
    },
    ui: {
      custom: (factory: (...args: unknown[]) => View, uiOptions: unknown) =>
        new Promise<string | undefined>((done) => {
          assert.deepEqual(uiOptions, {
            overlay: true,
            overlayOptions: { width: "100%", maxHeight: "100%", anchor: "bottom-left", margin: 0 },
          });
          if (options.customFailure) throw new Error("custom view failed");
          views.push(
            factory(
              {
                terminal: { rows: 40 },
                requestRender() {
                  renders++;
                },
              },
              theme,
              {
                matches: (data: string, action: string) =>
                  (action === "app.tools.expand" && data === "\x0f") ||
                  (action === "app.session.rename" && data === "\x12"),
              },
              done,
            ),
          );
        }),
      notify(message: string) {
        notifications.push(message);
      },
    },
    async switchSession(
      path: string,
      optionsForSwitch?: {
        withSession?: (ctx: ExtensionCommandContext) => Promise<void>;
      },
    ) {
      assert.deepEqual(calls, ["open", "close"]);
      calls.push(path);
      if (options.failure) throw new Error("unavailable");
      if (options.cancelSwitch) return { cancelled: true };
      // A successful switch invalidates the old session-bound objects.
      ctx.ui.notify = () => {
        throw new Error("stale context used after switch");
      };
      await optionsForSwitch?.withSession?.(replacement);
      return { cancelled: false };
    },
  };
  return {
    run: () => handler?.("", ctx as unknown as ExtensionCommandContext),
    ctx,
    calls,
    views,
    loads,
    notifications,
    resumed,
    renamed,
    previewReads,
    replacement,
    get renders() {
      return renders;
    },
  };
}

test("resume list and preview display recorded metadata in reference order without fabricating unknown values", () => {
  assert.equal(
    formatSessionSize(2169),
    "2.1KB",
    "measured reference file has 2169 bytes and displays 2.1KB",
  );
  assert.equal(formatSessionSize(0), "0B");
  assert.equal(formatSessionSize(1024 * 1024), "1.0MB");
  for (const value of [undefined, -1, NaN, Infinity, 1.5])
    assert.equal(formatSessionSize(value), undefined);
  for (const ascii of [false, true]) {
    const { view } = setup(40, ascii);
    view.setMetadata(sessions[0].path, { gitBranch: "feat/历史", byteSize: 2169 });
    const before = text(view);
    assert.match(before, /Resume session \(1 of 3\)/);
    assert.match(
      before,
      ascii ? /1 minute ago \| feat\/历史 \| 2.1KB/ : /1 minute ago · feat\/历史 · 2.1KB/,
    );
    assert.doesNotMatch(before, /2 messages/);
    assert.equal(before.match(/feat\/历史/g)?.length, 1, "unknown sessions get no invented branch");
    view.handleInput(" ");
    assert.match(
      text(view),
      ascii ? /1m ago \| 2 messages \| feat\/历史/ : /1m ago · 2 messages · feat\/历史/,
    );
    assert.doesNotMatch(text(view), /2.1KB/);
    view.setMetadata(sessions[0].path, {
      gitBranch: "\x1b]0;title\x07很长的分支".repeat(20),
      byteSize: 2169,
    });
    for (const width of [0, 1, 4, 12, 40, 80, 100]) {
      const lines = view.render(width);
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
      assert.ok(lines.every((line) => !line.includes("\x1b]0;")));
    }
  }
});

test("branch filtering waits for recorded metadata, preserves selection as results arrive and excludes unknown branches", () => {
  const { view, selected } = setup();
  view.handleInput("\x02");
  assert.match(text(view), /Reading current Git branch/);
  assert.deepEqual(view.metadataCandidates(), []);
  view.setCurrentBranch("main");
  assert.match(text(view), /Reading recorded session branches/);
  assert.equal(view.metadataCandidates().length, 3);
  view.setMetadata(sessions[2].path, { gitBranch: "main" });
  assert.match(text(view), /❯ Session 3/);
  view.setMetadata(sessions[0].path, { gitBranch: "main" });
  view.setMetadata(sessions[1].path, {});
  assert.match(text(view), /❯ Session 3/);
  assert.doesNotMatch(text(view), /Session 2/);
  view.handleInput("\x02");
  assert.match(text(view), /Session 2/);
  assert.match(text(view), /❯ Session 3/);
  view.handleInput("\x02");
  view.handleInput(" ");
  view.setMetadata(sessions[2].path, { gitBranch: "elsewhere" });
  assert.match(text(view), /Resume session/);
  assert.doesNotMatch(text(view), /Session preview|Session 3/);
  view.handleInput("\r");
  assert.deepEqual(selected, [sessions[0].path]);
});

test("branch filtering distinguishes unavailable, loading and empty results and composes with search/scope", () => {
  const { view, scopes } = setup();
  view.setCurrentBranch(undefined);
  view.handleInput("\x02");
  assert.match(text(view), /Current Git branch unavailable/);
  view.setCurrentBranch("main");
  for (const item of sessions) view.setMetadata(item.path, {});
  assert.match(text(view), /No matching sessions/);
  view.setMetadata(sessions[1].path, { gitBranch: "main" });
  view.handleInput("Request 2");
  view.handleInput("\r");
  view.handleInput("\x01");
  assert.deepEqual(scopes, [true]);
  const outside = session(4, { cwd: "/other", allMessagesText: "Request 2" });
  view.setSessions([...sessions, outside]);
  view.setMetadata(outside.path, { gitBranch: "main" });
  assert.match(text(view), /All projects · main/);
  assert.match(text(view), /Session 4/);
  assert.doesNotMatch(text(view), /Session 1|Session 3/);
});

test("branch indexing reaches beyond the visible window and drops pending catalogue work on filter/scope change", async () => {
  const reads: number[] = [];
  const h = harness({
    list: async () => Array.from({ length: 100 }, (_, index) => session(index + 1)),
    readMetadata: async (item) => {
      const index = Number(item.id.split("-")[1]);
      reads.push(index);
      if (index === 99) throw new Error("unreadable");
      return { gitBranch: index === 100 ? "main" : "different" };
    },
  });
  const run = h.run();
  await tick();
  assert.ok(reads.length < 100);
  h.views[0].handleInput("\x02");
  await tick();
  assert.equal(reads.length, 100);
  assert.match(h.views[0].render(100).map(stripTerminalSequences).join("\n"), /❯ Session 100/);
  h.views[0].handleInput("\x1b");
  await run;

  const pending: { item: SessionInfo; resolve: (metadata: SessionMetadata) => void }[] = [];
  const other = harness({
    list: async () => Array.from({ length: 500 }, (_, index) => session(index + 1)),
    readMetadata: (item) => new Promise((resolve) => pending.push({ item, resolve })),
  });
  const otherRun = other.run();
  await tick();
  other.views[0].handleInput("\x02");
  other.views[0].handleInput("\x02");
  other.views[0].handleInput("Request 400");
  pending[0].resolve({});
  await tick();
  assert.equal(pending[2].item.id, "session-400", "old queued rows do not delay the new search");
  for (let i = 0; i < 3; i++) other.views[0].handleInput("\x1b");
  await otherRun;
  for (const request of pending.slice(1)) request.resolve({});
  await tick();
});

test("current branch reads abort with the picker and cannot redraw a closed view", async () => {
  let signal: AbortSignal | undefined;
  let resolve!: (branch: string) => void;
  const h = harness({
    readBranch: (_cwd, request) => {
      signal = request;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  const run = h.run();
  await tick();
  h.views[0].handleInput("\x1b");
  await run;
  assert.ok(signal?.aborted);
  const renders = h.renders;
  resolve("late");
  await tick();
  assert.equal(h.renders, renders);
});

test("rename prefills names, cancels without I/O, preserves public input editing and saves exactly once", async () => {
  let records = sessions;
  const saves: string[] = [];
  const h = harness({
    list: async () => records,
    rename: async (item, name) => {
      saves.push(name);
      records = records.map((record) =>
        record.path === item.path ? { ...record, name, modified: new Date(now) } : record,
      );
    },
  });
  const run = h.run();
  await tick();
  const page = h.views[0];
  page.handleInput("\x1b[B");
  page.handleInput("\x12");
  const output = () => page.render(100).map(stripTerminalSequences).join("\n");
  assert.match(output(), /Rename session:[\s\S]*Session 2[\s\S]*Enter to save/);
  page.handleInput(" ignored");
  page.handleInput("\x1b");
  assert.deepEqual(saves, []);
  assert.match(output(), /❯ Session 2/);
  page.handleInput("\x12");
  page.handleInput("\x01");
  page.handleInput("\x0b");
  page.handleInput("\r");
  assert.deepEqual(saves, [], "blank confirmation performs no write");
  page.handleInput("\x1b[200~  Renamed 中文  \x1b[201~");
  page.handleInput("\r");
  page.handleInput("\r");
  assert.match(output(), /Saving session name/);
  await tick();
  assert.deepEqual(saves, ["Renamed 中文"]);
  assert.match(output(), /❯ Renamed 中文/);
  assert.match(output(), /Resume session \(1 of 3\)/);
  assert.deepEqual(h.calls, ["open"]);
  page.handleInput("\x12");
  assert.match(output(), /Rename session:[\s\S]*Renamed 中文/);
  page.handleInput("\r");
  assert.deepEqual(saves, ["Renamed 中文"], "unchanged name closes without another write");
  page.handleInput("\x1b");
  await run;
});

test("rename failure keeps the draft for retry, cancellation aborts pending writes and ignores late results", async () => {
  let attempts = 0;
  let signal: AbortSignal | undefined;
  let resolve!: () => void;
  const h = harness({
    rename: async (_item, _name, request) => {
      signal = request;
      if (++attempts === 1) throw new Error("File unavailable");
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  const run = h.run();
  await tick();
  const page = h.views[0];
  page.handleInput("\x12");
  page.handleInput(" renamed");
  page.handleInput("\r");
  await tick();
  assert.match(
    page.render(100).map(stripTerminalSequences).join("\n"),
    /Could not rename session: Error: File unavailable/,
  );
  page.handleInput("\r");
  assert.equal(attempts, 2);
  page.handleInput("\x1b");
  assert.ok(signal?.aborted);
  page.handleInput("\x1b");
  await run;
  const renders = h.renders;
  resolve();
  await tick();
  assert.equal(h.renders, renders);
  assert.deepEqual(h.calls, ["open", "close"]);
  assert.deepEqual(h.notifications, []);
});

test("rename delegates the current session to ExtensionAPI and invalidates old metadata after a save", async () => {
  const h = harness({ current: sessions[0].path });
  const run = h.run();
  await tick();
  h.views[0].handleInput("\x12");
  h.views[0].handleInput(" renamed");
  h.views[0].handleInput("\r");
  await tick();
  assert.deepEqual(h.renamed, ["Session 1 renamed"]);
  h.views[0].handleInput("\x1b");
  await run;

  const reads: { session: SessionInfo; resolve: (metadata: SessionMetadata) => void }[] = [];
  const other = harness({
    readMetadata: (session) => new Promise((resolve) => reads.push({ session, resolve })),
    rename: async () => {},
  });
  const otherRun = other.run();
  await tick();
  other.views[0].handleInput("\x12");
  other.views[0].handleInput(" renamed");
  other.views[0].handleInput("\r");
  await tick();
  reads[1].resolve({});
  await tick();
  assert.equal(reads[2].session.path, sessions[0].path);
  reads[2].resolve({ byteSize: 4096 });
  await tick();
  reads[0].resolve({ byteSize: 1024 });
  await tick();
  assert.match(other.views[0].render(100).map(stripTerminalSequences).join("\n"), /4.0KB/);
  assert.doesNotMatch(other.views[0].render(100).map(stripTerminalSequences).join("\n"), /1.0KB/);
  other.views[0].handleInput("\x1b");
  await otherRun;
  for (const request of reads.slice(3)) request.resolve({});
  await tick();
});

test("rename input and errors stay within ANSI/CJK bounds and use the configured shortcut", () => {
  for (const rows of [1, 2, 3, 4, 8, 12, 14, 24, 40]) {
    for (const ascii of [false, true]) {
      const view = new ResumePicker({
        theme,
        ascii,
        cwd: "/project",
        getRows: () => rows,
        done() {},
        onScopeChange() {},
        onRename() {},
        renameKey: (data) => data === "\x14",
        renameHint: "Ctrl+T",
      });
      view.setSessions([session(1, { name: undefined })]);
      view.handleInput("\x12");
      assert.doesNotMatch(text(view), /Rename session:/);
      view.handleInput("\x14");
      if (rows >= 14) assert.match(text(view), /Enter new session name/);
      view.handleInput("\x1b[200~中文很长的会话名称\x1b[201~");
      view.setRenameError(sessions[0].path, new Error("\x1b]0;title\x07错误 ".repeat(20)));
      for (const width of [0, 1, 2, 4, 12, 24, 40, 80, 100]) {
        const lines = view.render(width);
        assert.ok(lines.length <= rows);
        assert.ok(lines.every((line) => visibleWidth(line) <= width));
        assert.ok(!lines.join("\n").includes("\x1b]0;"));
        if (ascii) assert.doesNotMatch(lines.join("\n"), /[❯⌕╭╮╰╯─▔·]/);
      }
    }
  }
});

test("reference list keeps three rows and a stable frame through filtering and rename", () => {
  const view = new ResumePicker({
    theme,
    ascii: false,
    cwd: "/project",
    getRows: () => 38,
    done() {},
    onScopeChange() {},
    onRename() {},
    renameKey: (data) => data === "\x12",
  });
  view.setSessions(Array.from({ length: 8 }, (_, i) => session(i + 1)));
  const lines = () => view.render(100).map(stripTerminalSequences);
  const list = lines();
  assert.equal(list.length, 20);
  assert.match(list[7], /❯ Session 1/);
  assert.match(list[13], /↓ Session 3/);
  assert.match(list[16], /^ {5}Ctrl\+A/);
  view.handleInput("\x1b[6~");
  assert.match(lines()[7], /↑ Session 3/);
  view.handleInput("\x12");
  assert.equal(lines().length, 20);
  assert.match(lines()[7], /Rename session:/);
  assert.match(lines()[9], /Session 4/);
  assert.match(lines()[10], /Enter to save/);
  view.handleInput("\x1b");
  view.handleInput("absent");
  assert.equal(lines().length, 20);
  assert.match(lines()[7], /No matching sessions/);
});

test("metadata I/O stays bounded, never blocks navigation, and aborts without late redraws", async () => {
  const requests: {
    session: SessionInfo;
    signal: AbortSignal;
    resolve: (value: SessionMetadata) => void;
  }[] = [];
  const h = harness({
    list: async () => Array.from({ length: 500 }, (_, index) => session(index + 1)),
    readMetadata: (session, signal) =>
      new Promise((resolve) => requests.push({ session, signal, resolve })),
  });
  const run = h.run();
  await tick();
  assert.equal(requests.length, 2, "only two metadata reads run at once");
  const page = h.views[0];
  page.handleInput("\x1b[B");
  requests[0].resolve({ gitBranch: "first", byteSize: 1024 });
  await tick();
  assert.equal(requests.length, 3);
  const output = page.render(100).map(stripTerminalSequences).join("\n");
  assert.match(output, /❯ Session 2/);
  assert.match(output, /first · 1.0KB/);
  page.handleInput("\x1b");
  await run;
  assert.ok(requests.every((request) => request.signal.aborted));
  const renders = h.renders;
  requests[1].resolve({ gitBranch: "late", byteSize: 9000 });
  requests[2].resolve({ gitBranch: "late", byteSize: 9000 });
  await tick();
  assert.equal(requests.length, 3, "queued files are not read after closing");
  assert.equal(h.renders, renders);
  assert.doesNotMatch(page.render(100).map(stripTerminalSequences).join("\n"), /late/);
});

test("a later preview snapshot wins over an older list metadata read", async () => {
  const requests: ((value: SessionMetadata) => void)[] = [];
  const h = harness({
    readMetadata: () => new Promise((resolve) => requests.push(resolve)),
    readPreview: async (session) => ({
      entries: [],
      cwd: session.cwd,
      model: "model",
      effort: "off",
      byteSize: 4096,
      gitBranch: "new-observation",
    }),
  });
  const run = h.run();
  await tick();
  const page = h.views[0];
  page.handleInput(" ");
  await tick();
  requests[0]({ byteSize: 1024, gitBranch: "old-observation" });
  await tick();
  assert.match(page.render(100).map(stripTerminalSequences).join("\n"), /new-observation/);
  page.handleInput("\x1b");
  assert.match(page.render(100).map(stripTerminalSequences).join("\n"), /new-observation · 4.0KB/);
  page.handleInput("\x1b");
  await run;
  for (const resolve of requests.slice(1)) resolve({});
  await tick();
});

test("resume command delegates the selected path once after closing the UI and loads all scopes on demand", async () => {
  const h = harness();
  const pending = h.run();
  await tick();
  assert.deepEqual(h.loads, ["/custom/sessions"]);
  h.views[0].handleInput("\x01");
  await tick();
  assert.deepEqual(h.loads, ["/custom/sessions", undefined, "/custom/sessions"]);
  assert.match(h.views[0].render(100).map(stripTerminalSequences).join("\n"), /All projects/);
  h.views[0].handleInput("\x1b[B");
  h.views[0].handleInput("\r");
  h.views[0].handleInput("\r");
  await pending;
  assert.deepEqual(h.calls, ["open", "close", sessions[1].path]);
  assert.deepEqual(h.resumed, [h.replacement]);
});

test("resume command leaves the session unchanged on cancel, current selection and noninteractive calls", async () => {
  for (const mode of ["cancel", "current", "no-ui"] as const) {
    const h = harness({ current: mode === "current" ? sessions[0].path : undefined });
    h.ctx.hasUI = mode !== "no-ui";
    const pending = h.run();
    await tick();
    if (mode !== "no-ui") h.views[0].handleInput(mode === "cancel" ? "\x1b" : "\r");
    await pending;
    assert.deepEqual(h.calls, mode === "no-ui" ? [] : ["open", "close"]);
  }
});

test("resume command reports host cancellation and errors through the live context without retrying", async () => {
  for (const options of [{ failure: true }, { cancelSwitch: true }, { resumeFailure: true }]) {
    const h = harness(options);
    const pending = h.run();
    await tick();
    h.views[0].handleInput("\r");
    await pending;
    assert.deepEqual(h.calls, ["open", "close", sessions[0].path]);
    assert.match(
      h.notifications[0],
      options.failure
        ? /failed: Error: unavailable/
        : options.resumeFailure
          ? /failed: Error: resume callback failed/
          : /cancelled/,
    );
  }
});

test("resume loading supports cancellation, ignores late results, and renders recoverable errors", async () => {
  const { view, scopes, selected } = setup();
  view.handleInput("\x01");
  assert.deepEqual(scopes, [true]);
  assert.match(text(view), /Loading sessions/);
  view.handleInput("\r");
  assert.deepEqual(selected, []);
  view.setError(new Error("Fixture failure"));
  assert.match(text(view), /Could not load sessions: Error: Fixture failure/);
  view.handleInput("\x01");
  assert.deepEqual(scopes, [true, false]);
  view.setSessions(sessions);
  assert.match(text(view), /Session 1/);
  view.handleInput("\x01");
  view.handleInput("\x1b");
  view.setSessions([session(99)]);
  assert.deepEqual(selected, [undefined]);
  assert.doesNotMatch(text(view), /Session 99/);
});

test("resume command closes during pending I/O and suppresses late loading callbacks", async () => {
  for (const fail of [false, true]) {
    let resolve!: (sessions: SessionInfo[]) => void;
    let reject!: (error: Error) => void;
    const loading = new Promise<SessionInfo[]>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const h = harness({ list: () => loading });
    const pending = h.run();
    assert.match(h.views[0].render(100).map(stripTerminalSequences).join("\n"), /Loading sessions/);
    h.views[0].handleInput("\x1b");
    await pending;
    const renders = h.renders;
    if (fail) reject(new Error("late failure"));
    else resolve(sessions);
    await tick();
    assert.equal(h.renders, renders);
    assert.deepEqual(h.calls, ["open", "close"]);
    assert.deepEqual(h.notifications, []);
  }
});

test("resume command restores panel chrome after custom view setup failure", async () => {
  const h = harness({ customFailure: true });
  await assert.rejects(async () => h.run(), /custom view failed/);
  assert.deepEqual(h.calls, ["open", "close"]);
  assert.deepEqual(h.loads, []);
});

test("rich preview loads on demand and cancellation suppresses late results without switching", async () => {
  for (const fail of [false, true]) {
    let resolve!: (value: SessionPreviewSnapshot) => void;
    let reject!: (error: Error) => void;
    const loading = new Promise<SessionPreviewSnapshot>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const h = harness({ readPreview: () => loading });
    const pending = h.run();
    await tick();
    assert.equal(h.previewReads.length, 0);
    h.views[0].handleInput(" ");
    assert.equal(h.previewReads.length, 1);
    assert.equal(h.previewReads[0].session.path, sessions[0].path);
    assert.match(
      h.views[0].render(100).map(stripTerminalSequences).join("\n"),
      /Loading conversation/,
    );
    h.views[0].handleInput("\x1b");
    assert.ok(h.previewReads[0].signal.aborted);
    h.views[0].handleInput("\x1b");
    await pending;
    const renders = h.renders;
    if (fail) reject(new Error("late preview failure"));
    else resolve({ entries: [], cwd: "/late", model: "Late result", effort: "off" });
    await tick();
    assert.equal(h.renders, renders);
    assert.deepEqual(h.calls, ["open", "close"]);
    assert.deepEqual(h.notifications, []);
  }
});

test("preview result ordering follows the selected session, not pending read completion order", async () => {
  const resolvers: ((value: SessionPreviewSnapshot) => void)[] = [];
  const h = harness({ readPreview: () => new Promise((resolve) => resolvers.push(resolve)) });
  const pending = h.run();
  await tick();
  h.views[0].handleInput(" ");
  h.views[0].handleInput("\x1b");
  h.views[0].handleInput("\x1b[B");
  h.views[0].handleInput(" ");
  resolvers[1]({ entries: [], cwd: "/second", model: "Second preview", effort: "high" });
  await tick();
  resolvers[0]({ entries: [], cwd: "/first", model: "Stale first preview", effort: "off" });
  await tick();
  const output = h.views[0].render(100).map(stripTerminalSequences).join("\n");
  assert.match(output, /Second preview with high effort/);
  assert.doesNotMatch(output, /Stale first preview/);
  assert.deepEqual(h.calls, ["open"]);
  h.views[0].handleInput("\r");
  await pending;
  assert.deepEqual(h.calls, ["open", "close", sessions[1].path]);
  assert.ok(h.previewReads.every((read) => read.signal.aborted));
});

test("preview image preparation updates only the active snapshot and ignores late completion after closing", async () => {
  const requests: { signal: AbortSignal; resolve: (links: ReadonlyMap<string, string>) => void }[] =
    [];
  const h = harness({
    readPreview: async (session) => ({
      cwd: session.cwd,
      model: session.name ?? "fixture",
      effort: "off",
      entries: [
        {
          type: "message",
          id: "image",
          parentId: null,
          timestamp: new Date(0).toISOString(),
          message: {
            role: "user",
            timestamp: 0,
            content: [{ type: "image", data: "fixture", mimeType: "image/png" }],
          },
        },
      ],
    }),
    prepareImages: (_entries, signal) =>
      new Promise((resolve) => requests.push({ signal, resolve })),
  });
  const pending = h.run();
  await tick();
  h.views[0].handleInput(" ");
  await tick();
  assert.match(
    h.views[0].render(100).map(stripTerminalSequences).join("\n"),
    /\[Image #1\] \(loading\.\.\.\)/,
  );
  h.views[0].handleInput("\x1b");
  h.views[0].handleInput("\x1b[B");
  h.views[0].handleInput(" ");
  await tick();
  requests[1].resolve(new Map([["image:0", "file:///tmp/second.png"]]));
  await tick();
  requests[0].resolve(new Map([["image:0", "file:///tmp/stale.png"]]));
  await tick();
  const output = h.views[0].render(100).join("\n");
  assert.match(output, /file:\/\/\/tmp\/second.png/);
  assert.doesNotMatch(output, /stale.png|loading|unavailable/);
  assert.ok(requests[0].signal.aborted);
  h.views[0].handleInput("\x1b");
  h.views[0].handleInput(" ");
  await tick();
  h.views[0].handleInput("\x1b");
  h.views[0].handleInput("\x1b");
  await pending;
  const renders = h.renders;
  requests[2].resolve(new Map([["image:0", "file:///tmp/closed.png"]]));
  await tick();
  assert.equal(h.renders, renders);
  assert.ok(requests.every(({ signal }) => signal.aborted));
  assert.deepEqual(h.calls, ["open", "close"]);
});

test("preview errors are recoverable and Enter during loading closes before resuming", async () => {
  const h = harness({
    readPreview: async () => {
      throw new Error("File unavailable");
    },
  });
  const pending = h.run();
  await tick();
  h.views[0].handleInput(" ");
  await tick();
  assert.match(
    h.views[0].render(100).map(stripTerminalSequences).join("\n"),
    /Could not load preview.*File unavailable/,
  );
  h.views[0].handleInput(" ");
  h.views[0].handleInput(" ");
  assert.equal(h.previewReads.length, 2);
  h.views[0].handleInput("\r");
  await pending;
  await tick();
  assert.deepEqual(h.calls, ["open", "close", sessions[0].path]);
  assert.deepEqual(h.notifications, []);
});

test("rich preview follows Home/End, page, wheel and expansion keys within ANSI/width bounds", () => {
  for (const rows of [1, 2, 3, 8, 24, 40]) {
    const states: boolean[] = [];
    let renders = 0;
    const view = new ResumePicker({
      theme,
      ascii: false,
      cwd: "/project",
      getRows: () => rows,
      done() {},
      onScopeChange() {},
      onPreviewChange() {},
      expandKey: (data) => data === "\x0f",
    });
    view.setSessions(sessions);
    view.handleInput(" ");
    view.setPreview(sessions[0].path, {
      render: (width) => {
        renders++;
        return Array.from({ length: 80 }, (_, i) =>
          theme.fg("text", `Rich line ${i} 中文 ${"wide ".repeat(width)}`),
        );
      },
      setExpanded: (value) => states.push(value),
      invalidate() {},
    });
    const output = (width = 80) => view.render(width).map(stripTerminalSequences).join("\n");
    assert.match(output(), /Rich line 0/);
    output();
    assert.equal(renders, 1, "scroll layout reuses static preview content");
    view.handleInput("\x1b[<65;10;10M");
    assert.match(output(), /Rich line 3/);
    view.handleInput("\x1b[<64;10;10M");
    assert.match(output(), /Rich line 0/);
    view.handleInput("\x1b[F");
    assert.match(output(), /Enter to resume/);
    view.handleInput("\x1b[H");
    assert.match(output(), /Rich line 0/);
    view.handleInput("\x0f");
    assert.deepEqual(states, [false, true]);
    for (const width of [0, 1, 2, 4, 12, 40, 80, 100]) {
      const lines = view.render(width);
      assert.ok(lines.length <= rows);
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
    }
    view.handleInput("\x1b");
    view.setPreviewError(sessions[0].path, new Error("Late ignored"));
    assert.doesNotMatch(output(), /Late ignored|Rich line/);
  }
});

test("native regular and fullscreen renderers deliver preview navigation to the focused modal", () => {
  for (const mode of ["regular", "fullscreen"]) {
    let receive = (_data: string) => {};
    let nativeInputs = 0;
    const terminal: Terminal = {
      columns: 80,
      rows: 24,
      kittyProtocolActive: false,
      start: (input) => {
        receive = input;
      },
      stop() {},
      drainInput: async () => {},
      write() {},
      moveBy() {},
      hideCursor() {},
      showCursor() {},
      clearLine() {},
      clearFromCursor() {},
      clearScreen() {},
      setTitle() {},
      setProgress() {},
    };
    const tui = mode === "fullscreen" ? new TuiAltScreen(terminal) : new TuiMainScreen(terminal);
    const editor = {
      render: () => ["ORIGINAL EDITOR"],
      invalidate() {},
      handleInput: () => {
        nativeInputs++;
      },
    };
    tui.addChild(new Text("Original document", 0, 0));
    tui.addChild(editor);
    tui.setFocus(editor);
    const view = new ResumePicker({
      theme,
      ascii: false,
      cwd: "/project",
      getRows: () => 22,
      done() {},
      onScopeChange() {},
      onPreviewChange() {},
    });
    view.setSessions(sessions);
    view.handleInput(" ");
    view.setPreview(sessions[0].path, {
      render: () => Array.from({ length: 80 }, (_, i) => `Preview row ${i}`),
      invalidate() {},
    });
    tui.start();
    const modal = tui.showOverlay(view, {
      width: "100%",
      maxHeight: "100%",
      anchor: "bottom-left",
      margin: 0,
    });
    try {
      tui.renderNow();
      receive("\x1b[F");
      tui.renderNow();
      assert.match(text(view, 80), /Enter to resume/, mode);
      receive("\x1b[H");
      assert.match(text(view, 80), /Preview row 0/, mode);
      receive("\x1b[6~");
      assert.doesNotMatch(text(view, 80), /Preview row 0\n/, mode);
      receive("\x1b[H");
      text(view, 80);
      receive("\x1b[<65;10;10M");
      assert.match(text(view, 80), /Preview row 3/, mode);
      assert.equal(nativeInputs, 0);
      modal.hide();
      receive("x");
      assert.equal(nativeInputs, 1, "closing the modal restores original editor input");
    } finally {
      modal.hide();
      tui.stop();
    }
  }
});
