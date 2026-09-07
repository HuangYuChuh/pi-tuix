import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { registerModelPicker } from "../../control/model-picker.ts";
import type { PrepareImages } from "../../session/image-attachments.ts";
import { registerResumePicker } from "../../session/resume-picker.ts";
import type { SubagentActivityObserver } from "../../session/subagent-activity.ts";
import {
  DEFAULT_CONFIG,
  ensureConfigExists,
  loadConfig,
  type OpenTuiConfig,
  saveConfig,
} from "./config.ts";
import { DraftImages } from "./draft-images.ts";
import { installEditor } from "./editor.ts";
import { type EffortState, renderEffortLine } from "./effort.ts";
import { installFooter } from "./footer.ts";
import { emptyGitStatus, readGitStatus } from "./git.ts";
import { installHeader } from "./header.ts";
import { useAsciiChrome } from "./icons.ts";
import { createLiveTranscript } from "./live-transcript.ts";
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
  isEnabled(): boolean;
  useAscii(): boolean;
  setEnabled(enabled: boolean): void;
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
  onSettingsApplied?: (ctx: ExtensionContext) => void,
  prepareImages?: PrepareImages,
  onQueueRestored?: (ctx: ExtensionContext) => void,
): OpenTuiShellRuntime {
  const lifecycle = new SessionLifecycle();
  const state: FooterState = createInitialState();
  const telemetry = new TurnTelemetryTracker();
  const liveTranscript = createLiveTranscript(pi, prepareImages);
  let draftImages = new DraftImages(prepareImages, () => requestRender?.());
  pi.on("input", (event) => draftImages.transform(event));
  pi.on("message_start", (event) => draftImages.reserve(event.message));
  pi.on("message_end", (_event, ctx) => draftImages.observe(ctx.sessionManager.getBranch()));
  let config: OpenTuiConfig = structuredClone(DEFAULT_CONFIG);
  const effort: EffortState = { enabled: false, level: "off", ascii: false };
  const syncEffort = (ctx: ExtensionContext) => {
    effort.enabled = Boolean(ctx.model?.reasoning);
    effort.level = effort.enabled ? (ctx.thinkingLevel ?? pi.getThinkingLevel()) : "off";
    effort.ascii = useAsciiChrome(config.icons.mode);
  };
  let panelOpen = false;
  let active = false;
  let context: ExtensionContext | undefined;
  let requestRender: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let previousTheme: Theme | undefined;
  let disposeHeader: (() => void) | undefined;
  let disposeFooter: (() => void) | undefined;
  let editor: ReturnType<typeof installEditor> | undefined;

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const startTimer = () => {
    stopTimer();
    timer = setInterval(() => requestRender?.(), 250);
    timer.unref?.();
  };
  const refresh = (ctx: ExtensionContext, project = false) => {
    if (!lifecycle.isCurrent() || !ctx.hasUI) return;
    syncEffort(ctx);
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
    ctx.ui.setWorkingIndicator();
    ctx.ui.setWorkingMessage?.();
    ctx.ui.setHiddenThinkingLabel();
    if (previousTheme && ctx.ui.theme.name === "pi-tuix-dark") ctx.ui.setTheme(previousTheme);
    previousTheme = undefined;
    disposeHeader?.();
    disposeFooter?.();
    editor?.cleanup();
    disposeHeader = undefined;
    disposeFooter = undefined;
    editor = undefined;
    requestRender = undefined;
    active = false;
  };
  const applyIndicator = (ctx: ExtensionContext) => {
    ctx.ui.setWorkingIndicator({
      frames: (useAsciiChrome(config.icons.mode)
        ? [".", "*", "+", "*"]
        : ["·", "✻", "✽", "✶", "✳", "✢"]
      ).map((frame) => ctx.ui.theme.fg("accent", frame)),
      intervalMs: 120,
    });
  };
  const apply = (ctx: ExtensionContext) => {
    if (!isTuiContext(ctx)) return;
    syncEffort(ctx);
    if (active) {
      applyIndicator(ctx);
      requestRender?.();
      return;
    }
    const referenceTheme = ctx.ui.getTheme?.("pi-tuix-dark");
    if (referenceTheme) {
      previousTheme = ctx.ui.theme;
      ctx.ui.setTheme(referenceTheme);
    }
    applyIndicator(ctx);
    ctx.ui.setHiddenThinkingLabel("Thinking (expand to view)");
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
        isPanelOpen: () => panelOpen,
      },
    );
    editor = installEditor(
      pi,
      ctx,
      config.cursorStyle,
      config.fullscreen.wheelScrollLines,
      config.icons.mode,
      (width) => renderEffortLine(effort, ctx.ui.theme, width),
      (tui, activeEditor) => {
        activeEditor.onQueueRestored = () => onQueueRestored?.(ctx);
        return liveTranscript.mount(tui, activeEditor, ctx, () =>
          useAsciiChrome(config.icons.mode),
        );
      },
      draftImages,
    );
    active = true;
    if (state.workingSince !== undefined) startTimer();
  };

  pi.registerCommand("pituix-status", {
    description: "Toggle compact hints and detailed session statistics",
    handler: async (_args, ctx) => {
      if (!active) {
        ctx.ui.notify("Enable Pi-TUIX with /pituix before showing session statistics", "info");
        return;
      }
      config.footerStyle = config.footerStyle === "compact" ? "detailed" : "compact";
      saveConfig(config);
      requestRender?.();
    },
  });

  ensureConfigExists();
  config = loadConfig();
  const onPanelOpened = () => {
    panelOpen = true;
    requestRender?.();
  };
  const onPanelClosed = () => {
    panelOpen = false;
    requestRender?.();
  };
  registerModelPicker(pi, {
    ascii: () => useAsciiChrome(config.icons.mode),
    onOpen: onPanelOpened,
    onClose: onPanelClosed,
  });
  registerResumePicker(pi, {
    prepareImages,
    ascii: () => useAsciiChrome(config.icons.mode),
    onOpen: onPanelOpened,
    onClose: onPanelClosed,
    onResume: (replacement) => {
      // Pi 0.84 reapplies its saved theme after session_start. The public
      // post-switch callback is bound to the fresh session, after that reset.
      if (!config.enabled) return;
      const referenceTheme = replacement.ui.getTheme("pi-tuix-dark");
      if (referenceTheme) replacement.ui.setTheme(referenceTheme);
    },
  });
  registerSettingsCommand(pi, {
    getConfig: () => config,
    onOverlayOpened: onPanelOpened,
    onConfigChanged: (next) => {
      const iconsChanged = config.icons.mode !== next.icons.mode;
      const cursorChanged = config.cursorStyle !== next.cursorStyle;
      const wheelChanged = config.fullscreen.wheelScrollLines !== next.fullscreen.wheelScrollLines;
      config = next;
      saveConfig(config);
      if (iconsChanged) editor?.setIconMode(config.icons.mode);
      if (cursorChanged) editor?.setCursorStyle(config.cursorStyle);
      if (wheelChanged) editor?.setWheelScrollLines(config.fullscreen.wheelScrollLines);
      if (context) refresh(context, true);
    },
    onOverlayClosed: () => {
      onPanelClosed();
      if (!context) return;
      if (onSettingsApplied) onSettingsApplied(context);
      else if (config.enabled) apply(context);
      else remove(context);
    },
  });

  return {
    isEnabled: () => config.enabled,
    useAscii: () => useAsciiChrome(config.icons.mode),
    setEnabled(enabled) {
      config = { ...config, enabled };
      saveConfig(config);
    },
    apply,
    remove,
    handleSessionStart(ctx) {
      lifecycle.start();
      draftImages.dispose();
      draftImages = new DraftImages(prepareImages, () => requestRender?.());
      draftImages.observe(ctx.sessionManager.getBranch());
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
      draftImages.dispose();
      context = undefined;
    },
    handleAgentStart() {
      if (!lifecycle.isCurrent()) return;
      state.workingSince = Date.now();
      state.lastDoneIn = undefined;
      if (active) {
        liveTranscript.followLatest();
        startTimer();
      }
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
      if (result && active && config.telemetry.enabled && isTuiContext(ctx)) {
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
