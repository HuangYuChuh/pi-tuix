import {
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { formatCwd, formatModelLabel, truncateToWidth } from "./utils.ts";

export function renderStartupHeader(
  model: string,
  effort: string,
  cwd: string,
  theme: Theme,
  width: number,
): string[] {
  if (width <= 0) return [];
  const inset = width >= 40 ? "           " : " ";
  const identity = width >= 40 ? `${theme.fg("accent", "  [pi] ")}    ` : " ";
  return [
    "",
    `${identity}${theme.bold("Pi-TUIX")} ${theme.fg("dim", `Pi v${VERSION}`)}`,
    `${inset}${theme.fg("muted", effort && effort !== "off" ? `${model} with ${effort} effort` : model)}`,
    `${inset}${theme.fg("dim", formatCwd(cwd))}`,
    "",
  ].map((line) => truncateToWidth(line, width, ""));
}

/** Compact startup identity, based on the observed three-row terminal layout. */
export class OpenTuiHeader implements Component {
  private readonly pi: ExtensionAPI;
  private readonly ctx: ExtensionContext;

  constructor(pi: ExtensionAPI, ctx: ExtensionContext, _tui: TUI) {
    this.pi = pi;
    this.ctx = ctx;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const theme = this.ctx.ui.theme;
    const model = this.ctx.model ? formatModelLabel(this.ctx.model) : "No model selected";
    const effort = this.pi.getThinkingLevel();
    return renderStartupHeader(model, effort, this.ctx.cwd, theme, width);
  }

  invalidate(): void {}
  dispose(): void {}
}

export function installHeader(pi: ExtensionAPI, ctx: ExtensionContext): () => void {
  ctx.ui.setHeader((tui) => new OpenTuiHeader(pi, ctx, tui));
  return () => ctx.ui.setHeader(undefined);
}
