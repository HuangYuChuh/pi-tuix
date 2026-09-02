import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentActivityObserver } from "../../session/subagent-activity.ts";
import {
  DEFAULT_CONFIG,
  ensureConfigExists,
  loadConfig,
  type OpenTuiConfig,
  saveConfig,
} from "./config.ts";
import { installEditor } from "./editor.ts";
import { installFooter } from "./footer.ts";
import { emptyGitStatus, readGitStatus } from "./git.ts";
import { installHeader } from "./header.ts";
import { readRuntimeInfo } from "./runtime.ts";
import { SessionLifecycle } from "./session-lifecycle.ts";
import { registerSettingsCommand } from "./settings-command.ts";
import {
  createInitialState,
  type FooterState,
  getModelMeta,
  invalidateUsageCache,
} from "./state.ts";
import { formatTurnTelemetry, TurnTelemetryTracker } from "./telemetry.ts";

function isTuiContext(ctx: ExtensionContext): boolean {
  return ctx.hasUI && (ctx.mode === undefined || ctx.mode === "tui");
}

export interface OpenTuiShellRuntime {
  apply(ctx: ExtensionContext): void;
  remove(ctx: ExtensionContext): void;
  handleSessionStart(ctx: ExtensionContext): void;
  handleSessionShutdown(ctx: ExtensionContext): void;
  handleAgentStart(): void;
  handleAgentEnd(): void;
  handleAgentSettled(event: unknown, ctx: ExtensionContext): void;
  handleRefresh(ctx: ExtensionContext, project?: boolean): void;
}

export function createOpenTuiShellRuntime(
  pi: ExtensionAPI,
  subagentActivity?: SubagentActivityObserver,
): OpenTuiShellRuntime {
  const lifecycle = new SessionLifecycle();
  const state: FooterState = createInitialState();
  const telemetry = new TurnTelemetryTracker();
  let config: OpenTuiConfig = structuredClone(DEFAULT_CONFIG);
  let active = false;
  let context: ExtensionContext | undefined;
  let requestRender: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposeHeader: (() => void) | undefined;
  let disposeFooter: (() => void) | undefined;
  let editor: ReturnType<typeof installEditor> | undefined;

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const refresh = (ctx: ExtensionContext, project = false) => {
    if (!lifecycle.isCurrent() || !ctx.hasUI) return;
    if (project) {
      void refreshGit(ctx);
      void refreshRuntime(ctx);
    }
    requestRender?.();
  };
  const refreshGit = async (ctx: ExtensionContext) => {
    if (!lifecycle.isCurrent()) return;
    const generation = lifecycle.currentGeneration();
    if (
      !config.footerSegments.gitBranch &&
      !config.footerSegments.gitStatus &&
      !config.footerSegments.gitCommit
    ) {
      state.git = emptyGitStatus();
    } else {
      state.git = await readGitStatus(ctx.cwd, {
        readCommit: true,
        readTag: config.footerSegments.gitCommit,
        readCounts: config.footerSegments.gitStatus,
      });
    }
    if (lifecycle.isCurrent(generation)) requestRender?.();
  };
  const refreshRuntime = async (ctx: ExtensionContext) => {
    if (!lifecycle.isCurrent()) return;
    const generation = lifecycle.currentGeneration();
    const runtime = await readRuntimeInfo(ctx.cwd);
    if (lifecycle.isCurrent(generation)) {
      state.runtime = runtime;
      requestRender?.();
    }
  };
  const remove = (ctx: ExtensionContext) => {
    if (!active || !isTuiContext(ctx)) return;
    stopTimer();
    disposeHeader?.();
    disposeFooter?.();
    editor?.cleanup();
    disposeHeader = undefined;
    disposeFooter = undefined;
    editor = undefined;
    requestRender = undefined;
    active = false;
  };
  const apply = (ctx: ExtensionContext) => {
    if (!isTuiContext(ctx) || active) return;
    disposeHeader = installHeader(pi, ctx);
    disposeFooter = installFooter(
      ctx,
      () => state,
      () => config,
      () => getModelMeta(ctx, () => (lifecycle.isCurrent() ? pi.getThinkingLevel() : "off")),
      {
        setRequestRender: (fn) => {
          requestRender = fn;
        },
        scheduleGitRefresh: () => {
          void refreshGit(ctx);
        },
        getSubagentActivity: subagentActivity?.getState,
      },
    );
    editor = installEditor(pi, ctx, config.cursorStyle, config.fullscreen.wheelScrollLines);
    active = true;
  };

  ensureConfigExists();
  config = loadConfig();
  registerSettingsCommand(pi, {
    getConfig: () => config,
    onConfigChanged: (next) => {
      const cursorChanged = config.cursorStyle !== next.cursorStyle;
      const wheelChanged = config.fullscreen.wheelScrollLines !== next.fullscreen.wheelScrollLines;
      config = next;
      saveConfig(config);
      if (cursorChanged) editor?.setCursorStyle(config.cursorStyle);
      if (wheelChanged) editor?.setWheelScrollLines(config.fullscreen.wheelScrollLines);
      if (context) refresh(context, true);
    },
    onOverlayClosed: () => {
      if (!context) return;
      if (config.enabled) apply(context);
      else remove(context);
    },
  });

  return {
    apply,
    remove,
    handleSessionStart(ctx) {
      lifecycle.start();
      subagentActivity?.reset();
      subagentActivity?.setOnChange(() => requestRender?.());
      context = ctx;
      state.sessionStartEpoch = Date.now();
      state.workingSince = undefined;
      state.lastDoneIn = undefined;
      invalidateUsageCache();
      config = loadConfig((message, level) => ctx.ui.notify(message, level));
    },
    handleSessionShutdown(ctx) {
      lifecycle.shutdown();
      subagentActivity?.setOnChange(undefined);
      remove(ctx);
      context = undefined;
    },
    handleAgentStart() {
      if (!lifecycle.isCurrent()) return;
      state.workingSince = Date.now();
      state.lastDoneIn = undefined;
      stopTimer();
      timer = setInterval(() => requestRender?.(), 250);
      timer.unref?.();
    },
    handleAgentEnd() {
      if (!lifecycle.isCurrent()) return;
      stopTimer();
      if (state.workingSince !== undefined) {
        state.lastDoneIn = Date.now() - state.workingSince;
        state.workingSince = undefined;
      }
      requestRender?.();
    },
    handleAgentSettled(event, ctx) {
      const result = telemetry.handle(event as never);
      if (result && config.telemetry.enabled && isTuiContext(ctx)) {
        const message = formatTurnTelemetry(
          result,
          ctx.ui.theme,
          config.telemetry,
          config.icons.mode,
        );
        if (message) ctx.ui.notify(message, "info");
      }
    },
    handleRefresh(ctx, project = false) {
      invalidateUsageCache();
      refresh(ctx, project);
    },
  };
}
