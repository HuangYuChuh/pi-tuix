import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import {
  createEditorChromeRuntime,
  createPiTuixEditor,
  detachEditorChrome,
  setEditorWorking,
  type EditorChromeRuntime,
} from "./shell/editor.ts";
import { registerCompactToolRenderers, type ToolRendererMode } from "./tools/renderers.ts";
import {
  beginAgentRun,
  createWorkflowRuntime,
  finishAgentRun,
  finishTool,
  formatWorkflowStatus,
  queueMessage,
  settleAgent,
  startTool,
  type WorkflowRuntime,
} from "./stream/workflow-status.ts";

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
  private readonly ctx: ExtensionContext;

  constructor(ctx: ExtensionContext) {
    this.ctx = ctx;
  }

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
  private readonly ctx: ExtensionContext;
  private readonly workflow: WorkflowRuntime;
  private readonly tui: TUI;

  constructor(ctx: ExtensionContext, workflow: WorkflowRuntime, tui: TUI) {
    this.ctx = ctx;
    this.workflow = workflow;
    this.tui = tui;
    workflow.requestRender = () => tui.requestRender();
  }

  render(width: number): string[] {
    const theme: Theme = this.ctx.ui.theme;
    const left = theme.fg("muted", `${this.ctx.model?.id ?? "no-model"} · ${formatContext(this.ctx)}`);
    const right = theme.fg("dim", formatCwd(this.ctx.cwd));
    const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
    return [truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width), formatWorkflowStatus(this.workflow, theme, width)];
  }

  invalidate(): void {}

  dispose(): void {
    this.tui.requestRender();
  }
}

function applyPiTuix(
  ctx: ExtensionContext,
  toolMode: ToolRendererMode,
  editorRuntime: EditorChromeRuntime,
  workflow: WorkflowRuntime,
): void {
  if (ctx.mode !== "tui") return;
  toolMode.enabled = true;
  setEditorWorking(editorRuntime, false);
  ctx.ui.setTitle(PACKAGE_NAME);
  ctx.ui.setHeader(() => new PiTuixHeader(ctx));
  ctx.ui.setFooter((tui) => new PiTuixFooter(ctx, workflow, tui));
  ctx.ui.setEditorComponent((tui, theme, keybindings) =>
    createPiTuixEditor(tui, theme, keybindings, editorRuntime),
  );
  ctx.ui.setWorkingIndicator({
    frames: ["◐", "◓", "◑", "◒"].map((frame) => ctx.ui.theme.fg("accent", frame)),
    intervalMs: 120,
  });
}

export default function piTuix(pi: ExtensionAPI): void {
  const toolMode: ToolRendererMode = { enabled: false };
  const editorRuntime = createEditorChromeRuntime();
  const workflow = createWorkflowRuntime();
  registerCompactToolRenderers(pi, toolMode);

  pi.on("session_start", (_event, ctx) => applyPiTuix(ctx, toolMode, editorRuntime, workflow));
  pi.on("agent_start", () => {
    beginAgentRun(workflow);
    setEditorWorking(editorRuntime, true);
  });
  pi.on("agent_end", () => {
    finishAgentRun(workflow);
    setEditorWorking(editorRuntime, false);
  });
  pi.on("agent_settled", () => settleAgent(workflow));
  pi.on("input", (event) => {
    if (event.streamingBehavior) queueMessage(workflow);
  });
  pi.on("tool_execution_start", (event) => startTool(workflow, event.toolName));
  pi.on("tool_execution_end", (event) => finishTool(workflow, event.isError));
  pi.on("session_shutdown", () => detachEditorChrome(editorRuntime));

  pi.registerCommand("pituix", {
    description: "Show Pi-TUIX status and restore its interface",
    handler: async (_args, ctx) => {
      applyPiTuix(ctx, toolMode, editorRuntime, workflow);
      ctx.ui.notify(`${PACKAGE_NAME} interface enabled`, "info");
    },
  });

  pi.registerCommand("pituix-default", {
    description: "Restore Pi's default TUI components",
    handler: async (_args, ctx) => {
      toolMode.enabled = false;
      ctx.ui.setTitle("pi");
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
      ctx.ui.setEditorComponent(undefined);
      detachEditorChrome(editorRuntime);
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
