import type { TUI } from "@earendil-works/pi-tui";

export const MIN_FULLSCREEN_WHEEL_SCROLL_LINES = 1;
export const MAX_FULLSCREEN_WHEEL_SCROLL_LINES = 10;
export const DEFAULT_FULLSCREEN_WHEEL_SCROLL_LINES = 4;

export function normalizeFullscreenWheelScrollLines(
  value: unknown,
  fallback = DEFAULT_FULLSCREEN_WHEEL_SCROLL_LINES,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(
    MAX_FULLSCREEN_WHEEL_SCROLL_LINES,
    Math.max(MIN_FULLSCREEN_WHEEL_SCROLL_LINES, Math.floor(value)),
  );
}

/**
 * Pi does not expose a public API for fullscreen wheel scroll speed. Keep the
 * persisted preference for future compatibility, but never mutate private host
 * fields from an extension.
 */
export function applyFullscreenWheelScrollLines(_tui: TUI, _value: number): boolean {
  return false;
}
