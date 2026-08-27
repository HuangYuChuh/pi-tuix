import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { CompactToolView } from "../extensions/tools/compact-view.ts";

test("compact tool rows preserve state and attention within terminal width", () => {
  const view = new CompactToolView({
    action: "\u001b[1mREAD\u001b[22m",
    target: "\u001b[36mvery/long/path/to/a/file/that/needs/truncation.ts\u001b[39m",
    suffix: "\u001b[32m[OK]\u001b[39m CLEAR",
  });

  for (const width of [24, 40, 80]) {
    const [line] = view.render(width);
    assert.ok(line);
    assert.ok(visibleWidth(line) <= width, `line exceeded ${width} columns`);
    assert.match(stripTerminalSequences(line), /READ/);
    assert.match(stripTerminalSequences(line), /\[OK\] CLEAR$/);
  }
});

test("expanded detail lines are ANSI-aware and width constrained", () => {
  const view = new CompactToolView(
    { action: "BASH", target: "npm test", suffix: "[ERROR] ATTENTION" },
    ["\u001b[31mthis is a long error line that must be truncated safely\u001b[39m"],
  );

  const lines = view.render(32);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => visibleWidth(line) <= 32));
  assert.match(stripTerminalSequences(lines[1] ?? ""), /^ {2}this is a long error/);
});
