import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import {
  clearPlan,
  createPlanRuntime,
  type PlanRuntime,
  syncPlanWidget,
  updatePlan,
} from "./control/plan.ts";
import { createOpenTuiShellRuntime } from "./shell/open-tui/shell.ts";
import {
  beginAgentRun,
  createWorkflowRuntime,
  finishAgentRun,
  finishTool,
  queueMessage,
  refreshWorkflow,
  setStreamActivity,
  settleAgent,
  startTool,
  startTurn,
} from "./stream/workflow-status.ts";
import { registerCompactToolRenderers, type ToolRendererMode } from "./tools/renderers.ts";
import {
  registerThreeLayerToolRenderers,
  type ToolRendererMode as ThreeLayerMode,
} from "./tools/renderers-v2.ts";
import type { DisplayMode } from "./tools/three-layer-view.ts";

const PACKAGE_NAME = "Pi-TUIX";

function applyPiTuix(
  ctx: ExtensionContext,
  toolMode: ToolRendererMode,
  threeLayerMode: ThreeLayerMode,
  shell: ReturnType<typeof createOpenTuiShellRuntime>,
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
  ctx.ui.setTitle(PACKAGE_NAME);
  shell.apply(ctx);
  syncPlanWidget(ctx, plan);
}

export default function piTuix(pi: ExtensionAPI): void {
  // 工具渲染模式配置
  const toolMode: ToolRendererMode = { enabled: false };
  const threeLayerMode: ThreeLayerMode = {
    enabled: false,
    defaultMode: "preview" as DisplayMode, // collapsed | preview | expanded
  };

  const shell = createOpenTuiShellRuntime(pi);
  const workflow = createWorkflowRuntime();
  const plan = createPlanRuntime();

  // 注册两套渲染器（可切换）
  registerCompactToolRenderers(pi, toolMode);
  registerThreeLayerToolRenderers(pi, threeLayerMode);

  pi.on("session_start", (_event, ctx) => {
    shell.handleSessionStart(ctx);
    clearPlan(plan);
    plan.visible = true;
    applyPiTuix(ctx, toolMode, threeLayerMode, shell, plan, true);
    shell.handleRefresh(ctx, true);
  });
  pi.on("agent_start", () => {
    beginAgentRun(workflow);
    shell.handleAgentStart();
  });
  pi.on("agent_end", () => {
    finishAgentRun(workflow);
    shell.handleAgentEnd();
  });
  pi.on("agent_settled", (event, ctx) => {
    settleAgent(workflow);
    shell.handleAgentSettled(event, ctx);
  });
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
  pi.on("thinking_level_select", (_event, ctx) => {
    refreshWorkflow(workflow);
    shell.handleRefresh(ctx);
  });
  pi.on("model_select", (_event, ctx) => shell.handleRefresh(ctx));
  pi.on("input", (event) => {
    if (event.streamingBehavior === "followUp") queueMessage(workflow);
  });
  pi.on("tool_execution_start", (event) => startTool(workflow, event.toolName));
  pi.on("tool_execution_end", (event, ctx) => {
    finishTool(workflow, event.isError);
    shell.handleRefresh(ctx);
  });
  pi.on("message_end", (_event, ctx) => shell.handleRefresh(ctx));
  pi.on("session_compact", (_event, ctx) => shell.handleRefresh(ctx));
  pi.on("session_tree", (_event, ctx) => shell.handleRefresh(ctx));
  pi.on("session_shutdown", (_event, ctx) => shell.handleSessionShutdown(ctx));

  pi.registerCommand("pituix", {
    description: "Show Pi-TUIX status and restore its interface",
    handler: async (_args, ctx) => {
      applyPiTuix(ctx, toolMode, threeLayerMode, shell, plan, true);
      ctx.ui.notify(`${PACKAGE_NAME} interface enabled (three-layer mode)`, "info");
    },
  });

  pi.registerCommand("pituix-default", {
    description: "Restore Pi's default TUI components",
    handler: async (_args, ctx) => {
      toolMode.enabled = false;
      threeLayerMode.enabled = false;
      ctx.ui.setTitle("pi");
      shell.remove(ctx);
      ctx.ui.setWidget("pituix-plan", undefined);
      ctx.ui.notify("Pi default interface restored", "info");
    },
  });

  pi.registerCommand("pituix-compact", {
    description: "Switch to compact tool rendering (original Pi-TUIX v0.1)",
    handler: async (_args, ctx) => {
      applyPiTuix(ctx, toolMode, threeLayerMode, shell, plan, false);
      ctx.ui.notify(`${PACKAGE_NAME} compact mode enabled`, "info");
    },
  });

  pi.registerCommand("pituix-three-layer", {
    description: "Switch to three-layer tool rendering (collapsed/preview/expanded)",
    handler: async (_args, ctx) => {
      applyPiTuix(ctx, toolMode, threeLayerMode, shell, plan, true);
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
