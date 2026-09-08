# Compact TUI Enhancements

## Overview

This document describes the Claude Code-inspired compact TUI enhancements integrated into Pi-TUIX. These improvements optimize information density, error visibility, and user control while maintaining full compatibility with Pi's execution model.

## Key Enhancements

### 1. Configurable Tool Rendering

**Location:** `extensions/shell/open-tui/config.ts`

New `ToolRenderConfig` interface provides fine-grained control:

```typescript
export interface ToolRenderConfig {
  defaultMode: ToolDisplayMode;      // "collapsed" | "preview" | "expanded"
  autoExpand: boolean;                // Auto-expand errors to preview mode
  maxPreviewLines: number;            // Number of lines shown in preview (default: 4)
  highlightErrors: boolean;           // Visual error highlighting (default: true)
}
```

**Default Configuration:**
```typescript
toolRender: {
  defaultMode: "preview",
  autoExpand: true,
  maxPreviewLines: 4,
  highlightErrors: true,
}
```

### 2. Smart Error Handling

**Auto-Expand on Error:**
- When a tool fails and `autoExpand` is enabled, the display mode automatically upgrades from `collapsed` to `preview`
- Provides immediate error context without requiring manual expansion
- Controlled by `config.toolRender.autoExpand`

**Visual Error Highlighting:**
- Error header rows are prefixed with a red vertical bar (`▌`)
- The entire summary line uses error color theme
- Makes errors immediately scannable in long sessions
- Controlled by `config.toolRender.highlightErrors`

### 3. Dynamic Preview Lines

**Adaptive Content Display:**
- Preview mode dynamically splits content based on `maxPreviewLines`
- Shows first `N/2` lines and last `N/2` lines
- Clearly indicates hidden content count with actionable hint
- Example: `... 2 more lines hidden (use /pituix-mode expanded)`

**Configuration:**
```typescript
// Show 6 lines in preview (3 head + 3 tail)
toolRender: {
  maxPreviewLines: 6,
  // ...
}
```

### 4. Three-Layer Tool View Architecture

**Display Modes:**

1. **Collapsed** - Single summary line only
   ```
   READ src/index.ts [OK] 150 lines
   ```

2. **Preview** - Summary + sampled content
   ```
   READ src/index.ts [OK] 150 lines
     import { something } from 'lib'
     export function main() {
     ... 146 more lines hidden (use /pituix-mode expanded)
     }
   ```

3. **Expanded** - Summary + full content
   ```
   READ src/index.ts [OK] 150 lines
     (all 150 lines shown)
   ```

### 5. Enhanced Status Communication

**Status States:**
- `QUEUED` - Tool call prepared but not started
- `RUNNING` - Tool execution in progress
- `OK` - Successful completion
- `ERROR` - Failed execution with error details
- `CANCELLED` - User or system cancellation

**Status Indicators:**
- Color-coded status badges
- Text-based state labels (color is supplementary, not primary)
- Attention markers (`⚠ ATTENTION`) for errors
- Clear distinction between transient and final states

### 6. Improved Tool Summaries

**Read Tool:**
- Line count: `234 lines`
- Truncation info: `truncated 50/234 lines`
- Range display: `lines 10-50`

**Bash Tool:**
- Output summary: `15 output lines`
- Timeout indicator: `timeout 30s`
- Truncation flag: `15 output lines | truncated`

**Edit Tool:**
- Diff statistics: `+12 -3`
- Application status: `applied`
- Error extraction when failed

**Write Tool:**
- Content size: `234 lines`
- Completion status: `234 lines written`
- Error details on failure

## User Commands

### Display Mode Control

```bash
# Set default display mode
/pituix-mode collapsed
/pituix-mode preview
/pituix-mode expanded
```

### Configuration Access

```bash
# Open settings UI
/pituix-settings
```

Settings include:
- Tool render configuration
- Footer segments
- Icon mode (Unicode/ASCII/Auto)
- Telemetry preferences

## Implementation Details

### Configuration Loading

Configuration is loaded from `~/.agents/pi-tuix.json` on extension start:

```typescript
// extensions/index.ts
const config = loadConfig();
const threeLayerMode: ThreeLayerMode = {
  enabled: false,
  config: config.toolRender,
};
```

### Tool Renderer Integration

Each tool renderer receives the shared configuration:

```typescript
// extensions/tools/renderers-v2.ts
export function createThreeLayerReadDefinition(
  cwd: string,
  mode: ToolRendererMode,
  original?: ReadDefinition,
): ReadDefinition {
  // Passes config to ThreeLayerToolView
  return new ThreeLayerToolView(displayMode, summary, details, theme, {
    maxPreviewLines: mode.config.maxPreviewLines,
    highlightErrors: mode.config.highlightErrors,
    autoExpand: mode.config.autoExpand,
  });
}
```

### Error Auto-Expansion Logic

```typescript
// Auto-expand errors from collapsed to preview
if (mode.config.autoExpand && context.isError && displayMode === "collapsed") {
  displayMode = "preview";
}
```

### Preview Line Calculation

```typescript
const maxLines = this.config.maxPreviewLines ?? 4;
const headLines = Math.floor(maxLines / 2);
const tailLines = maxLines - headLines;

const visibleLines =
  this.details.length <= maxLines
    ? this.details
    : [...this.details.slice(0, headLines), ...this.details.slice(-tailLines)];
```

## Testing

All enhancements are covered by regression tests in `test/three-layer-renderers.test.ts`:

- ✅ Configurable preview line counts
- ✅ Auto-expansion on errors
- ✅ Error highlighting markers
- ✅ Hidden content indicators
- ✅ Display mode transitions
- ✅ Tool-specific summaries

Run tests:
```bash
npm test
```

## Compatibility

- **Pi Version:** `>=0.84.0`
- **Breaking Changes:** None
- **Configuration Migration:** Automatic (defaults applied for missing keys)
- **Existing Sessions:** Configuration changes apply to new tool calls

## Design Principles

1. **Scanning First** - The first line always contains action, target, status, and key metadata
2. **Progressive Disclosure** - Default to compact, expand on demand
3. **Error Visibility** - Errors are immediately apparent without expanding
4. **No Color-Only Signals** - Status is always text-labeled
5. **Configurable Density** - Users control preview verbosity
6. **Execution Delegation** - All tool execution remains in Pi's hands

## Future Enhancements

Potential improvements for future releases:

- [ ] Per-tool display mode preferences
- [ ] Keyboard shortcuts for inline expansion (E key)
- [ ] Smart preview: show error context only
- [ ] Diff-only preview mode for Edit tool
- [ ] Persistent user preferences per project
- [ ] Live preview line adjustment based on terminal height

## References

- [Product Context](product-context.md) - MVP goals and success criteria
- [Architecture](architecture.md) - Component ownership model
- [Three-Layer View](../extensions/tools/three-layer-view.ts) - Core implementation
- [Tool Renderers V2](../extensions/tools/renderers-v2.ts) - Tool-specific adapters
