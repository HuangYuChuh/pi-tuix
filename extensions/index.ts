import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

const PACKAGE_NAME = "Pi-TUIX";

function formatContext(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  if (!usage || usage.percent === null) return "ctx ?";
  return `ctx ${Math.round(usage.percent)}%`;
}

function formatCwd(cwd: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

class PiTuixHeader implements Component {
  constructor(private readonly ctx: ExtensionContext) {}

  render(width: number): string[] {
    const theme = this.ctx.ui.theme;
    const model = this.ctx.model ? `${this.ctx.model.provider}/${this.ctx.model.id}` : "no model";
    const left = theme.fg("accent", `◈ ${PACKAGE_NAME}`);
    const right = theme.fg("muted", `${model} · ${formatCwd(this.ctx.cwd)}`);
    const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
    return [truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width), theme.fg("dim", "  Claude Code-inspired interface for Pi")];
  }

  invalidate(): void {}
}

class PiTuixFooter implements Component {
  constructor(private readonly ctx: ExtensionContext) {}

  render(width: number): string[] {
    const theme: Theme = this.ctx.ui.theme;
    const left = theme.fg("muted", `${this.ctx.model?.id ?? "no-model"} · ${formatContext(this.ctx)}`);
    const right = theme.fg("dim", formatCwd(this.ctx.cwd));
    const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
    return [truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width)];
  }

  invalidate(): void {}
}

function applyPiTuix(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;
  ctx.ui.setTitle(PACKAGE_NAME);
  ctx.ui.setHeader(() => new PiTuixHeader(ctx));
  ctx.ui.setFooter(() => new PiTuixFooter(ctx));
  ctx.ui.setWorkingIndicator({
    frames: ["◐", "◓", "◑", "◒"].map((frame) => ctx.ui.theme.fg("accent", frame)),
    intervalMs: 120,
  });
}

export default function piTuix(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => applyPiTuix(ctx));

  pi.registerCommand("pituix", {
    description: "Show Pi-TUIX status and restore its interface",
    handler: async (_args, ctx) => {
      applyPiTuix(ctx);
      ctx.ui.notify(`${PACKAGE_NAME} interface enabled`, "info");
    },
  });

  pi.registerCommand("pituix-default", {
    description: "Restore Pi's default TUI components",
    handler: async (_args, ctx) => {
      ctx.ui.setTitle("pi");
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
      ctx.ui.setWorkingIndicator();
      ctx.ui.notify("Pi default interface restored", "info");
    },
  });

  pi.registerCommand("pituix-about", {
    description: "Show Pi-TUIX positioning and current compatibility",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`${PACKAGE_NAME} 0.1.0 · Pi ${VERSION} compatible`, "info");
    },
  });
}
