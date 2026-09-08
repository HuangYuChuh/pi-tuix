import { sliceByColumn, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

function verticalBorderColumns(line: string): number[] {
  const columns: number[] = [];
  let column = 0;
  for (const character of stripTerminalSequences(line)) {
    if (character === "│") columns.push(column);
    column += visibleWidth(character);
  }
  return columns;
}

function trimVisibleSpaces(line: string): string {
  const plain = stripTerminalSequences(line);
  const leading = plain.match(/^ */)?.[0].length ?? 0;
  const trailing = plain.match(/ *$/)?.[0].length ?? 0;
  return sliceByColumn(line, leading, Math.max(0, visibleWidth(line) - leading - trailing), true);
}

function centerTableHeader(line: string): string {
  const borders = verticalBorderColumns(line);
  if (borders.length < 2) return line;
  const lineWidth = visibleWidth(line);
  let result = sliceByColumn(line, borders[0], 1, true);
  for (let index = 0; index < borders.length - 1; index++) {
    const left = borders[index];
    const right = borders[index + 1];
    const innerWidth = Math.max(0, right - left - 3);
    const raw = sliceByColumn(line, left + 2, innerWidth, true);
    const content = trimVisibleSpaces(raw);
    const contentWidth = visibleWidth(content);
    const remaining = Math.max(0, innerWidth - contentWidth);
    const leftPad = Math.floor(remaining / 2);
    const rightPad = remaining - leftPad;
    const border = sliceByColumn(line, right, 1, true);
    result += ` ${" ".repeat(leftPad)}${content}${" ".repeat(rightPad)} ${border}`;
  }
  return result + " ".repeat(Math.max(0, lineWidth - visibleWidth(result)));
}

function terminalStylesEnabled(): boolean {
  const noColor = Boolean(process.env.NO_COLOR);
  const forced = Boolean(process.env.FORCE_COLOR) && process.env.FORCE_COLOR !== "0";
  return !noColor || forced;
}

/** Adapt Pi's public Markdown output without changing its parser or source content. */
export function styleReferenceMarkdownLines(lines: readonly string[]): string[] {
  const styled: string[] = [];
  const italicQuotes = terminalStylesEnabled();
  let code = false;
  let codeOpening = false;
  let table = false;
  let tableHeader = false;
  for (const line of lines) {
    const plain = stripTerminalSequences(line);
    if (/^(?:```|~~~)/.test(plain)) {
      code = !code;
      codeOpening = code;
      continue;
    }
    if (code) {
      // Pi can wrap a long opening language label at very small widths. Those
      // continuation rows precede the consistently indented code content.
      if (codeOpening && !plain.startsWith("  ")) continue;
      codeOpening = false;
      styled.push(
        plain.startsWith("  ") ? sliceByColumn(line, 2, visibleWidth(line) - 2, true) : line,
      );
      continue;
    }
    if (/^┌─.*─┐ *$/.test(plain)) {
      table = true;
      tableHeader = true;
    } else if (tableHeader && /^├─.*─┤ *$/.test(plain)) tableHeader = false;
    let output = tableHeader && /^│.*│ *$/.test(plain) ? centerTableHeader(line) : line;
    if (italicQuotes && !table && /^│ /.test(plain)) {
      output = `${sliceByColumn(line, 0, 2, true)}\x1b[3m${sliceByColumn(
        line,
        2,
        visibleWidth(line) - 2,
        true,
      )}\x1b[23m`;
    }
    styled.push(output);
    if (table && /^└─.*─┘ *$/.test(plain)) table = false;
  }
  return styled;
}
