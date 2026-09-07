# Pi-TUIX Architecture

## Runtime boundary

```text
Pi Coding Agent
  ├─ Agent loop, providers, tools, sessions, permissions
  ├─ ExtensionAPI
  │    ├─ setHeader / setFooter / setEditorComponent
  │    ├─ setWorkingIndicator / setStatus / setWidget
  │    ├─ registerTool renderCall/renderResult
  │    └─ session, message, turn, and tool events
  └─ @earendil-works/pi-tui
       └─ Component, Focusable, overlays, layout, rendering

Pi-TUIX
  ├─ shell/       header, footer, editor chrome, theme
  ├─ stream/      working and thinking state
  ├─ tools/       compact tool rows and diffs
  ├─ control/     approval, plan, queue, keyboard surfaces
  └─ session/     context, resume, subagent, session references
```

## Event-to-view rule

Pi-TUIX should translate Pi events into small UI state updates. Components should not call providers, execute shell commands, or read sessions directly just to render a line. The extension entrypoint owns lifecycle wiring; each component owns only rendering and input behavior.

## Current implementation

The prototype intentionally uses only public hooks:

- `ctx.ui.setHeader()` for the startup shell;
- `ctx.ui.setFooter()` for persistent state;
- `ctx.ui.setWorkingIndicator()` for streaming feedback;
- `agent_*`, `turn_*`, `message_update`, `input`, and `tool_execution_*` events for read-only workflow and stream status;
- `ctx.ui.setWidget()` for a detected read-only plan panel;
- `ctx.ui.setEditorComponent()` with Pi's public `CustomEditor` for reversible editor chrome;
- `ctx.ui.setTitle()` for terminal identity;
- `pi.registerCommand()` for reversible toggles.

Read, Bash, Edit, and Write rendering uses Pi's documented `registerTool()` delegation pattern. Pi-TUIX retains each original public tool definition and exact `execute()` function while replacing only presentation. `/pituix-default` restores existing and future tool rows using the original Pi renderers in the same session.

Workflow status shows the current phase, active tool, completed and failed tool counts, and queued follow-up messages. It resets for each agent run and never changes Pi's queue, tool inputs, or execution behavior.

Stream status maps public assistant events to explicit `THINKING`, `RESPONDING`, and `TOOL` labels, includes the one-based turn number, and shows the active thinking level and context pressure. The plan adapter reads assistant text after a turn, recognizes a `Plan:` or localized plan heading with numbered or checkbox steps, and renders those steps through `setWidget()`. It is deliberately observational: it does not inject plan instructions, disable tools, or infer completion from tool execution.

Queue controls use Pi's public `sendUserMessage()` contract: `/pituix-steer` sends an immediate steering message, `/pituix-followup` queues a message for the next continuation, and `/pituix-queue` reports the host queue. Pi-TUIX does not inspect or mutate private queue storage.

Pi 0.84.x does not expose a generic approval-rendering event for every built-in permission decision. Approval UI therefore remains a planned adapter; Pi-TUIX must not replace Pi's permission prompts by intercepting tool execution.

## Compatibility strategy

The package declares Pi and `pi-tui` as peer dependencies. This prevents a second copy of the host UI framework from being bundled into the extension and makes the supported Pi range explicit.

When a Pi release changes a public extension type, the compatibility fix belongs in the adapter/component layer. The project should not patch or vendor the entire Pi runtime.

## Versioned terminal reference

The current shell is based on observed Claude Code 2.1.263 terminal behavior;
see [the parity report](claude-code-parity.md) for evidence and remaining gaps.
A compact header, horizontal input rules, contextual help, and one-line footer
replace the previous large welcome panel and boxed editor. `/pituix-status`
reveals the existing detailed footer. The packaged dark theme is applied through
`getTheme`/`setTheme`, and the previous theme is restored on disable if the user
has not selected a different theme meanwhile.

The effective thinking level is event-driven and rendered above the editor's
upper rule. The settings page uses `ctx.ui.custom` and the public `Input`
component for search editing. It adapts the input's two-cell prompt to a search
marker, retaining host paste, cursor and horizontal-scroll handling. Its tabs
contain Pi-TUIX preferences only. Footer chrome is hidden while settings are
open and restored in a `finally` handler when the custom view closes.

`/pituix-model` presents Pi's scoped models, falling back to its available model
registry when no scope is configured. Public pi-ai helpers determine supported
thinking levels. Arrow-key adjustments remain draft UI state until confirmation;
then `pi.setModel` and `pi.setThinkingLevel` apply them. Authentication, model
availability, effective effort and persistence remain Pi-owned. The native
`/model` command is preserved.

Tool definitions keep the public `renderShell: "self"` option stable.
Their call and result components share a small presentation flag through the
public `context.state`: once a result is rendered, the pending call row becomes
empty. Pi 0.84 retains the shell container attached at tool-row creation, so
changing `renderShell` alone leaves stale rows. When disabled, the adapter calls
the original renderers and composes their default frame with the public `Box`
component; native self-rendered tools retain their own frame. Mode changes use
each row's public `context.invalidate` callback, tracked by tool-call ID and
cleared at session start/shutdown. A native partial renderer still receives its
final result after a mode switch so its own timers can settle.

Read previews show a count, Write previews add line numbers, and Edit uses the
public `renderDiff` formatter for word highlights. A guarded presentation
adapter moves recognized diff line numbers before the change marker while
preserving ANSI sequences; unrecognized formats pass through unchanged.
Adjacent successful Read/Bash calls share a compact count summary. The grouping
adapter observes public finalized messages and tool completion events, and
rehydrates metadata from `sessionManager.getBranch()` on startup/navigation.
It deduplicates lexically normalized file paths, counts every Bash call, and
keeps failures, images, truncation, visible text and other tools as boundaries.
Group members use their individual tool views when expanded. Only affected tool
rows are invalidated after completion; no message or session entry is rewritten.
Execution functions, argument schemas, and permission behavior are
unchanged. Other extensions' MCP tools and built-in transcript components remain
host-owned. No new runtime dependency or private host patch is introduced.
