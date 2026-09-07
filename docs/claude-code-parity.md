# Claude Code terminal reference: 2.1.263

## Reference and method

Observed on 2026-09-07 using the macOS arm64 native Claude Code 2.1.263
executable, at 80x24 and 100x40 terminal cells. The official updater reported
2.1.263 as latest. Its download timed out; the same native build was downloaded
from the official release endpoint, checked against the server's checksum, and
verified with `claude --version`. The local launcher now points into the native
versions directory. The existing npm installation was not removed.

Reference sessions used `--safe-mode` in a temporary directory. The first
observation inherited `NO_COLOR=1`; a subsequent run removed that variable and
used `TERM=xterm-256color`, `COLORTERM=truecolor`, and `FORCE_COLOR=1` to observe
SGR colors. These are observations of a particular version and configuration,
not a promise about every Claude Code account or terminal.

Only executable behavior and public documentation were examined. No binary
decompilation, proprietary source, mascot artwork, private protocol, or branding
is included in Pi-TUIX. The reference mascot is replaced with an original ASCII
`[pi]` identity.

## Observed surfaces

- Startup: three content rows. Product/version, model/effort/account context,
  then working directory. At 100 columns, identity text starts in column 12.
- Editor: full-width horizontal rules above and below the prompt, no vertical
  rails; a prompt marker in column 1 and text starting in column 3.
- Idle footer: contextual hints. Effort appears above the input on the right.
  Pi-TUIX now places the effective thinking level and Pi's configured cycle
  binding above the input rule; model information stays in the compact footer.
- Empty-input `?`: help replaces the compact hint area. Commands, file mentions,
  shell mode, interruption, expansion, and editing shortcuts are grouped below
  the editor. A question mark within an existing draft remains input.
- `/model`: a numbered list, descriptions starting in column 32 at 100 columns,
  current-model check mark, and draft effort changed with Left/Right. Enter
  confirms; Escape leaves the model unchanged. Pi-TUIX exposes this layout in
  `/pituix-model` using Pi's available/scoped models and supported thinking
  levels. The native `/model` command remains available.
- `/config`: a top separator, tab strip, settings search input, aligned setting
  names and values, and navigation hints. At 100 columns, the search box spans
  columns 4-97, search text starts in column 8, labels in column 6, and values
  in column 49. Search initially has focus; Enter selects a result before a
  second Enter changes it. Escape clears a query, leaves search, then closes.
  Pi-TUIX uses this frame and interaction with its own preference categories.
- Shell mode: a leading `!`, an indented result branch, running text replaced by
  output, and an interruption hint during execution.
- `/resume`: a top separator, search frame, selected session title and muted
  relative time/branch/file-size row. Typing focuses search, Enter selects a
  result before a second Enter resumes, and Space previews the conversation.
  Escape returns from preview to the list, clears active search, or cancels the
  picker. The observed picker also exposes project/branch filters and rename.
- A model request failed with an expired-login message. A completion-duration
  line was still rendered for that failed attempt. This is not evidence of a
  successful model turn or of model-driven Read/Edit/Write rendering.

### Authenticated tool workflow

After configuring a compatible gateway outside the repository, an actual
`claude-opus-5` session completed a disposable fixture workflow: Read a
three-line TypeScript file, run a Bash printf command, Edit subtraction to
addition, and Write a one-line notes file. The final files were verified on
disk. Edit and Write confirmations were observed and approved individually;
permission mode was not relaxed.

- Compact transcript combines adjacent completed Read/Bash calls into an
  indented count summary. Detailed transcript (`Ctrl+O`) separates the calls.
- A second authenticated capture read two different ranges of the same file
  and ran two Bash commands. The compact summary was `Read 1 file, ran 2 shell
  commands`: files are deduplicated, while shell invocations are counted.
- Detailed Read shows a `Read(path)` heading and a result branch with the line
  count. It does not print the file body in the observed detailed transcript.
- Bash prints output under a result branch; a deliberately failing command
  showed `Error: Exit code 7` and its stderr after individual approval.
- Edit uses `Update(path)`, an added/removed-line count, and a numbered diff.
  Changed tokens have stronger highlights within colored added/removed rows.
