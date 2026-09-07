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
- `/model`: a selected row, descriptions, current-model marker, effort control,
  and an explicit cancel hint. This remains Pi's native model selector.
- `/config`: a top separator, tab strip, settings search input, aligned setting
  names and values, and navigation hints. At 100 columns, the search box spans
  columns 4-97, search text starts in column 8, labels in column 6, and values
  in column 49. Search initially has focus; Enter selects a result before a
  second Enter changes it. Escape clears a query, leaves search, then closes.
  Pi-TUIX uses this frame and interaction with its own preference categories.
- Shell mode: a leading `!`, an indented result branch, running text replaced by
  output, and an interruption hint during execution.
- A model request failed with an expired-login message. A completion-duration
  line was still rendered for that failed attempt. This is not evidence of a
  successful model turn or of model-driven Read/Edit/Write rendering.

Observed dark-theme colors:

| Role | RGB hex |
| --- | --- |
| Startup accent | `#d77757` |
| Auxiliary text | `#999999` |
| Input rules | `#888888` |
| Selected command/settings accent | `#b1b9f9` |
| Login error | `#ff6b80` |

These five colors are applied to corresponding theme roles. Other syntax and status
colors retain Pi-TUIX's existing accessible palette.

## Implementation and remaining gaps

| Surface | Pi public contract | Status |
| --- | --- | --- |
| Compact startup | `setHeader` | Implemented; original Pi-TUIX identity |
| Horizontal prompt rules | `CustomEditor`, `setEditorComponent` | Implemented; Pi input and autocomplete retained |
| Contextual help | Custom editor input handling | Implemented for Pi's actual commands and bindings |
| Compact status and detailed statistics | `setFooter` | Implemented; `/pituix-status` toggles details |
| Effort above the prompt | Custom editor, `thinking_level_select`, `model_select` | Implemented; displays Pi's effective level and actual cycle binding |
| Searchable settings page | `ctx.ui.custom`, public `Input` | Reference frame, filtering, focus navigation and value alignment implemented for Pi-TUIX settings |
| Working/thinking/responding/tool phase | `setWorkingIndicator`, `setWorkingMessage`, lifecycle events | Implemented; spinner frames are an approximation |
| Queued follow-up count | `input` events, `setStatus` | Observational count; Pi owns delivery |
| Read/Bash/Edit/Write rows | Official tool definitions, `renderShell`, `renderCall`, `renderResult`, shared `context.state` | Compact adaptation implemented; full reference comparison awaits login |
| Tool expansion | `options.expanded`, configured `app.tools.expand` | Implemented; no invented E binding |
| Execution, errors, cancellation | Original tool `execute` functions | Delegated unchanged |
| Default UI restoration | Public unset/reset methods | Implemented and tested |
| Built-in user/assistant transcript chrome | No general replacement hook in the declared extension contract | Host-owned; not pixel-identical |
| Model menu, transcript navigation, resume | Native Pi commands/components | Retained; command and key semantics differ |
| Claude permission modes and approval dialogs | Pi trust/permission semantics differ | Not emulated |
| Claude-specific settings tabs and preferences | Extension-specific settings available | Pi-TUIX categories retained; Claude account/runtime controls are not emulated |
| MCP group summaries and cross-session agents | No universal renderer hook for other extensions | Not reproduced |
| Claude checkpoint/rewind behavior | Pi owns sessions, branches, tool execution | Not reproduced |
| Fullscreen layout and wheel behavior | Pi owns its terminal layout | Use host `--tui-mode fullscreen`; no private-field patch |

Pi exposes `ui_prompt_start` and `ui_prompt_end` for blocking extension prompts.
They do not provide a replacement renderer for all host permission decisions.

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
- Exact execution-function identity tests for all four overridden tools, plus
  running/success/error/cancellation, expansion, and shared-row replacement tests.
- Interactive Pi full-screen smoke test at 100x40 with an isolated agent directory.
  An isolated display-only provider fixture exposes a reasoning model for effort
  rendering; it sends no requests and is not part of the package.
- Successful Claude model-driven tool calls, streaming, approval dialogs, and
  full cross-product visual parity remain unverified because login expired.

## Reproduce locally

Development uses the working tree and does not require a package version bump:

```bash
pi install /absolute/path/to/pi-tuix
pi --tui-mode fullscreen
```

In Pi, use `/pituix-status` for detailed statistics, `?` on an empty draft for
help, and `/pituix-default` to restore the native UI and previous theme. Pi-TUIX
respects a different theme chosen by the user before disabling it.

Continue the reference study after authenticating Claude Code with `/login` or
configuring a compatible third-party gateway locally. Credentials and gateway
configuration belong to Claude Code, never to this extension or its repository.
Use only disposable fixture files for tool/approval/diff tests. Until that work
and the host-owned gaps above are resolved, this is a partial visual adaptation,
not a complete reproduction.

Public references: [Claude interactive mode](https://code.claude.com/docs/en/interactive-mode),
[Claude installation](https://code.claude.com/docs/en/setup), and the extension
contracts/examples shipped with the supported Pi package.
