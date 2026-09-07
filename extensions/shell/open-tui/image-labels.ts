const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function hasImageLabels(text: string): boolean {
  return /\[Image #\d+\]/.test(text);
}

/** Literal labels are editable text spans; they never identify image payloads. */
export function imageLabelAt(text: string, col: number, backwards: boolean) {
  for (const match of text.matchAll(/\[Image #\d+\]/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (backwards ? col > start && col <= end : col >= start && col < end) return { start, end };
  }
}

/** Keep literal image labels whole while preserving native UTF-16 positions. */
export function segmentImageLabels(text: string): { segment: string; index: number }[] {
  const segments: { segment: string; index: number }[] = [];
  let offset = 0;
  const append = (end: number) => {
    for (const { segment, index } of segmenter.segment(text.slice(offset, end)))
      segments.push({ segment, index: offset + index });
  };
  for (const match of text.matchAll(/\[Image #\d+\]/g)) {
    append(match.index);
    segments.push({ segment: match[0], index: match.index });
    offset = match.index + match[0].length;
  }
  append(text.length);
  return segments;
}
