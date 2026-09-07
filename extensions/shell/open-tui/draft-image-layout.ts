import { CURSOR_MARKER, hyperlink, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { DraftImages } from "./draft-images.ts";

interface Cell {
  text: string;
  start: number;
  end: number;
  width: number;
}
interface Row {
  cells: Cell[];
  line: number;
}
export interface DraftImageLayout {
  lines: string[];
  above: number;
  below: number;
  column: number;
  up?: { line: number; col: number };
  down?: { line: number; col: number };
}
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Layout uses public editor text/cursor data; it never reads the host's state. */
export function layoutDraftImages(
  source: string[],
  cursor: { line: number; col: number },
  images: DraftImages,
  width: number,
  maxRows: number,
  focused: boolean,
  blockCursor: boolean,
  preferredColumn?: number,
): DraftImageLayout {
  if (width <= 0) return { lines: [], above: 0, below: 0, column: 0 };
  if (!source.length) source = [""];
  const rows: Row[] = [];
  let cursorRow = 0;
  let cursorCell = 0;
  for (let line = 0; line < source.length; line++) {
    let row: Row = { line, cells: [] };
    let columns = 0;
    const cells = [...segmenter.segment(source[line])].map(({ segment, index }) => {
      const code = segment.codePointAt(0) ?? 0;
      const label = code < 32 || (code >= 127 && code < 160) ? "?" : images.display(segment);
      const url = images.get(segment)?.url;
      const text = url ? hyperlink(label, url) : label;
      return { text, start: index, end: index + segment.length, width: visibleWidth(text) };
    });
    if (line === cursor.line && cursor.col === source[line].length)
      cells.push({ text: " ", start: cursor.col, end: cursor.col, width: 1 });
    for (const cell of cells) {
      if (columns > 0 && columns + cell.width > width) {
        rows.push(row);
        row = { line, cells: [] };
        columns = 0;
      }
      if (
        line === cursor.line &&
        cursor.col >= cell.start &&
        cursor.col <= cell.end &&
        (cursor.col < cell.end || cell.start === cell.end)
      ) {
        cursorRow = rows.length;
        cursorCell = row.cells.length;
      }
      row.cells.push(cell);
      columns += Math.min(width, cell.width);
    }
    rows.push(row);
  }
  const height = Math.max(1, maxRows);
  const start = Math.max(0, Math.min(cursorRow - height + 1, rows.length - height));
  const end = Math.min(rows.length, start + height);
  const column = rows[cursorRow].cells
    .slice(0, cursorCell)
    .reduce((total, cell) => total + Math.min(width, cell.width), 0);
  const target = (index: number) => {
    const row = rows[index];
    if (!row) return;
    let offset = 0;
    const desired = preferredColumn ?? column;
    for (const cell of row.cells) {
      if (offset + cell.width > desired) return { line: row.line, col: cell.start };
      offset += Math.min(width, cell.width);
    }
    const last = row.cells.at(-1);
    return {
      line: row.line,
      col: last ? (last.end === source[row.line].length ? last.end : last.start) : 0,
    };
  };
  return {
    lines: rows.slice(start, end).map((row, index) =>
      row.cells
        .map((cell, cellIndex) => {
          const text = truncateToWidth(cell.text, width, "");
          return focused && start + index === cursorRow && cellIndex === cursorCell
            ? CURSOR_MARKER + (blockCursor ? `\x1b[7m${text}\x1b[0m` : text)
            : text;
        })
        .join(""),
    ),
    above: start,
    below: rows.length - end,
    column,
    up: target(cursorRow - 1),
    down: target(cursorRow + 1),
  };
}
