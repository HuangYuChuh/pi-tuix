import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, renderDiff, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  numberedDiff,
  readDiffHighlights,
  referenceDiffLine,
} from "../extensions/tools/diff-view.ts";
import { ThreeLayerToolView } from "../extensions/tools/three-layer-view.ts";

initTheme("dark", false);
const theme = (mode: "truecolor" | "256color" = "truecolor") =>
  ({
    name: "pi-tuix-dark",
    getColorMode: () => mode,
    fg: (_token: string, value: string) => value,
    bold: (value: string) => value,
  }) as Theme;

test("diff highlight ranges preserve source offsets without reading RGB operands as attributes", () => {
  const styled = "\x1b[38;2;7;27;0ma \x1b[7m中文🙂\x1b[27m b\x1b[39m";
  assert.deepEqual(readDiffHighlights(styled), {
    text: "a 中文🙂 b",
    changes: [{ start: 2, end: 6 }],
  });
  assert.deepEqual(readDiffHighlights("\x1b[48;5;7mplain\x1b[49m"), {
    text: "plain",
    changes: [],
  });
  assert.deepEqual(readDiffHighlights("\x1b[1;7mold\x1b[0;39m tail \x1b[7mx"), {
    text: "old tail x",
    changes: [
      { start: 0, end: 3 },
      { start: 9, end: 10 },
    ],
  });
});

test("reference diff rows use base and word backgrounds with explicit signed gutters", () => {
  const removed = referenceDiffLine(" 2", "-", "  return a \x1b[7m-\x1b[27m b;", theme());
  const added = referenceDiffLine(" 2", "+", "  return a \x1b[7m+\x1b[27m b;", theme());
  const minus = removed(95);
  const plus = added(95);
  assert.ok(minus.includes("\x1b[48;2;61;1;0m"));
  assert.ok(minus.includes("\x1b[48;2;92;2;0m-\x1b[48;2;61;1;0m"));
  assert.ok(plus.includes("\x1b[48;2;4;71;0m+\x1b[48;2;2;40;0m"));
  assert.ok(minus.includes("\x1b[38;2;220;90;90m 2 -"));
  assert.ok(plus.includes("\x1b[38;2;80;200;80m 2 +"));
  assert.equal(stripTerminalSequences(minus).trimEnd(), " 2 -  return a - b;");
  assert.equal(visibleWidth(minus), 88);
  assert.equal(visibleWidth(plus), 88);
  assert.ok(minus.endsWith("\x1b[39m\x1b[49m\x1b[27m"));
  assert.ok(!minus.includes("\x1b[7m"));
});

test("256-color diffs retain distinct row and token fills without truecolor sequences", () => {
  for (const sign of ["+", "-"]) {
    const row = referenceDiffLine("10", sign, "old \x1b[7mnew\x1b[27m", theme("256color"))(75);
    assert.ok(row.includes(sign === "+" ? "\x1b[48;5;22m" : "\x1b[48;5;52m"));
    assert.ok(row.includes(sign === "+" ? "\x1b[48;5;28m" : "\x1b[48;5;88m"));
    assert.ok(!row.includes(";2;"));
    assert.equal(stripTerminalSequences(row).trimEnd(), `10 ${sign}old new`);
  }
});

test("diff lines compose through collapsed, preview and expanded tool views at all widths", () => {
  const details = [
    "context",
    referenceDiffLine(" 2", "+", "中文\x1b[7m🙂\x1b[27m end", theme()),
    referenceDiffLine(" 3", "-", "\x1b[7mremoved\x1b[27m", theme()),
    "last",
  ];
  for (const mode of ["collapsed", "preview", "expanded"] as const) {
    const view = new ThreeLayerToolView(
      mode,
      {
        action: "update",
        target: "中文.ts",
        status: "OK",
        attention: false,
        resultSummary: "Added 1 line, removed 1 line",
      },
      details,
      theme(),
    );
    for (const width of [0, 1, 2, 4, 5, 6, 8, 12, 20, 40, 80, 100]) {
      const rows = view.render(width);
      assert.ok(
        rows.every((line) => visibleWidth(line) <= width),
        `${mode} at ${width}`,
      );
      if (mode === "collapsed") assert.ok(rows.every((line) => !line.includes("\x1b[48;")));
    }
    if (mode !== "collapsed") {
      assert.match(view.render(100).map(stripTerminalSequences).join("\n"), /2 \+中文🙂 end/);
    }
  }
});

test("numbered diff leaves other themes and unknown formats with public Pi styling", () => {
  const native = { ...theme(), name: "another-theme" } as Theme;
  const diff = "@@ unknown header\n-2 old\n+2 new\n 3 context";
  const rows = numberedDiff(diff, native);
  assert.ok(rows.every((row) => typeof row === "string"));
  assert.equal(rows[0], renderDiff(diff).split("\n")[0]);
  assert.match(stripTerminalSequences(rows[1] as string), /2 -old/);
  assert.ok(rows.every((row) => typeof row !== "string" || !row.includes("\x1b[48;")));
});

test("NO_COLOR disables added reference painting while retaining diff text", () => {
  const priorNoColor = process.env.NO_COLOR;
  const priorForceColor = process.env.FORCE_COLOR;
  try {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    const rows = numberedDiff("-2 old\n+2 new", theme());
    assert.ok(rows.every((row) => typeof row === "string"));
    assert.match(
      rows.map((row) => stripTerminalSequences(row as string)).join("\n"),
      /2 -old\n 2 \+new/,
    );
    process.env.FORCE_COLOR = "1";
    assert.ok(numberedDiff("-2 old", theme()).some((row) => typeof row === "function"));
  } finally {
    if (priorNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = priorNoColor;
    if (priorForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = priorForceColor;
  }
});
