import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

export interface CompactSummary {
  action: string;
  target: string;
  suffix: string;
}

function normalizeLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\t/g, "  ");
}

export class CompactToolView implements Component {
  private summary: CompactSummary;
  private details: string[];

  constructor(summary: CompactSummary, details: string[] = []) {
    this.summary = summary;
    this.details = details;
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const action = `${normalizeLine(this.summary.action)} `;
    const target = normalizeLine(this.summary.target);
    const suffix = ` ${normalizeLine(this.summary.suffix)}`;
    const fixedWidth = visibleWidth(action) + visibleWidth(suffix);

    let firstLine: string;
    if (fixedWidth < safeWidth) {
      const targetWidth = Math.max(1, safeWidth - fixedWidth);
      firstLine = `${action}${truncateToWidth(target, targetWidth)}${suffix}`;
    } else {
      firstLine = truncateToWidth(`${action}${target}${suffix}`, safeWidth);
    }

    const detailLines = this.details.map((line) =>
      truncateToWidth(`  ${line.replace(/\t/g, "  ").replace(/\r$/, "")}`, safeWidth),
    );

    return [truncateToWidth(firstLine, safeWidth), ...detailLines];
  }

  invalidate(): void {}
}