- Write uses `Write(path)`, a written-line count, and a numbered content preview.
- Edit and Write confirmations show the file, a diff/content preview, one-time
  approval, a separate permission-mode option, rejection, and amend/cancel hints.
- A completion line shows elapsed time and a completion clock time. The
  working row includes an animated glyph, activity text, elapsed time and tokens.
- One subsequent gateway response ended before any complete streaming data;
  Claude displayed a retry notice and successfully retried without streaming.
  The successful tool workflow is verified; gateway streaming is not assumed
  reliable for every request.
- Interrupting a direct `!sleep 30` command removed its running row and restored
  the command draft in shell mode. This is evidence for direct shell-mode
  cancellation.
- A later model-driven, read-only Python arithmetic command was approved once
  and interrupted while running. Claude replaced the working animation with
  an `Interrupted` branch asking what to do next, without a normal completion
  clock. A standalone model-driven `sleep 30` had been rejected by Claude's
  Bash tool, so the arithmetic command provided the actual cancellation capture.

Observed dark-theme colors:

| Role | RGB hex |
| --- | --- |
| Startup accent | `#d77757` |
| Auxiliary text | `#999999` |
| Input rules | `#888888` |
| Selected command/settings accent | `#b1b9f9` |
| Login error | `#ff6b80` |
| Successful tool marker | `#4eba65` |
| User-message background | `#373737` |
| User-message text | `#ffffff` |
| Diff text | `#f8f8f2` |
| Removed gutter / row / changed token | `#dc5a5a` / `#3d0100` / `#5c0200` |
| Added gutter / row / changed token | `#50c850` / `#022800` / `#044700` |
| Syntax keyword / function / operator | `#f92672` / `#a6e22e` / `#fd971f` |

These colors are applied to corresponding theme roles and the diff adapter.
Additional syntax roles follow the same Monokai palette; Pi's public highlighter
still determines token categories. This does not yet reproduce every reference
syntax token. For example, Pi groups a TypeScript function declaration more
broadly than the observed reference.

## Implementation and remaining gaps

| Surface | Pi public contract | Status |
| --- | --- | --- |
| Compact startup | `setHeader` | Implemented; original Pi-TUIX identity |
| Horizontal prompt rules | `CustomEditor`, `setEditorComponent` | Implemented; Pi input and autocomplete retained |
| Contextual help | Custom editor input handling | Implemented for Pi's actual commands and bindings |
| Compact status and detailed statistics | `setFooter` | Implemented; `/pituix-status` toggles details |
| Effort above the prompt | Custom editor, `thinking_level_select`, `model_select` | Implemented; displays Pi's effective level and actual cycle binding |
| Searchable settings page | `ctx.ui.custom`, public `Input` | Reference frame, filtering, focus navigation and value alignment implemented for Pi-TUIX settings |
| Numbered model picker and draft effort | `ctx.scopedModels`, model registry, public capability helpers, `pi.setModel`, `pi.setThinkingLevel` | Implemented in `/pituix-model`; cancellation leaves host state unchanged |
| Searchable resume picker | Public session catalogue, parser/context helpers, modal UI and `ctx.switchSession` | Read-only rich preview includes individual tools, diffs, recorded model/time and completion rows; branch/file-size metadata and rendered binary media remain gaps |
| Working/thinking/responding/tool phase | `setWorkingIndicator`, `setWorkingMessage`, lifecycle events | Implemented with elapsed time and reported output tokens; spinner frames/words are an approximation |
| Completion and interruption feedback | `agent_end`, `agent_settled`, `appendEntry`, `registerEntryRenderer` | One display-only completion per settled run survives resume/reload; cancellation stays distinct; old runs without timing records are not backfilled |
| Queued follow-up count | `input` events, `setStatus`, public dock components | Count and native pending-message rows remain visible; actual delivery verified, Pi-owned |
| Read/Bash/Edit/Write rows | Official tool definitions, `renderShell`, `renderCall`, `renderResult`, shared `context.state`, public `renderDiff`/`highlightCode` | Result branches, compact Read counts, numbered Write previews and numbered Update diffs with row/word backgrounds implemented |
| Adjacent Read/Bash summaries | Finalized message/tool events, public session branch, per-row invalidation | Implemented for adjacent successful calls; paths deduplicated, expanded calls retained, resumed sessions reconstructed |
| Tool expansion | `options.expanded`, configured `app.tools.expand` | Implemented; no invented E binding |
| Execution, errors, cancellation | Original tool `execute` functions | Delegated unchanged |
| Default UI restoration | Public unset/reset methods | Implemented and tested |
| User/assistant transcript chrome | Public document/message containers and identity Markdown transformer | Implemented in regular/fullscreen modes and `/pituix-transcript`; original host containers retained |
| Native model command, transcript navigation, resume | Native Pi commands/components | Retained; `/pituix-model` and `/pituix-resume` provide custom selection surfaces |
| Claude permission modes and approval dialogs | Pi trust/permission semantics differ | Not emulated |
| Claude-specific settings tabs and preferences | Extension-specific settings available | Pi-TUIX categories retained; Claude account/runtime controls are not emulated |
| MCP group summaries and cross-session agents | No universal renderer hook for other extensions | Not reproduced |
| Claude checkpoint/rewind behavior | Pi owns sessions, branches, tool execution | Not reproduced |
| Fullscreen layout and wheel behavior | Public container composition, native viewport and semantic prompt zones | Native page/wheel/prompt navigation, search and selection share the decorated document; regular/fullscreen switching verified |

