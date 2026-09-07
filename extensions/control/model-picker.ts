import {
  type Api,
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Model,
  type ModelThinkingLevel,
  modelsAreEqual,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export interface ModelChoice {
  model: Model<Api>;
  thinkingLevel?: ModelThinkingLevel;
}

export interface ModelSelection {
  model: Model<Api>;
  thinkingLevel: ModelThinkingLevel;
}

/** Pi owns availability and scope; the picker only consumes those public views. */
export function getModelChoices(ctx: ExtensionContext): ModelChoice[] {
  const choices = ctx.scopedModels?.length
    ? ctx.scopedModels
    : ctx.modelRegistry.getAvailable().map((model) => ({ model }));
  const seen = new Set<string>();
  return choices.filter(({ model }) => {
    const id = `${model.provider}/${model.id}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export class ModelPicker {
  private selected: number;
  private readonly levels = new Map<number, ModelThinkingLevel>();
  private finished = false;
  private readonly choices: readonly ModelChoice[];
  private readonly current: Model<Api> | undefined;
  private readonly initialLevel: ModelThinkingLevel;
  private readonly theme: Theme;
  private readonly ascii: boolean;
  private readonly getRows: () => number;
  private readonly done: (selection: ModelSelection | undefined) => void;

  constructor(options: {
    choices: readonly ModelChoice[];
    current?: Model<Api>;
    thinkingLevel: ModelThinkingLevel;
    theme: Theme;
    ascii: boolean;
    getRows: () => number;
    done: (selection: ModelSelection | undefined) => void;
  }) {
    this.choices = options.choices;
    this.current = options.current;
    this.initialLevel = options.thinkingLevel;
    this.theme = options.theme;
    this.ascii = options.ascii;
    this.getRows = options.getRows;
    this.done = options.done;
    this.selected = Math.max(
      0,
      this.choices.findIndex(({ model }) => modelsAreEqual(model, this.current)),
    );
  }

  private level(): ModelThinkingLevel {
    const choice = this.choices[this.selected];
    if (!choice) return "off";
    return clampThinkingLevel(
      choice.model,
      this.levels.get(this.selected) ??
        (modelsAreEqual(choice.model, this.current)
          ? this.initialLevel
          : (choice.thinkingLevel ?? this.initialLevel)),
    );
  }

  handleInput(data: string): void {
    if (this.finished) return;
    const keys = getKeybindings();
    if (keys.matches(data, "tui.select.cancel")) {
      this.finished = true;
      this.done(undefined);
      return;
    }
    if (!this.choices.length) return;
    if (keys.matches(data, "tui.select.up")) {
      this.selected = (this.selected - 1 + this.choices.length) % this.choices.length;
    } else if (keys.matches(data, "tui.select.down")) {
      this.selected = (this.selected + 1) % this.choices.length;
    } else if (keys.matches(data, "tui.select.pageUp")) {
      this.selected = Math.max(0, this.selected - 5);
    } else if (keys.matches(data, "tui.select.pageDown")) {
      this.selected = Math.min(this.choices.length - 1, this.selected + 5);
    } else if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      const levels = getSupportedThinkingLevels(this.choices[this.selected].model);
      const direction = matchesKey(data, Key.right) ? 1 : -1;
      const index = Math.max(
        0,
        Math.min(levels.length - 1, levels.indexOf(this.level()) + direction),
      );
      if (levels[index]) this.levels.set(this.selected, levels[index]);
    } else if (keys.matches(data, "tui.select.confirm")) {
      this.finished = true;
      this.done({ model: this.choices[this.selected].model, thinkingLevel: this.level() });
    } else if (/^[1-9]$/.test(data) && Number(data) <= this.choices.length) {
      this.selected = Number(data) - 1;
    }
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const rows = Math.max(1, Math.floor(this.getRows()));
    const compact = rows < 12;
    const inset = width >= 16 ? "   " : "";
    const inner = Math.max(1, width - visibleWidth(inset) * 2);
    const accent = (text: string) => this.theme.fg("mdLink", text);
    const muted = (text: string) => this.theme.fg("muted", text);
    const clip = (line: string) => truncateToWidth(line, width, "");
    const title = `${inset}${accent(this.theme.bold("Select model"))}`;
    const heading = compact
      ? [title]
      : [
          accent((this.ascii ? "-" : "▔").repeat(width)),
          title,
          `${inset}${muted("Choose from Pi's available models for this session.")}`,
          "",
        ];
    const model = this.choices[this.selected]?.model;
    const adjustable = model && getSupportedThinkingLevels(model).length > 1;
    const effort = `${inset}${this.theme.fg("accent", this.ascii ? "*" : "◉")} ${muted(`${this.level()} effort`)}${adjustable ? muted(this.ascii ? "  left/right to adjust" : "  ←/→ to adjust") : ""}`;
    const hints = `${inset}${muted("Enter to select · Esc to cancel")}`;
    const footer = compact ? [effort, hints] : ["", effort, "", hints];
    const budget = Math.max(1, rows - heading.length - footer.length - (compact ? 0 : 2));
    const numbered = (index: number): string[] => {
      const { model: rowModel } = this.choices[index];
      const current = modelsAreEqual(rowModel, this.current);
      const prefix = `${index === this.selected ? (this.ascii ? ">" : "❯") : " "} ${index + 1}. `;
      const marker = current ? (this.ascii ? " [current]" : " ✔") : "";
      const fitName = (available: number) =>
        available > visibleWidth(marker)
          ? truncateToWidth(rowModel.name, available - visibleWidth(marker), "") + marker
          : truncateToWidth(rowModel.name, available, "");
      const nameColor = current ? "success" : index === this.selected ? "mdLink" : "text";
      const remaining = Math.max(1, inner - visibleWidth(prefix));
      if (width < 70 || compact) {
        return [`${inset}${accent(prefix)}${this.theme.fg(nameColor, fitName(remaining))}`];
      }
      const labelWidth = Math.min(23, Math.floor(remaining * 0.4));
      const fitted = fitName(labelWidth - 1);
      const context = `${Math.round(rowModel.contextWindow / 1000)}k context`;
      const description = `${rowModel.provider} · ${context} · ${rowModel.id}`;
      const wrapped = wrapTextWithAnsi(muted(description), Math.max(1, remaining - labelWidth));
      // Keep a selected row readable even in a short view with a long model ID.
      const detail = wrapped.slice(0, Math.min(2, budget));
      return detail.map((line, i) =>
        i === 0
          ? `${inset}${accent(prefix)}${this.theme.fg(nameColor, fitted)}${" ".repeat(labelWidth - visibleWidth(fitted))}${line}`
          : `${inset}${" ".repeat(visibleWidth(prefix) + labelWidth)}${line}`,
      );
    };
    const rendered = this.choices.map((_, index) => numbered(index));
    let start = this.selected;
    let end = this.selected + 1;
    let used = rendered[this.selected]?.length ?? 1;
    while (used < budget && (start > 0 || end < rendered.length)) {
      const before = start > 0 ? rendered[start - 1].length : Infinity;
      if (before + used <= budget) {
        used += before;
        start--;
      }
      const after = end < rendered.length ? rendered[end].length : Infinity;
      if (after + used <= budget) {
        used += after;
        end++;
      }
      if (
        used +
          Math.min(
            start > 0 ? rendered[start - 1].length : Infinity,
            end < rendered.length ? rendered[end].length : Infinity,
          ) >
        budget
      )
        break;
    }
    const body = rendered.length
      ? rendered.slice(start, end).flat()
      : [`${inset}${muted("No models available. Configure a provider in Pi.")}`];
    if (rows < 4) return body.slice(0, rows).map(clip);
    if (!compact && start > 0) heading.push(`${inset}${muted(`${start} more above`)}`);
    if (!compact && end < rendered.length)
      body.push(`${inset}${muted(`${rendered.length - end} more below`)}`);
    return [...heading, ...body, ...footer].slice(0, rows).map(clip);
  }

  invalidate(): void {}
}

export function registerModelPicker(
  pi: ExtensionAPI,
  hooks: { ascii: () => boolean; onOpen: () => void; onClose: () => void },
): void {
  pi.registerCommand("pituix-model", {
    description: "Choose a Pi model and thinking level",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      hooks.onOpen();
      let selection: ModelSelection | undefined;
      try {
        selection = await ctx.ui.custom<ModelSelection | undefined>((tui, theme, _keys, done) => {
          const view = new ModelPicker({
            choices: getModelChoices(ctx),
            current: ctx.model,
            thinkingLevel: ctx.thinkingLevel ?? pi.getThinkingLevel(),
            theme,
            ascii: hooks.ascii(),
            getRows: () => tui.terminal.rows,
            done,
          });
          return {
            render: (width) => view.render(width),
            invalidate: () => view.invalidate(),
            handleInput: (data) => {
              view.handleInput(data);
              tui.requestRender();
            },
          };
        });
      } finally {
        hooks.onClose();
      }
      if (!selection) return;
      try {
        if (!(await pi.setModel(selection.model))) {
          ctx.ui.notify("Pi could not select this model. Check its provider credentials.", "error");
          return;
        }
        pi.setThinkingLevel(selection.thinkingLevel);
      } catch (error) {
        ctx.ui.notify(`Model selection failed: ${String(error)}`, "error");
      }
    },
  });
}
