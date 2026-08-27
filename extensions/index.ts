import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  clearPlan,
  createPlanRuntime,
  type PlanRuntime,
  syncPlanWidget,
  updatePlan,
} from "./control/plan.ts";
import {
  createEditorChromeRuntime,
  createPiTuixEditor,
  detachEditorChrome,
  type EditorChromeRuntime,
  setEditorWorking,
} from "./shell/editor.ts";
import {
  beginAgentRun,
  createWorkflowRuntime,
  finishAgentRun,
  finishTool,
  formatContextPressure,
  formatWorkflowStatus,
  queueMessage,
  refreshWorkflow,
  setStreamActivity,
  settleAgent,
  startTool,
  startTurn,
  type WorkflowRuntime,
} from "./stream/workflow-status.ts";
import { registerCompactToolRenderers, type ToolRendererMode } from "./tools/renderers.ts";
import {
  registerThreeLayerToolRenderers,
  type ToolRendererMode as ThreeLayerMode,
} from "./tools/renderers-v2.ts";
import type { DisplayMode } from "./tools/three-layer-view.ts";

const PACKAGE_NAME = "Pi-TUIX";

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
    return [
      truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width),
      theme.fg("dim", "  Claude Code-inspired interface for Pi"),
    ];
  }

  invalidate(): void {}
}

class PiTuixFooter implements Component {
  private readonly ctx: ExtensionContext;
  private readonly workflow: WorkflowRuntime;
  private readonly requestRender: () => void;

  constructor(ctx: ExtensionContext, workflow: WorkflowRuntime, tui: TUI) {
    this.ctx = ctx;
    this.workflow = workflow;
    this.requestRender = () => tui.requestRender();
    workflow.requestRender = this.requestRender;
  }

  render(width: number): string[] {
    const theme: Theme = this.ctx.ui.theme;
    const usage = this.ctx.getContextUsage();
    const model = theme.fg("muted", this.ctx.model?.id ?? "no-model");
    const thinking = theme.fg("dim", `think ${this.ctx.thinkingLevel ?? "off"}`);
    const context = formatContextPressure(usage?.percent ?? null, theme);
    const left = `${model} · ${thinking} · ${context}`;
    const right = theme.fg("dim", formatCwd(this.ctx.cwd));
    const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
    return [
      truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width),
      formatWorkflowStatus(this.workflow, theme, width),
    ];
  }

  invalidate(): void {}

  dispose(): void {
    if (this.workflow.requestRender === this.requestRender) {
      this.workflow.requestRender = undefined;
    }
  }
}

function applyPiTuix(
  ctx: ExtensionContext,
  toolMode: ToolRendererMode,
  threeLayerMode: ThreeLayerMode,
  editorRuntime: EditorChromeRuntime,
  workflow: WorkflowRuntime,
  plan: PlanRuntime,
  useThreeLayer: boolean = true,
): void {
  if (ctx.mode !== "tui") return;

  // 启用对应的渲染器
  if (useThreeLayer) {
    threeLayerMode.enabled = true;
    toolMode.enabled = false;
  } else {
    toolMode.enabled = true;
    threeLayerMode.enabled = false;
  }
  setEditorWorking(editorRuntime, false);
  ctx.ui.setTitle(PACKAGE_NAME);
  ctx.ui.setHeader(() => new PiTuixHeader(ctx));
  ctx.ui.setFooter((tui) => new PiTuixFooter(ctx, workflow, tui));
  syncPlanWidget(ctx, plan);
  ctx.ui.setEditorComponent((tui, theme, keybindings) =>
    createPiTuixEditor(tui, theme, keybindings, editorRuntime),
  );
  ctx.ui.setWorkingIndicator({
    frames: ["◐", "◓", "◑", "◒"].map((frame) => ctx.ui.theme.fg("accent", frame)),
    intervalMs: 120,
  });
  ctx.ui.setHiddenThinkingLabel("Thinking details hidden");
}

