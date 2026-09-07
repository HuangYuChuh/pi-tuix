# Changelog

All notable changes to Pi-TUIX will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Align startup, prompt rules, and compact footer with observed Claude Code 2.1.263 terminal layout; retain Pi-TUIX identity and Pi runtime ownership.
- Apply the reference dark palette reversibly and expose detailed statistics through `/pituix-status`.
- Add empty-input shortcut help and live working/thinking/responding labels.
- Place effective thinking level above the prompt and add searchable settings tabs with reference spacing, focus navigation, and narrow/short terminal layouts.
- Add a numbered model picker with draft effort adjustment, Pi model scope and capability checks, and cancellation through `/pituix-model`.
- Use public self-rendered tool shells and replace pending rows with results; preserve exact Pi tool execution functions.
- Add result branches, compact Read counts, numbered Write previews, and Update diffs with Pi's public word-level highlighting.
- Group adjacent successful Read/Bash calls into unique-file and shell-call counts, with individual expansion and read-only reconstruction when resuming sessions.
- Add elapsed working feedback, reported output-token counts, and temporary settled-run completion/interruption lines; retain duration through automatic retries.
- Match observed user-message background/text and successful tool-marker colors through the public theme.
- Add a searchable resume picker with public Pi session metadata, text previews, project scope switching, and host-delegated session restoration through `/pituix-resume`.

### Fixed
- Use configured tool expansion bindings instead of the unregistered E hint.
- Guard tiny editor widths against host wide-character wrapping recursion.
- Hide duplicate footer hints during settings and restore them on close or failure; remove the unsupported wheel-speed control from settings.
- Restore existing tool rows as well as new rows with `/pituix-default`; retain a stable public shell adapter and invalidate rows through their public callbacks.
- Finish native running-renderer cleanup after a presentation-mode switch, and refresh collapsed/preview changes even when Pi's expansion flag stays unchanged.
- Recognize Pi's error-form AbortError response as an interruption instead of reporting a failed completion.
- Register each built-in tool once so `/pituix-compact` keeps reference-style summaries and `/pituix-three-layer` restores previews instead of routing to native rows.
- Reapply the temporary reference theme through Pi's fresh `withSession` context after `/pituix-resume` switches sessions.

### Validation
- Add shell, public extension loader, theme restoration, and shared tool-row regression tests.
- Record observed surfaces, authenticated tool/approval workflows, gateway retry behavior and remaining rendering/API gaps in `docs/claude-code-parity.md`.
- Full Claude Code TUI parity remains incomplete; no release or version bump is included.

## [0.1.0] - 2026-08-27

### Overview
First stable release of Pi-TUIX, published to npm with the `latest` dist-tag.

### Added
- Engineering infrastructure
  - Biome for code formatting and linting
  - GitHub Actions CI workflow (typecheck, lint, test, pack:check)
  - GitHub Actions manual publish workflow with npm provenance
  - Test coverage reporting with c8
  - Engineering documentation and contributing guide
- Stream visibility
  - Thinking state indicator (THINKING/RESPONDING/TOOL labels)
  - Plan panel detection and rendering from assistant messages
  - Turn-based progress tracking
- Workflow controls
  - `/pituix-steer` - Send immediate steering message
  - `/pituix-followup` - Queue message for next continuation
  - `/pituix-queue` - Show queued follow-up count
  - `/pituix-plan` - Show/hide/clear detected plan panel
- Status footer
  - Current workflow phase and active tool display
  - Completed and failed tool counts per run
  - Queued follow-up message counter
  - Context pressure indicator (normal/high/critical)
- Editor chrome
  - Reversible custom editor component
  - Working state indicator during agent execution
  - `/pituix-default` command to restore Pi's default editor
- Compact tool rendering
  - Read: show file path, line range, and read status
  - Bash: show command, exit code, and execution time
  - Edit: show file path, diff stats, and edit result
  - Write: show file path, line count, and write status
  - Expandable detail view for all tool results
  - `/pituix-compact` and `/pituix-default` mode switching

### Changed
- All source files formatted with Biome
- Replaced `any` types with proper type annotations
- Test mocks annotated with biome-ignore comments

### Fixed
- Queue counter clears after agent settles
- Footer redraw callback properly detached on cleanup
- npm checks run portably across platforms

### Features
- Claude Code-inspired terminal UI for Pi Coding Agent
- Reversible installation through Pi's package system
- Three-layer built-in tool rendering (Read/Bash/Edit/Write) with collapsed, preview, and expanded modes
- Original compact tool rendering remains available through `/pituix-compact`
- Workflow state visibility and steering commands
- Plan detection and progress tracking
- Context pressure monitoring

### Requirements
- Node.js >= 22.19.0
- Pi Coding Agent >= 0.84.0

### Installation
```bash
pi install npm:pi-tuix@0.1.0
```

### Known Limitations
- Approval UI is not implemented because no supported public Pi API is available yet
- Limited terminal emulator testing

---

## Release Process

1. Update version in `package.json`
2. Update `[Unreleased]` section in this file
3. Run `npm run release:check -- --tag v<version> --channel <latest|beta|next>`
4. Commit: `git commit -am "chore(release): v<version>"`
5. Tag: `git tag v<version>`
6. Push: `git push && git push --tags`
7. Trigger publish workflow: `gh workflow run publish.yml --ref main`
8. Create GitHub Release from tag with changelog excerpt

## Version Scheme

- **0.x.x** - Development previews, breaking changes possible
- **1.x.x** - Stable releases, semantic versioning
- **x.x.x-alpha.N** - Alpha prereleases (may have bugs)
- **x.x.x-beta.N** - Beta prereleases (feature complete, needs testing)
