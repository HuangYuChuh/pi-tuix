import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionInfo,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { ResumePicker, registerResumePicker } from "../extensions/session/resume-picker.ts";

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
  assert.match(text(view), /1 minute ago · 2 messages/);
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
  } = {},
) {
  let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
  const calls: string[] = [];
  const views: View[] = [];
  const loads: (string | undefined)[] = [];
  const notifications: string[] = [];
  const resumed: ExtensionCommandContext[] = [];
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
    } as ExtensionAPI,
    {
      ascii: () => false,
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
  );
  const ctx = {
    hasUI: true,
    cwd: "/project",
    sessionManager: {
      getSessionFile: () => options.current ?? "/current.jsonl",
      getSessionDir: () => "/custom/sessions",
    },
    ui: {
      custom: (factory: (...args: unknown[]) => View) =>
        new Promise<string | undefined>((done) => {
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
              {},
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
    replacement,
    get renders() {
      return renders;
    },
  };
}

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
