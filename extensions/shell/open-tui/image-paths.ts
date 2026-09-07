import { isAbsolute } from "node:path";

export interface PastedPath {
  raw: string;
  path: string;
}

/** Parse terminal file-drop text as paths, without evaluating shell syntax. */
export function splitPastedPaths(text: string): PastedPath[] | undefined {
  if (text.length > 64 * 1024) return;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if ((code < 32 && !"\t\r\n".includes(character)) || (code >= 127 && code < 160)) return;
  }
  const paths: PastedPath[] = [];
  let start = 0;
  while (start < text.length) {
    if (/\s/.test(text[start])) {
      start++;
      continue;
    }
    let end = start;
    let path = "";
    let quote = "";
    for (; end < text.length; end++) {
      const character = text[end];
      if (!quote && /\s/.test(character)) break;
      if (character === quote) quote = "";
      else if (!quote && (character === "'" || character === '"')) quote = character;
      else if (character === "\\" && quote !== "'") {
        if (++end === text.length) return;
        path += text[end];
      } else path += character;
    }
    if (
      quote ||
      !path ||
      (!isAbsolute(path) && !path.startsWith("~/") && !path.startsWith("file:"))
    )
      return;
    paths.push({ raw: text.slice(start, end), path });
    if (paths.length > 64) return;
    start = end;
  }
  return paths.length > 1 ? paths : undefined;
}
