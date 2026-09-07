import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import {
  clearPlan,
  createPlanRuntime,
  type PlanRuntime,
  syncPlanWidget,
  updatePlan,
} from "./control/plan.ts";
import { registerSessionTreeCommand } from "./session/session-tree.ts";
import { createSubagentActivityObserver } from "./session/subagent-activity.ts";
import { useAsciiChrome } from "./shell/open-tui/icons.ts";
import { createOpenTuiShellRuntime } from "./shell/open-tui/shell.ts";
import { RunPresentation, renderRunCompletion } from "./stream/run-presentation.ts";
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
  workflowWorkingLabel,
} from "./stream/workflow-status.ts";
import { registerThreeLayerToolRenderers, type ToolRendererMode } from "./tools/renderers-v2.ts";
import type { DisplayMode } from "./tools/three-layer-view.ts";
import { ToolGroupRuntime } from "./tools/tool-groups.ts";

const PACKAGE_NAME = "Pi-TUIX";

function applyPiTuix(
  ctx: ExtensionContext,
  toolMode: ToolRendererMode,
  shell: ReturnType<typeof createOpenTuiShellRuntime>,
  plan: PlanRuntime,
): void {
  if (ctx.mode !== "tui") return;

  toolMode.enabled = true;
  ctx.ui.setTitle(PACKAGE_NAME);
  shell.apply(ctx);
  syncPlanWidget(ctx, plan);
}