Pi exposes `ui_prompt_start` and `ui_prompt_end` for blocking extension prompts.
They do not provide a replacement renderer for all host permission decisions.
The main view uses reversible public document-child wrappers, retaining Pi's
original chat, header, editor and dock containers. Native confirmations,
selectors and input retain their focus behavior. Pi's fullscreen viewport and
regular renderer consume the same decorated document, so search closes at its
matched location and native mode switching is available. Standard OSC 133 zones
retain semantic prompt navigation. Unrecognized shapes render natively. No
persistent main-view overlay, separate scroll position or focus observer remains.
Later user Markdown transformers are not reflected in raw user chrome;
assistant rendering preserves the host chain. Multi-line/image selection across
real terminal emulators remains less thoroughly verified than the text fixture.

Tool headings retain explicit status and attention text for accessibility.
Group summaries also retain a compact target list and explicit success status;
errors, cancellation, images and truncated results are never hidden in a group.
Expanded Read can reveal the file body, an intentional Pi-TUIX affordance beyond
the observed reference count-only result. Diff layout follows the reference
number/marker order. The adapter reads changed-token ranges from Pi's public
formatter and replaces inverse video with stronger backgrounds. Removed lines
use plain code text; added/context lines use Pi's public syntax highlighter.
The dark reference theme receives these backgrounds, with distinct 256-color
fallbacks. Other themes retain native diff styling, and `NO_COLOR` disables the
additional paint unless color is explicitly forced. Syntax token boundaries
remain a measured difference, rather than a claim of full syntax parity.

## Validation

- TypeScript compilation against Pi 0.84.4 and Biome checks.
- Public `discoverAndLoadExtensions` loading test with an isolated agent directory.
- Editor/header/footer tests at zero, tiny, narrow, normal, and wide sizes;
  ANSI styling, Chinese input, Unicode and ASCII prompt fallbacks, and cursor
  preservation. A minimum internal editor width works around Pi 0.84's wide-glyph
  wrapping recursion without modifying the host.
- Settings tests cover search, two-step selection, per-tab selection memory,
  Chinese input, ASCII fallback, 1-40 terminal rows, footer restoration, and
  cleanup when the custom view fails. Unsupported wheel-speed UI is removed;
  its stored preference remains for compatibility and has no host effect.
- The enabled preference is shared by settings, enable/default commands and
  startup, including history replay before `session_start`. Regression tests
  cover disabled startup, switching during a run, queue clearing, restoring
  historical completions without blank host rows, malformed preference types
  and configured ASCII pending/result tool rendering. Actual Pi 0.85.1
  fullscreen at 100x40 verifies disabling through settings, reloading while
  disabled, restoring saved completion/interruption lines and switching all
  message/tool/completion symbols from ASCII to Unicode. Pi 0.84.4 regular mode
  at 80x24 verifies disabled startup and restoration of the same saved history.
