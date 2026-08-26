# Pi-TUIX Product Context

## Why this project exists

Pi already provides the coding-agent runtime we want to use. The product problem is not model capability; it is the amount of mental work required to understand a long terminal session.

During real coding work, the operator needs to answer four questions quickly:

1. What is Pi doing now?
2. What changed in the workspace?
3. Does anything require approval or intervention?
4. How much model context and session capacity remains?

Pi-TUIX makes those answers easier to scan while preserving Pi as the system of record.

## Target user

The first user is an existing Pi operator who is comfortable working in a terminal but prefers the information hierarchy and interaction rhythm associated with Claude Code. They do not want to migrate providers, sessions, tools, or credentials to a new agent runtime just to get a clearer interface.

This means the product optimizes for repeated daily coding sessions, not for a one-time visual demo.

## Product promise

Install one Pi package and get a calmer, more legible terminal workflow. Disable or remove it and continue using the same Pi installation and session data.

## MVP workflow

The first useful release must support this loop:

1. Start Pi and immediately see the active model, workspace, thinking level, and context state.
2. Send a coding request using a stable editor surface.
3. Follow thinking, streaming, and queued work without layout noise.
4. Scan Read, Bash, Edit, and Write calls as compact rows.
5. Expand tool details and diffs when a decision requires them.
6. Recognize errors, approvals, and blocked states without reading the whole transcript.
7. Restore Pi's default UI without changing the session.

## MVP success criteria

- Pi-TUIX installs through Pi's package mechanism.
- It runs against the declared supported Pi versions using public extension APIs.
- Header, footer, editor, and tool rows remain readable in narrow terminals.
- Built-in tool execution behavior is unchanged; only rendering is delegated.
- Disabling Pi-TUIX restores the default interface within the same session.
- No Pi session, provider, credential, or project-file migration is required.

## Explicit non-goals

- Reimplementing the Pi agent loop.
- Forking or patching Pi internals for visual parity.
- Copying Claude Code source code, private protocols, branding, or proprietary assets.
- Building a new provider abstraction or credential store.
- Promising pixel-perfect Claude Code reproduction across terminal emulators.
- Adding unrelated IDE, desktop, or web interfaces to the MVP.

## Reference policy

Claude Code is a product-design reference for hierarchy and interaction rhythm. `dsh-TUI` and CodeWhale may be studied for public design and implementation ideas. Pi's own extension examples and `pi-tui` contracts remain the technical authority for this repository.

Reference code is not copied blindly. Different licenses, runtimes, and architectural assumptions must be documented before any implementation is adapted.

## Decision rule

A feature belongs in Pi-TUIX when it improves how a user perceives or controls an existing Pi workflow through supported extension hooks. If it needs to own model calls, tool execution, permissions, credentials, or session persistence, it belongs in Pi or a separate integration, not in this package.

## Release sequence

### Foundation

Repository contract, installable manifest, theme, shell prototype, and compatibility checks.

### MVP

Claude Code-inspired shell, working state, and compact Read/Bash/Edit/Write rendering.

### Workflow controls

Approval, plan, queue, keyboard, and focused overlays using Pi's public UI APIs.

### Session awareness

Context pressure, resume references, and subagent status where Pi exposes reliable events or read-only state.