export default function piTuix(pi: ExtensionAPI): void {
  // 工具渲染模式配置
  const groups = new ToolGroupRuntime();
  const toolMode: ToolRendererMode = {
    enabled: false,
    defaultMode: "preview" as DisplayMode, // collapsed | preview | expanded
    groups,
  };

  const subagentActivity = createSubagentActivityObserver(pi);
  const shell = createOpenTuiShellRuntime(pi, subagentActivity);
  const workflow = createWorkflowRuntime();
  const run = new RunPresentation();
  let runTimer: ReturnType<typeof setInterval> | undefined;
  const stopRunTimer = () => {
    if (runTimer) clearInterval(runTimer);
    runTimer = undefined;
  };
  const showCompletion = (ctx: ExtensionContext) => {
    const completion = run.completion;
    if (ctx.mode !== "tui" || !toolMode.enabled || !completion) {
      ctx.ui.setWidget("pituix-completion", undefined);
      return;
    }
    ctx.ui.setWidget("pituix-completion", () => ({
      render: (width) => renderRunCompletion(completion, ctx.ui.theme, width, useAsciiChrome()),
      invalidate() {},
    }));
  };
  const plan = createPlanRuntime();
  registerSessionTreeCommand(pi);

  const toolRenderers = registerThreeLayerToolRenderers(pi, toolMode);
  const hydrateGroups = (ctx: ExtensionContext) => {
    groups.reset(ctx.cwd);
    if (ctx.mode === "tui") {
      for (const entry of ctx.sessionManager?.getBranch?.() ?? []) groups.recordEntry(entry);
    }
  };

  pi.on("session_start", (_event, ctx) => {
    stopRunTimer();
    run.reset();
    showCompletion(ctx);
    toolRenderers.clear();
    hydrateGroups(ctx);
    shell.handleSessionStart(ctx);
    clearPlan(plan);
    plan.visible = true;
    applyPiTuix(ctx, toolMode, shell, plan);
    workflow.requestRender = () => {
      if (ctx.mode !== "tui" || !toolMode.enabled) return;
      ctx.ui.setWorkingMessage?.(
        run.workingMessage(`${workflowWorkingLabel(workflow)}...`, Date.now(), useAsciiChrome()),
      );
      ctx.ui.setStatus?.(
        "pituix-queue",
        workflow.queuedMessages > 0 ? `${workflow.queuedMessages} follow-up queued` : undefined,
      );
    };
    shell.handleRefresh(ctx, true);
  });
  pi.on("agent_start", (_event, ctx) => {
    run.begin();
    showCompletion(ctx);
    stopRunTimer();
    if (ctx.mode === "tui") {
      runTimer = setInterval(() => refreshWorkflow(workflow), 1000);
      runTimer.unref?.();
    }
    beginAgentRun(workflow);
    shell.handleAgentStart();
  });
  pi.on("agent_end", (event) => {
    stopRunTimer();
    run.end(event.messages ?? []);
    finishAgentRun(workflow);
    shell.handleAgentEnd();
  });
  pi.on("agent_settled", (event, ctx) => {
    stopRunTimer();
    run.settle();
    showCompletion(ctx);
    settleAgent(workflow);
    shell.handleAgentSettled(event, ctx);
  });
  pi.on("turn_start", (event) => startTurn(workflow, event.turnIndex));
  pi.on("turn_end", (event, ctx) => {
    if (updatePlan(plan, event.message) && toolMode.enabled) {
      syncPlanWidget(ctx, plan);
    }
    refreshWorkflow(workflow);
  });
  pi.on("message_update", (event) => {
    run.observeMessage(event.message);
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
  pi.on("tool_execution_start", (event) => startTool(workflow, event.toolCallId, event.toolName));
  pi.on("tool_execution_end", (event, ctx) => {
    run.observeTool(event.toolCallId, event.result, event.isError);
    const affected = groups.complete(event.toolCallId, event.result, event.isError);
    if (toolMode.enabled && affected.length) toolRenderers.invalidate(affected);
    finishTool(workflow, event.toolCallId, event.isError);
    shell.handleRefresh(ctx);
  });
  pi.on("message_end", (event, ctx) => {
    run.observeMessage(event.message);
    if (ctx.mode === "tui") {
      const affected = groups.recordMessage(event.message);
      if (toolMode.enabled && affected.length) toolRenderers.invalidate(affected);
    }
    shell.handleRefresh(ctx);
  });
  pi.on("session_compact", (_event, ctx) => {
    hydrateGroups(ctx);
    toolRenderers.invalidate();
    shell.handleRefresh(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    run.completion = undefined;
    showCompletion(ctx);
    hydrateGroups(ctx);
    toolRenderers.invalidate();
    shell.handleRefresh(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    stopRunTimer();
    run.reset();
    showCompletion(ctx);
    toolRenderers.clear();
    groups.reset(ctx.cwd);
    shell.handleSessionShutdown(ctx);
  });

  pi.registerCommand("pituix", {
    description: "Show Pi-TUIX status and restore its interface",
    handler: async (_args, ctx) => {
      applyPiTuix(ctx, toolMode, shell, plan);
      toolRenderers.invalidate();
      showCompletion(ctx);
      ctx.ui.notify(`${PACKAGE_NAME} interface enabled (three-layer mode)`, "info");
    },
  });

  pi.registerCommand("pituix-default", {
    description: "Restore Pi's default TUI components",
    handler: async (_args, ctx) => {
      toolMode.enabled = false;
      showCompletion(ctx);
      ctx.ui.setTitle("pi");
      shell.remove(ctx);
      toolRenderers.invalidate();
      ctx.ui.setStatus?.("pituix-queue", undefined);
      ctx.ui.setWidget("pituix-plan", undefined);
      ctx.ui.notify("Pi default interface restored", "info");
    },
  });

  pi.registerCommand("pituix-compact", {
    description: "Show collapsed reference-style tool summaries",
    handler: async (_args, ctx) => {
      toolMode.defaultMode = "collapsed";
      applyPiTuix(ctx, toolMode, shell, plan);
      ctx.ui.setToolsExpanded?.(false);
      toolRenderers.invalidate();
      showCompletion(ctx);
      ctx.ui.notify(`${PACKAGE_NAME} compact mode enabled`, "info");
    },
  });

  pi.registerCommand("pituix-three-layer", {
    description: "Show reference-style tool previews with expansion",
    handler: async (_args, ctx) => {
      toolMode.defaultMode = "preview";
      applyPiTuix(ctx, toolMode, shell, plan);
      ctx.ui.setToolsExpanded?.(false);
      toolRenderers.invalidate();
      showCompletion(ctx);
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
      toolMode.defaultMode = mode;
      ctx.ui.setToolsExpanded?.(mode === "expanded");
      toolRenderers.invalidate();
      ctx.ui.notify(`Default tool mode: ${mode}`, "info");
    },
  });

  pi.registerCommand("pituix-about", {
    description: "Show Pi-TUIX positioning and current compatibility",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`${PACKAGE_NAME} · Pi ${VERSION} compatible`, "info");
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
      if (!toolMode.enabled) {
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
