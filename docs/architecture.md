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
- `agent_*`, `input`, and `tool_execution_*` events for a read-only workflow status line;
- `ctx.ui.setEditorComponent()` with Pi's public `CustomEditor` for reversible editor chrome;
- `ctx.ui.setTitle()` for terminal identity;
- `pi.registerCommand()` for reversible toggles.

Read, Bash, Edit, and Write rendering uses Pi's documented `registerTool()` delegation pattern. Pi-TUIX retains each original public tool definition and exact `execute()` function while replacing only `renderCall()` and `renderResult()` when its UI mode is active. `/pituix-default` switches future tool rendering back to the original Pi renderer in the same session.

Workflow status shows the current phase, active tool, completed and failed tool counts, and queued follow-up messages. It resets for each agent run and never changes Pi's queue, tool inputs, or execution behavior.

Queue controls use Pi's public `sendUserMessage()` contract: `/pituix-steer` sends an immediate steering message, `/pituix-followup` queues a message for the next continuation, and `/pituix-queue` reports the host queue. Pi-TUIX does not inspect or mutate private queue storage.

Pi 0.84.x does not expose a generic approval-rendering event for every built-in permission decision. Approval UI therefore remains a planned adapter; Pi-TUIX must not replace Pi's permission prompts by intercepting tool execution.

## Compatibility strategy

The package declares Pi and `pi-tui` as peer dependencies. This prevents a second copy of the host UI framework from being bundled into the extension and makes the supported Pi range explicit.

When a Pi release changes a public extension type, the compatibility fix belongs in the adapter/component layer. The project should not patch or vendor the entire Pi runtime.
