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
- `pi.registerCommand()` for reversible toggles.

Pi retains its native terminal title and activity updates. Pi-TUIX does not call
`setTitle()` on startup, settings changes or interface toggles: a static title
would discard the session/project identity used by terminal tabs and workspace
integrations. The extension's product identity stays in its header.

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
An optional `gitBranch` records a bounded, read-only Git observation at agent end.
The completion entry itself is still appended synchronously on settlement, with
no extra model message. Missing Git and unavailable branch data are omitted;
unborn branches and detached HEAD are supported. Lifecycle changes abort pending
observations, so a result cannot attach to a replacement session.
These records are UI metadata, excluded by Pi's model-context builder. Pi owns
storage, ordering, branching, compaction and restoration; Pi-TUIX never directly
writes session files or modifies messages. Existing histories without these records
are not backfilled. No records are added in the default UI or non-TUI modes.
Cancellation has a separate interruption prompt, including Pi's error-form
AbortError case. Imported records with invalid fields or unknown versions are
ignored. The snapshot reader uses the same parser and formatter.

Pi can replay custom entries before `session_start`, so presentation reads the
saved enabled preference at registration. Valid completion renderers always
return an owned row, preserving host mounting even when startup is disabled.
A zero-height `setWidget` factory supplies the public TUI reference. After host
composition, a public `Container` wraps only entry containers containing our
row; it hides both the row and host spacing while disabled, retaining the source
as a child for native invalidation. Cleanup unwraps only these owned containers
and preserves host additions, removal and reordering. No session rebuild or
private host fields are used. Without the extension, Pi ignores these
unregistered custom entries and keeps the ordinary conversation.

Settings and enable/default commands share one persisted `enabled` preference.
After the settings page closes, the lifecycle controller synchronizes the shell,
tool renderers, plan, queue and completion visibility. Disabled runs retain
observational state for a later mode switch but add no completion metadata or
telemetry notifications. Icon selection is read by pending/result tools, working
feedback, history and preview renderers. Preference parsing validates primitive
types and known choices without sharing mutable defaults.

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
filters public `SessionInfo` text and opens a selected conversation on demand.
The command reads that file asynchronously with an AbortSignal, then uses public
`parseSessionEntries`, in-memory `migrateSessionEntries`, `buildContextEntries`
and `buildSessionContext` helpers. It verifies the selected header identity and
rejects future formats or invalid ancestry before traversal. It never opens a
persisting SessionManager to preview a file. The active saved branch and
compaction projection remain Pi-owned. No file is rewritten or migrated on disk.
List rows show relative time, recorded Git branch when available, and file size
in 1024-based units; preview footers show short relative time, message count and
recorded branch. The latest completion on the saved parent chain supplies the
branch even when compaction hides that older UI entry from the transcript.
Abandoned paths cannot supply it, and current Git state never fills missing
historical data. Metadata normally loads for a bounded window near the visible
selection. Ctrl+B filters by the current Git branch, observed once on opening;
while active it reads metadata across the selected catalogue scope. Missing
observations are excluded, and unavailable Git/loading/empty states are distinct.
At most two file reads run at once. Changing search/scope/filter discards queued
rows that are no longer needed. Closing aborts reads and discards queued work;
late results cannot overwrite a newer preview snapshot or post-rename size.
Only small metadata fields are cached, not the preview's full parsed history.
The normal list keeps up to three entries and a stable 20-row frame shared with
search and rename; short terminals use a compact layout. The configured public
`app.session.rename` binding opens a draft using the public Input component.
Esc cancels; Enter confirms one write. The current session delegates through
`pi.setSessionName`, preserving host state/events. Other selections validate the
file identity/format before `SessionManager.open().appendSessionInfo()`; Pi owns
the name entry and any legacy migration, just as in its native selector.
Opening the picker or a preview never invokes that persistence path. Cancelled
validation does not write, errors retain the draft for retry, and saving refreshes
the public catalogue without switching sessions. Names remain usable after
disabling or removing Pi-TUIX.
The custom view closes before
`ctx.switchSession(path)` replaces the runtime; late load callbacks are ignored,
and no captured session-bound object is used after a successful replacement.
Pi 0.84 reapplies its saved theme after `session_start` during replacement.
The picker reapplies the reference Theme instance through the fresh public
`withSession` context, without changing Pi's saved theme preference. Native
session/reload commands can still reset an extension-applied temporary theme.
While active, the shell polls the public `ctx.ui.theme` value and rebinds its
custom factories when the theme object changes; the poll stops when the shell is
removed. This compatibility fallback does not touch Pi's private theme controller
or saved automatic-theme preference.
Switching by theme name would persist a different Pi setting, so the adapter
continues using a temporary Theme instance rather than silently replacing that
preference.
Explicit `/pituix` recovery reapplies that instance even when the shell is already
active. A successful change remembers the theme it replaced for later disable;
repeated recovery while the reference theme is current does not overwrite that
return value. Ordinary settings synchronization and tool-mode commands preserve
themes selected while active. Theme recovery keeps the existing editor and transcript mount; an observed runtime
theme switch rebinds the custom factories so newly created components receive the
host theme.
The preview shares the pure startup header and snapshot transcript components.
It shows individual tool results (without live Read/Bash grouping), diffs,
completion records and recorded assistant time/model above text responses.
User images have numbered attachment branches with local links. Successful Read
images show byte summaries; other tool/custom images have unnumbered links and
other attachments have type labels. Header, conversation and recovery hints
scroll inside the reference separator. Arrows, paging, Home/End, wheel input and
Pi's tool-expansion binding stay scoped to a public modal overlay; a fullscreen
host otherwise consumes viewport keys before non-overlay editor input. The
bottom-anchored overlay leaves two context rows when space permits. Closing
restores native focus before any session replacement. Cancelling or selecting
another preview aborts the pending read; request identity also rejects late
results from readers that ignore cancellation. A failed read can be retried by
reopening the preview. Rendering does no file I/O or tool execution. Native
`/resume` and `/tree` are untouched.

