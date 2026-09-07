import { keyText, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface EffortState {
  enabled: boolean;
  level: string;
  ascii: boolean;
}

/** A display of the host's effective thinking level, not a permission mode. */
export function renderEffortLine(state: EffortState, theme: Theme, width: number): string {
  if (!state.enabled || width < 4) return "";
  const binding = keyText("app.thinking.cycle");
  const marker = state.ascii ? "*" : "◉";
  const short = `${marker} ${state.level}`;
  const full = binding ? `${short} ${state.ascii ? "|" : "·"} ${binding}` : short;
  const label = truncateToWidth(visibleWidth(full) <= width - 1 ? full : short, width - 1, "");
  return `${" ".repeat(Math.max(0, width - 1 - visibleWidth(label)))}${theme.fg("muted", label)} `;
}