export default function piTuix(pi: ExtensionAPI): void {
  // 工具渲染模式配置
  const toolMode: ToolRendererMode = { enabled: false };
  const threeLayerMode: ThreeLayerMode = {
    enabled: false,
    defaultMode: "preview" as DisplayMode, // collapsed | preview | expanded
  };

  const editorRuntime = createEditorChromeRuntime();
  const workflow = createWorkflowRuntime();
  const plan = createPlanRuntime();

  // 注册两套渲染器（可切换）
  registerCompactToolRenderers(pi, toolMode);
  registerThreeLayerToolRenderers(pi, threeLayerMode);

  pi.on("session_start", (_event, ctx) => {
    clearPlan(plan);
    plan.visible = true;
    applyPiTuix(ctx, toolMode, threeLayerMode, editorRuntime, workflow, plan, true);
  });
  pi.on("agent_start", () => {
    beginAgentRun(workflow);
    setEditorWorking(editorRuntime, true);
  });
  pi.on("agent_end", () => {
    finishAgentRun(workflow);
    setEditorWorking(editorRuntime, false);
  });
  pi.on("agent_settled", () => settleAgent(workflow));
  pi.on("turn_start", (event) => startTurn(workflow, event.turnIndex));
  pi.on("turn_end", (event, ctx) => {
    if (updatePlan(plan, event.message) && (toolMode.enabled || threeLayerMode.enabled)) {
      syncPlanWidget(ctx, plan);
    }
    refreshWorkflow(workflow);
  });
  pi.on("message_update", (event) => {
    const type = event.assistantMessageEvent.type;
    if (type === "thinking_start" || type === "thinking_delta")
      setStreamActivity(workflow, "THINKING");
    if (type === "text_start" || type === "text_delta") setStreamActivity(workflow, "RESPONDING");
    if (type === "toolcall_start" || type === "toolcall_delta") setStreamActivity(workflow, "TOOL");
  });
  pi.on("thinking_level_select", () => refreshWorkflow(workflow));
  pi.on("input", (event) => {
    if (event.streamingBehavior === "followUp") queueMessage(workflow);
  });
  pi.on("tool_execution_start", (event) => startTool(workflow, event.toolName));
  pi.on("tool_execution_end", (event) => finishTool(workflow, event.isError));
  pi.on("session_shutdown", () => detachEditorChrome(editorRuntime));

  pi.registerCommand("pituix", {
    description: "Show Pi-TUIX status and restore its interface",
    handler: async (_args, ctx) => {
      applyPiTuix(ctx, toolMode, threeLayerMode, editorRuntime, workflow, plan, true);
      ctx.ui.notify(`${PACKAGE_NAME} interface enabled (three-layer mode)`, "info");
    },
  });

  pi.registerCommand("pituix-default", {
    description: "Restore Pi's default TUI components",
    handler: async (_args, ctx) => {
      toolMode.enabled = false;
      threeLayerMode.enabled = false;
      ctx.ui.setTitle("pi");
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
      ctx.ui.setWidget("pituix-plan", undefined);
      ctx.ui.setEditorComponent(undefined);
      detachEditorChrome(editorRuntime);
      ctx.ui.setWorkingIndicator();
      ctx.ui.setHiddenThinkingLabel();
      ctx.ui.notify("Pi default interface restored", "info");
    },
  });

  pi.registerCommand("pituix-compact", {
    description: "Switch to compact tool rendering (original Pi-TUIX v0.1)",
    handler: async (_args, ctx) => {
      applyPiTuix(ctx, toolMode, threeLayerMode, editorRuntime, workflow, plan, false);
      ctx.ui.notify(`${PACKAGE_NAME} compact mode enabled`, "info");
    },
  });

  pi.registerCommand("pituix-three-layer", {
    description: "Switch to three-layer tool rendering (collapsed/preview/expanded)",
    handler: async (_args, ctx) => {
      applyPiTuix(ctx, toolMode, threeLayerMode, editorRuntime, workflow, plan, true);
      ctx.ui.notify(`${PACKAGE_NAME} three-layer mode enabled`, "info");
    },
  });

  pi.registerCommand("pituix-mode", {
    description: "Set default tool display mode: collapsed, preview, or expanded",
    handler: async (args, ctx) => {
      const mode = args.trim().toLowerCase() as DisplayMode;
      if (mode !== "collapsed" && mode !== "preview" && mode !== "expanded") {
        ctx.ui.notify("Usage: /pituix-mode <collapsed|preview|expanded>", "warning");
        return;
      }
      threeLayerMode.defaultMode = mode;
      ctx.ui.notify(`Default tool mode: ${mode}`, "info");
    },
  });

  pi.registerCommand("pituix-about", {
    description: "Show Pi-TUIX positioning and current compatibility",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`${PACKAGE_NAME} 0.1.0 · Pi ${VERSION} compatible`, "info");
    },
  });

  pi.registerCommand("pituix-steer", {
    description: "Send an immediate steering message while Pi is working",
    handler: async (args, ctx) => {
      const text = args.trim();
      if (!text) {
        ctx.ui.notify("Usage: /pituix-steer <message>", "warning");
        return;
      }
      if (ctx.isIdle()) {
        pi.sendUserMessage(text);
        ctx.ui.notify("Steering message sent", "info");
        return;
      }
      pi.sendUserMessage(text, { deliverAs: "steer" });
      ctx.ui.notify("Steering message sent", "info");
    },
  });

  pi.registerCommand("pituix-followup", {
    description: "Queue a follow-up message after the current Pi run",
    handler: async (args, ctx) => {
      const text = args.trim();
      if (!text) {
        ctx.ui.notify("Usage: /pituix-followup <message>", "warning");
        return;
      }
      if (ctx.isIdle()) {
        pi.sendUserMessage(text);
        ctx.ui.notify("Follow-up started", "info");
        return;
      }
      pi.sendUserMessage(text, { deliverAs: "followUp" });
      ctx.ui.notify("Follow-up queued", "info");
    },
  });

  pi.registerCommand("pituix-queue", {
    description: "Show queued follow-up messages and Pi queue state",
    handler: async (_args, ctx) => {
      const count = workflow.queuedMessages;
      const pending = ctx.hasPendingMessages();
      const suffix = pending ? "Pi has pending messages" : "Pi queue is clear";
      ctx.ui.notify(`Follow-ups: ${count} · ${suffix}`, pending ? "warning" : "info");
    },
  });

  pi.registerCommand("pituix-plan", {
    description: "Show, hide, or clear the detected plan panel",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "show";
      if (action === "clear") {
        clearPlan(plan);
        syncPlanWidget(ctx, plan);
        ctx.ui.notify("Plan cleared", "info");
        return;
      }
      if (action === "hide") {
        plan.visible = false;
        syncPlanWidget(ctx, plan);
        ctx.ui.notify("Plan panel hidden", "info");
        return;
      }
      if (action !== "show") {
        ctx.ui.notify("Usage: /pituix-plan [show|hide|clear]", "warning");
        return;
      }
      if (!toolMode.enabled && !threeLayerMode.enabled) {
        ctx.ui.notify("Enable Pi-TUIX with /pituix before showing the plan panel", "warning");
        return;
      }
      if (plan.items.length === 0) {
        ctx.ui.notify("No numbered plan detected in this session", "warning");
        return;
      }
      plan.visible = true;
      syncPlanWidget(ctx, plan);
      const complete = plan.items.filter((item) => item.completed).length;
      ctx.ui.notify(`Plan ${complete}/${plan.items.length}`, "info");
    },
  });
}