`/pituix-transcript` reads and clones the current public session branch before
opening a full-width custom overlay. Its snapshot components preserve raw user
text and prefix rendered assistant Markdown, so heading/list/fence parsing is
unaffected. Recorded tool calls/results are paired by ID and displayed through
public `ToolExecutionComponent` instances and the existing Pi-TUIX renderers.
No executor is invoked or newly registered. Missing calls, failed/aborted
responses, visible custom messages and compaction summaries remain explicit.
Images share the preview's attachment presentation; foreign tool renderers are not copied.
Rendering performs no I/O. The reader owns only scroll/expansion state, returns
to the same editor, and remains a separate view of the current branch. The resume
preview reuses its content renderer with individual tools and message metadata;
the main snapshot keeps its existing grouping and optional expansion.

`SessionImageCache` prepares supported raster attachments outside rendering.
Only user images receive numbers. A matching `pi-tuix-image-numbers` custom entry
supplies known numbers for delivered draft attachments. Matching requires the
next user message, exact timestamp, image count and a SHA-256 fingerprint of its
ordered text/image content. Unknown native-image slots retain the fallback below.
When user text contains one valid positional
label per image, those labels preserve their numbers and positions, including
deleted-draft gaps. When repeated references outnumber image blocks, a matching
set of distinct labels supplies first-reference numbers instead. Original
one-label-per-block messages retain their prior interpretation; other user images
receive branch-order numbers. Ambiguous legacy messages are not backfilled.
Tool/custom
images do not advance that counter. Content hashes deduplicate temporary bytes
across repeated images and concurrent main/preview preparation. Files use
mode 0600 inside a fresh 0700 temporary directory. Base64, MIME/header dimensions
and a 28 MiB encoded-size limit are checked before writing; unavailable media
keeps an attachment label. Public `hyperlink` supplies OSC 8 links. Pi's fullscreen
`openUrl` handling or the regular terminal opens them; no shell command runs from
the renderer. Preparation cannot block modal navigation, and abort/request guards
discard late updates after closure or a new selection. Runtime shutdown waits for
pending writes, removes the temporary directory and resets the cache. These are
disposable UI assets, not a second media catalogue or session store. Session
files, original message content, model inputs and tool execution remain unchanged.
The live main adapter reads image payloads from public context entries and stages
user/assistant message events until Pi persists them. It uses exact native component
kind/order and observed user text to match rows. Image-only prompts, absent from
the tested native document, become render-only rows anchored to that sequence.
Native message instances, child order and session entries remain unchanged. An
unknown or incomplete layout falls back to native output instead of guessing an
attachment identity. Late-mounted chat containers are recognized separately from
plain resource text. Public tool bitmap children are omitted only when composing
those children exactly reproduces the native output; the native children and image
visibility state are preserved for default-mode restoration. Successful Read
images retain their tool summary without an extra attachment branch; other tool
images keep unnumbered links. Width/theme/link-state caches cover stable prompts.
The same rendered document supplies native search, prompt navigation and link
activation. Deferred persistence refreshes and asset loads cancel on unmount.
The editor handles explicitly pasted image paths through bounded file
read outside rendering. It accepts PNG/JPEG/GIF/WebP headers with positive
reported dimensions, regular files up to 20 MiB, and a 128 MiB per-runtime draft
budget. An unrecognized path stays as ordinary pasted text. Quoted, shell-escaped,
relative, home and file-URL paths are supported. Native clipboard callbacks still
own clipboard access; their public `insertTextAtCursor` call enters the same path.
For multiple paths, a pure tokenizer accepts absolute, home and file-URL tokens
with escaped spaces. Individually quoted path lists remain unchanged, matching
the measured fallback; single quoted image paths remain supported. The tokenizer
does not evaluate shell syntax. Limits of 64 paths and 64 KiB of path-list text
bound parsing and file operations. A path list containing ordinary prose stays as
text. When at least one image is accepted, valid images receive tokens in source
order, missing paths are omitted and existing non-image paths retain their raw
spelling. An image followed by retained text has no inserted separator, matching
the measured reference. A list with no accepted image falls back unchanged.
Remaining draft capacity bounds each read before allocation. The whole batch
enters the native editor in one insertion, preserving a single undo step.

