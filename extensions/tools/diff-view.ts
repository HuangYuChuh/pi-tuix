import {
  getLanguageFromPath,
  highlightCode,
  renderDiff,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  sliceByColumn,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { ToolDetailLine } from "./three-layer-view.ts";

// Colors observed in the reference terminal, with distinct 256-color fallbacks.
const COLORS = {
  text: ["248;248;242", 255],
  added: ["80;200;80", 77],
  removed: ["220;90;90", 167],
  addedRow: ["2;40;0", 22],
  addedWord: ["4;71;0", 28],
  removedRow: ["61;1;0", 52],
  removedWord: ["92;2;0", 88],
} as const;

interface DiffText {
  text: string;
  changes: { start: number; end: number }[];
}

// Public renderDiff marks changed tokens with inverse video. Preserve those
// ranges while replacing inverse with the reference's stronger background.
export function readDiffHighlights(styled: string): DiffText {
  const changes: DiffText["changes"] = [];
  let text = "";
  let inverse = false;
  let start = 0;
  let position = 0;
  const append = (chunk: string) => {
    text += stripTerminalSequences(chunk);
  };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Parse terminal SGR attributes.
  for (const match of styled.matchAll(/\x1b\[([\d;]*)m/g)) {
    append(styled.slice(position, match.index));
    const codes = (match[1] || "0").split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 38 || code === 48 || code === 58) {
        // RGB/indexed color operands are values, not inverse/reset attributes.
        if (codes[i + 1] === 2) i += 4;
        else if (codes[i + 1] === 5) i += 2;
        continue;
      }
      if (code === 7 && !inverse) {
        inverse = true;
        start = text.length;
      }
      if ((code === 0 || code === 27) && inverse) {
        if (text.length > start) changes.push({ start, end: text.length });
        inverse = false;
      }
    }
    position = match.index + match[0].length;
  }
  append(styled.slice(position));
  if (inverse && text.length > start) changes.push({ start, end: text.length });
  return { text, changes };
}

function ansi(
  color: keyof typeof COLORS,
  mode: "truecolor" | "256color",
  background = false,
): string {
  const [rgb, indexed] = COLORS[color];
  return `\x1b[${background ? 48 : 38};${mode === "truecolor" ? `2;${rgb}` : `5;${indexed}`}m`;
}

/** Repaint syntax resets and inverse ranges without moving any source characters. */
function highlightWords(
  styled: string,
  content: DiffText,
  foreground: string,
  row: string,
  word: string,
): string {
  let offset = 0;
  let changed = false;
  let output = "";
  const boundaries = new Set(content.changes.flatMap(({ start, end }) => [start, end]));
  const isChanged = (index: number) =>
    content.changes.some(({ start, end }) => index >= start && index < end);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Keep syntax SGR tokens separate from source text.
  const chunks = styled.split(/(\x1b\[[\d;]*m)/g);
  for (const chunk of chunks) {
    if (chunk.startsWith("\x1b[")) {
      if (chunk === "\x1b[0m") output += `${foreground}${changed ? word : row}`;
      else if (chunk === "\x1b[39m") output += foreground;
      else if (chunk === "\x1b[49m") output += changed ? word : row;
      else output += chunk;
      continue;
    }
    for (const char of chunk) {
      if (boundaries.has(offset) || offset === 0) {
        const next = isChanged(offset);
        if (next !== changed) {
          changed = next;
          output += changed ? word : row;
        }
      }
      output += char;
      offset += char.length;
    }
  }
  return `${output}${row}`;
}

export function referenceDiffLine(
  number: string,
  sign: string,
  body: string,
  theme: Theme,
  filePath?: string,
): (width: number) => string {
  const content = readDiffHighlights(body);
  const mode = theme.getColorMode();
  const foreground = ansi("text", mode);
  const changed = sign === "+" || sign === "-";
  const added = sign === "+";
  const row = changed ? ansi(added ? "addedRow" : "removedRow", mode, true) : "\x1b[49m";
  const word = changed ? ansi(added ? "addedWord" : "removedWord", mode, true) : row;
  const gutter = changed ? ansi(added ? "added" : "removed", mode) : foreground;
  // Removed lines in the reference have plain text; added/context lines retain
  // syntax coloring. The host's public highlighter owns language support.
  const language = filePath ? getLanguageFromPath(filePath) : undefined;
  const syntax = sign !== "-" && language ? highlightCode(content.text, language)[0] : undefined;
  const source = syntax && stripTerminalSequences(syntax) === content.text ? syntax : content.text;
  const code = highlightWords(source, content, foreground, row, word);
  const prefix = `${number} ${sign}`;
  return (width) => {
    if (width <= 0) return "";
    // The reference code pane leaves seven cells after the indented result.
    const available = Math.max(1, width > 7 ? width - 7 : width);
    const styled = `${row}${gutter}${prefix}${foreground}${code}`;
    const fitted = truncateToWidth(styled, available, "");
    const padding = changed ? " ".repeat(Math.max(0, available - visibleWidth(fitted))) : "";
    return `${fitted}${row}${padding}\x1b[39m\x1b[49m\x1b[27m`;
  };
}

export function numberedDiff(diff: string, theme: Theme, filePath?: string): ToolDetailLine[] {
  const rows = renderDiff(diff)
    .split("\n")
    .map((styled) => ({
      styled,
      prefix: stripTerminalSequences(styled).match(/^([+ -])(\s*\d+) /),
    }));
  const digits = Math.max(2, ...rows.map(({ prefix }) => prefix?.[2].trim().length ?? 0));
  const noColor =
    Boolean(process.env.NO_COLOR) && (!process.env.FORCE_COLOR || process.env.FORCE_COLOR === "0");
  const reference =
    !noColor && theme.name === "pi-tuix-dark" && typeof theme.getColorMode === "function";
  return rows.map(({ styled, prefix }) => {
    if (!prefix) return styled;
    const sign = prefix[1];
    const color =
      sign === "+" ? "toolDiffAdded" : sign === "-" ? "toolDiffRemoved" : "toolDiffContext";
    const body = sliceByColumn(styled, prefix[0].length, visibleWidth(styled));
    const number = prefix[2].trim().padStart(digits);
    return reference
      ? referenceDiffLine(number, sign, body, theme, filePath)
      : `${theme.fg("dim", number)} ${theme.fg(color, sign)}${body}`;
  });
}
