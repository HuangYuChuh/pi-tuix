# Pi-TUIX Positioning

## Problem

Pi's agent runtime is useful, but its default terminal presentation can become difficult to scan during long coding sessions. Tool calls, diffs, model state, context pressure, and queued interaction are all important operational signals; when they are rendered as a flat stream, the user has to reconstruct the state mentally.

## Product statement

Pi-TUIX is a focused terminal UI layer for Pi Coding Agent. It brings a Claude Code-inspired information hierarchy to Pi without replacing Pi's runtime or locking users into a new provider ecosystem.

## What Pi-TUIX owns

- visual hierarchy and spacing;
- terminal components and overlays;
- tool-call summaries and diff presentation;
- working, thinking, approval, and queue indicators;
- Pi-specific theme tokens and UI preferences;
- keyboard interaction that is explicitly scoped to the extension.

## What Pi-TUIX does not own

- LLM provider calls;
- built-in tool execution;
- session persistence or branching;
- credentials and permissions;
- model catalogues;
- project file mutation outside Pi's existing tools.

## Design principles

### Scan before reading

The first line of a tool row should answer what happened and whether attention is needed. Full output is available on demand.

### State is visible, not decorative

Model, thinking level, context pressure, Git workspace, and running/blocked state should be compactly visible where they affect decisions.

### Progressive disclosure

The default view stays calm. `Ctrl+O`, overlays, and dedicated commands reveal detail without forcing every result into the transcript.

### Extension-first compatibility

Pi-TUIX uses public Pi extension hooks and the official `pi-tui` component contract. Internal Pi modules are not treated as stable APIs.

### Reversible adoption

Users can install Pi-TUIX globally or per project, switch back to the default Pi interface, and remove the package without migrating sessions.

## Naming

The product name is **Pi-TUIX**. The npm package and repository use lowercase `pi-tuix`. `TUIX` means an extended terminal experience, not a replacement for the official `pi-tui` component library.