Each chip occupies one private-use Unicode grapheme in the native editor buffer.
Native movement, deletion, kill/yank and undo therefore retain atomic image
identity without replacing or inspecting the editor's undo/paste registries.
A separate pure layout expands that grapheme to its visible numbered label,
wraps whole chips, and derives cursor position from public `getLines`/`getCursor`.
Vertical movement follows the expanded rows through public native key handling;
autocomplete and explicit history bindings retain their native behavior.

A public input handler replaces owned draft tokens with positional labels and
adds the captured image bytes, preserving any existing input images. Pi performs
submission, steering/follow-up delivery and persistence. Literal labels typed by
a user do not create attachments. Incoming user-message events reserve numbers
before persistence; deleted numbers are not recycled within the runtime. A fresh
editor seeds from actual images and valid user text labels on the selected saved
branch, ignoring assistant/tool labels. A successful paste also observes labels
in the current visible draft. Discarded text, failed image reads and newly delivered
text-only messages do not advance the running counter. Hidden text inside native
collapsed pastes is not scanned. Unsafe integer labels cannot allocate duplicate
numbers. Draft
links asynchronously share the runtime's private image cache, so opening them
shows captured bytes even if the source file changes. Late preparation cancels
on shutdown. Private editor tokens and source paths are never saved separately.

Input observations also remember a bounded content fingerprint and ordered number
list. On a matching public user-message start, `pi.appendEntry` records versioned
display metadata before Pi appends the user message. This handler runs before the
live image adapter stages that row. No image bytes, text or source paths enter the
annotation, and Pi excludes plain custom entries from model context. The message
timestamp prevents a dangling annotation from matching a later identical payload.
Conflicting identical-payload observations fall back rather than guess; an empty
queue, take-back or disposal clears stale records. Bounds are 256 inputs and 65536
number slots. Changes by a later input handler fail the content match.
When compaction drops an annotation immediately before a kept user message,
the live/preview presentation projection may reinsert its matching ancestor entry
from the public branch. It never adds a summarized message, uses sibling metadata,
changes model context or writes the session. Removing the extension needs no migration.

