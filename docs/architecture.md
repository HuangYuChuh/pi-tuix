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
Active calls are keyed by public tool-call ID, including simultaneous calls of
the same tool. The working line reports the active count until one call remains.
Duplicate completions and late events after settlement cannot alter that count.

Run presentation observes assistant usage and stop reasons. A one-second UI timer
updates elapsed working feedback; unavailable token counts are omitted rather
than estimated. Automatic continuations retain the start time until Pi emits
`agent_settled`. Each newly settled TUI run appends one versioned
`pi-tuix-run-completion` custom entry through `pi.appendEntry`; duplicate
settlement events do not append again. `registerEntryRenderer` displays its
elapsed time, end time, outcome and failed-tool count in the native document.
These records are UI metadata, excluded by Pi's model-context builder. Pi owns
storage, ordering, branching, compaction and restoration; Pi-TUIX neither writes
session files nor modifies messages. Existing histories without these records
are not backfilled. No records are added in the default UI or non-TUI modes.
Cancellation has a separate interruption prompt, including Pi's error-form
AbortError case. Imported records with invalid fields or unknown versions are
ignored. The snapshot reader uses the same parser and formatter.

Pi can replay custom entries before `session_start`, so renderer registration
starts in the enabled state used by startup. Mode changes invalidate the public
component tree when installing/removing the live document composition. This
lets the host rebuild its custom-entry wrappers with or without their spacing;
`/pituix-default` hides the rows and `/pituix` restores them. Without the extension,
Pi ignores these unregistered custom entries and keeps the ordinary conversation.

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

`/pituix-resume` lists sessions through the public `SessionManager.list` and
loads `listAll` only when the user chooses all projects. The current custom
session directory is included through the public overload. The component
filters `SessionInfo` records and previews `allMessagesText`, with no I/O from
rendering. It shows message counts and modification times rather than guessing
unavailable branch or file-size metadata. The custom view closes before
`ctx.switchSession(path)` replaces the runtime; late load callbacks are ignored,
and no captured session-bound object is used after a successful replacement.
Pi 0.84 reapplies its saved theme after `session_start` during replacement.
The picker reapplies the reference Theme instance through the fresh public
`withSession` context, without changing Pi's saved theme preference. Native
session/reload commands can still reset an extension-applied temporary theme;
their post-rebind sequence is not intercepted by Pi-TUIX. The public extension
context exposes no post-theme-rebind event or saved automatic-theme preference.
Switching by theme name would persist a different Pi setting, so the adapter
continues using a temporary Theme instance rather than silently replacing that
preference.
This text preview does not reproduce tool/media transcript rendering. Session
files, migration, persistence and branching remain Pi-owned; native `/resume`
and `/tree` are untouched.

`/pituix-transcript` reads and clones the current public session branch before
opening a full-width custom overlay. Its snapshot components preserve raw user
text and prefix rendered assistant Markdown, so heading/list/fence parsing is
unaffected. Recorded tool calls/results are paired by ID and displayed through
public `ToolExecutionComponent` instances and the existing Pi-TUIX renderers.
No executor is invoked or newly registered. Missing calls, failed/aborted
responses, visible custom messages and compaction summaries remain explicit.
Binary attachments receive type labels; foreign tool renderers are not copied.
Rendering performs no I/O. The reader owns only scroll/expansion state, returns
to the same editor, and remains separate from the live view and resume preview.

The main view composes reversible presentation containers into the public
document tree. A version-local adapter recognizes public
`Container.children`, `UserMessageComponent` and `AssistantMessageComponent`
instances. It traverses only plain concatenating containers. Opaque components,
including tools, media and notifications, retain their native render methods.
An identity `registerMarkdownTransformer` callback observes source/context while
the public Markdown component renders; it returns source unchanged. Raw user
text receives prompt chrome. Assistant Markdown is prefixed after rendering,
preserving the host's Markdown parsing, highlighting and transformer chain.
Unknown layouts or missing callbacks fall back to native rendering. Package
imports go through Pi's extension loader so component identities share the host
UI runtime. The adapter wraps the document's direct children through public
`Container.children`. It retains the original document, header and chat
containers, so Pi continues adding and removing messages through the same
references. Each presentation container also keeps its source as a public
child, preserving mounted-component discovery and native invalidation. Teardown
unwraps only this mount's components and preserves later additions and ordering.
No private fields, methods or prototypes are patched.

Both renderer modes consume that same document. Fullscreen paging, wheel input,
prompt navigation, search, selection and copying therefore stay in Pi's native
viewport. Standard OSC 133 prompt zones are retained around the restyled user
rows. Search closes at its matched location, and native settings can switch
between regular and fullscreen mode without a persistent overlay blocking the
transition. Regular mode retains terminal scrollback. The editor, dock, queue,
status, foreign widgets and dialogs use their original host composition and
focus handling. A public `TuiAltScreen.scrollToBottom` capability resumes
following for a new run. The adapter owns no second viewport or focus observer,
and performs no provider, session-file or shell I/O.

Static message rows are cached by public source/rendered-line identity, width,
theme and icon mode. Invalidation propagates to the original components and
clears presentation caches. Observed Markdown padding is reused to avoid
alternating render widths when the host output padding differs from one cell.
Streamed text, width and theme changes still refresh the affected display.
Large-history measurements cover this presentation layer rather than total
terminal latency. Real-terminal multi-line/image selection needs broader
coverage. User chrome observes source at this extension's position in the
transformer chain, so later user-text transformers are not reflected in that
raw-text view.

Tool definitions keep the public `renderShell: "self"` option stable.
Each built-in tool is registered once. `/pituix-compact` selects collapsed
summaries and `/pituix-three-layer` selects previews in the same renderer;
both reset Pi's expansion flag. Native rendering is selected by
`/pituix-default`, without competing registrations for the same tool names.
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
For the reference dark theme, `diff-view` reads inverse-video token ranges from
that public output, then paints row and token backgrounds at the available
width. Added/context lines use public `highlightCode`; removed lines stay plain.
The tool view accepts pure width-dependent detail-line callbacks so backgrounds
can fill the observed code pane without rendering side effects. Color resets,
256-color fallback and `NO_COLOR` handling stay in this adapter. Other themes
continue using the original public diff styling. Syntax token categories remain
Pi-owned and are not yet identical to the reference. No new dependency is added.
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