- Model picker tests cover host scope, capability clamping, draft effort,
  cancellation, selection failures, exact public setter delegation, ANSI/CJK
  rendering and selected-row visibility in short terminals. An interactive Pi
  check verified that confirming medium effort updates the prompt indicator.
- Exact execution-function identity tests for all four overridden tools, plus
  running/success/error/cancellation, expansion, and shared-row replacement tests.
- Public `ToolExecutionComponent` tests compare restored native frames and
  results for all four tools, including errors, expansion and narrow widths.
  An actual official Edit execution verifies the changed file and unchanged
  result payload. Mode switches also test completion of a native partial renderer.
- Interactive Pi full-screen smoke test at 100x40 with an isolated agent directory.
  An isolated display-only provider fixture exposes a reasoning model for effort
  rendering; it sends no requests and is not part of the package.
- A separate scripted provider fixture drives real Pi Read/Bash/Edit/Write
  execution and an exit-code-7 error in a disposable directory. It validates
  result branches, expansion and native restoration through the actual host;
  it is a deterministic UI test, not a successful Pi model-network request.
- Grouping tests cover repeated files, shell invocation counts, text/tool/error
  boundaries, pending results, ANSI/CJK widths, individual expansion and native
  restoration. A saved interactive Pi session was reopened through `--session`
  and retained the expected `Read 1 file, ran 2 shell commands` summary.
- Run-presentation tests cover elapsed time, reported usage without duplicate
  counting, retry duration, settlement, failures, cancellation and ASCII/width
  handling. Actual Pi sessions verified working elapsed time, completion,
  default-UI cleanup and interruption of the arithmetic tool. Pi can also render
  its own aborted-operation error message; that host transcript row remains.
- Completion-entry tests cover schema validation, unknown imports, default-UI
  hiding/restoration, startup replay before `session_start`, and duplicate
  settlement. Pi's public context builder confirms these entries add no model
  messages. Snapshot tests preserve their order without mutating source entries.
  Actual 0.85.1 fullscreen sessions at 80x24 preserve two completed runs through
  `/new`, `/pituix-resume` and `/reload`; default/restore toggles hide and reveal
  both records. Pi 0.84.4 regular mode at 100x32 reopens the same session, cancels
  a real arithmetic Bash call, then preserves the interruption through reload
  and the snapshot reader. The saved file contains exactly three completion
  records with outcomes `done`, `done`, `cancelled`. Starting Pi with the package
  disabled ignores those records and retains the conversation. Fixtures make
  no model-network requests.
- Concurrent-tool state tests cover repeated tool names, out-of-order completion,
  duplicated/late events and cancellation cleanup; lifecycle wiring verifies
  that the working message retains the remaining active tool.
- Diff tests cover changed-token offsets, RGB operands containing SGR-like
  values, explicit `+/-` gutters, background reset after truncation, CJK/emoji,
  256-color fallback, no-color mode, unknown formats and theme restoration.
  Actual 80x24 and 100x40 Pi runs replayed an official Edit result from the saved
  fixture. For both changed lines (`return a - b` / `return a + b`), every cell's
  text, foreground, background and inverse state matched the corresponding
  Claude capture at each width, including the seven-cell right margin.
  Context-line syntax still differs as described above. Native restoration was
  checked in the 80-column host after displaying these colored rows.
- Successful Claude Read/Bash/Edit/Write calls and approval dialogs are now
  observed. Full cross-product visual parity remains incomplete; the tool
  presentation gaps above are based on these authenticated observations.
- The conversation snapshot tests cover raw prompts, Markdown structure,
  message/tool order, result expansion, orphan results, media labels, hidden
  custom messages, errors, cancellation, compaction summaries, ANSI/CJK bounds
  and scroll/close behavior. The reader clones public branch data and invokes
  no tool execution or session mutation. Actual Pi 100x40 and 80x24 sessions
  check grouped/expanded recorded tools, page navigation, editor return and
  `/pituix-default`. Resume previews reuse the snapshot content renderer.
  At 100 columns, the sampled plain assistant line matches all cell text,
  foreground, background and inverse values in the reference. The sampled
  two-line user message matches text and background; one automatically wrapped
  whitespace cell retains a different foreground. Complex Markdown and media
  are not claimed to match fully.