The native follow-up action reads unresolved editor content so image data reaches
the input event. Disposable input observations record original/displayed text,
steering/follow-up lane and image fingerprints. They neither submit nor execute
messages. Public user-message events retire observations using text and image
payloads; a clear `hasPendingMessages()` result discards stale observations.
The public dequeue and interrupt actions restore chips only when the complete
native take-back text matches those observations in steering/follow-up order.
The current draft is captured separately, including expanded native paste data,
so literal labels never acquire attachments from matching numbers. A mismatch
keeps the host text and warns when owned images could not be restored. Records
are bounded to 256 inputs and 8 MiB of text; overflow disables matching until
cleared. Disposal clears all observations. An empty public queue also resets the
presentation badge after take-back. Later input handlers can still change image
payloads without changing text; Pi exposes no accepted-queue payload event to
verify that case. Unobserved compaction queues also lack complete public metadata.
The native external-editor action receives readable labels; its public `setText`
callback restores surviving known labels to their image identities. Repeated
references share one current attachment; removing the final reference removes
it. Input transformation deduplicates owned identities in first visible-reference
order, including references typed before the corresponding chip. Distinct pasted
identities remain distinct even with identical bytes, and incoming host images
remain untouched. Unknown/old labels do not acquire images absent from the
exported draft. The next keystroke clears an unanswered external exchange, since
a failed native editor does not call `setText`. Disabling the
extension expands remaining draft chips to readable source paths before restoring
the host editor. This also preserves the contents of native collapsed text pastes.
After a new runtime, Pi recalls historical labels as text without automatically
reattaching image bytes. The sampled Claude history recall also submits text only.
Literal `[Image #N]` spans now share whole-span layout and arrow/word navigation
without entering the attachment registry. A span deletion uses public `setText`
to create one native undo snapshot, then restores the cursor through native key
handling. When expanded text differs from the editor buffer, deletion stays
native: `setText` would otherwise clear the host's collapsed-paste registry.
History remains Pi-owned and no display token or image data is inserted for a
literal label. Collapsed-paste deletion, native commands consuming arguments
before the input event, and a shared counter for long text/image paste references
need further work. The measured quoted-list, missing-path and mixed-path fallback
rules are covered by parser and editor regressions.

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
Assistant chrome shares one final line-layout function and one Markdown
presentation adapter with snapshot/preview messages. The adapter consumes only
lines returned by Pi's public `Markdown.render()`: it removes rendered fence rows
and their two-cell code indent, centers table-header text within the existing
Pi-calculated cells, and adds italic SGR around quote bodies while retaining Pi's
rail, parser, wrapping, theme roles and syntax highlighting. It does not inspect
Markdown private fields or transform source text. When the requested body is
narrower than Pi's safe Markdown rendering width, it wraps the rendered rows
rather than discarding their right edge.
ANSI styles and links continue across those wrapped rows. A one-column view
retains single-cell characters through column slicing; a two-cell glyph cannot
be displayed at that width. A public Markdown callback whose available width
is clamped to one cannot identify its padding, so the live adapter uses at most
four wider probes before falling back to native rendering. Once measured,
padding and safe content width determine subsequent renders without repeated
probing. Components, source Markdown and the host parser remain unchanged.
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
keeps failures, Bash images, truncation, visible text and other tools as boundaries.
Successful Read images participate in file counts, including a single-image Read.
Expansion shows the returned image byte count, suppresses the redundant standard
Read image note and preserves any additional host warning text.
Group members use their individual tool views when expanded. Only affected tool
rows are invalidated after completion; no message or session entry is rewritten.
Execution functions, argument schemas, and permission behavior are
unchanged. Other extensions' MCP tools and built-in transcript components remain
host-owned. No new runtime dependency or private host patch is introduced.