- Live-view tests use public `TuiMainScreen` and `TuiAltScreen` instances to
  exercise both native renderers. They cover streamed/cache updates, original
  chat-container additions/removals, dock preservation, reversible wrapper
  cleanup, native focus, page/prompt/wheel navigation and stream following.
  Native search returns to its matched location. Simulated SGR drag events
  copy the exact displayed `Line 31` text through the public clipboard callback.
  ANSI/CJK bounds, theme/icon changes, semantic-zone order and Markdown padding
  from zero to three cells are covered.
  Actual Pi 0.84.4 regular-mode runs at 100x40 verify Read/Bash/Edit/Write,
  partial output, error handling, follow-up display/delivery, tool expansion
  and default restoration. The installed Pi 0.85.1 at 80x24 verifies fullscreen
  search retention, native mode switching in both directions, regular-mode
  confirmation cancellation and restoration. That host also resumes a saved
  fixture, starts a new session, reloads the extension and cancels an arithmetic
  tool with the cached presentation active. Temporary-theme reset
  after native session/reload commands remains a gap. Deterministic provider
  fixtures make no model-network requests and are excluded from the package.
- A disposable 800-message, 5,600-line benchmark measured static presentation
  redraws before/after caching on the same machine: median about 201.6 ms versus
  0.24 ms over eight warmed renders. Initial rendering was about 234 ms after
  caching. These measure only the message presentation layer, excluding the
  native renderer, terminal I/O and emulator; they are not whole-UI frame times.
- Resume-picker tests cover public session scope, filtering, native input paste,
  preview navigation, two-step selection, loading failures, late callback
  cleanup, single switch delegation, and ANSI/CJK width/height bounds. Actual
  Claude `/resume` list, search and preview screens were captured in the
  disposable reference project without switching or sending a model request.
  Further reference captures verify individual Read/Bash rows, full Edit diffs,
  right-aligned assistant clock/model labels, Home/End navigation, scroll arrows
  and recovery hints at the end of the preview. Pi now uses the same structure
  with its own header and recorded values. Native TuiMainScreen/TuiAltScreen
  tests send input through the terminal callback, proving modal paging, End,
  Home and wheel navigation reach the preview and closing restores editor input.
  Tests cover on-demand loading, aborts, stale completion order, retryable errors,
  expansion, narrow layouts and unchanged legacy-file bytes/mtime after in-memory
  migration. Pi's public context projection is checked against branch/compaction
  fixtures. Actual Pi 0.85.1 at 100x40 and Pi 0.84.4 at 80x24 verify tool/diff
  previews, paging, expansion, completion/interruption rows and native restoration.
  Both previewed session files retain their exact bytes and modification times.
  Enter from the preview successfully resumes through Pi after the overlay closes.
  The local-path installed package was tested by searching, previewing and
  actually switching to a saved fixture session. The resumed tool grouping,
  reference palette and default-UI restoration were verified. A public
  `withSession` callback reapplies the temporary theme after Pi 0.84's saved-theme
  reset; native session/reload commands retain that host behavior.

## Reproduce locally

Development uses the working tree and does not require a package version bump:

```bash
pi install /absolute/path/to/pi-tuix
pi --tui-mode fullscreen
```

In Pi, use `/pituix-status` for detailed statistics, `?` on an empty draft for
help, and `/pituix-default` to restore the native UI and previous theme. Pi-TUIX
respects a different theme chosen by the user before disabling it.

Reference study requires a working Claude Code login or compatible gateway.
Credentials and gateway configuration belong to Claude Code, never to this
extension or its repository. Use only disposable fixture files for tool,
approval and diff tests. Until the presentation and host-owned gaps above are
resolved, this is a partial visual adaptation,
not a complete reproduction.

Public references: [Claude interactive mode](https://code.claude.com/docs/en/interactive-mode),
[Claude installation](https://code.claude.com/docs/en/setup), and the extension
contracts/examples shipped with the supported Pi package.
