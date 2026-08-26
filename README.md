# Pi-TUIX

Claude Code-inspired terminal interface for the Pi Coding Agent.

Pi-TUIX is an installable Pi package built on the official `ExtensionAPI` and `@earendil-works/pi-tui`. It changes the way Pi presents work in the terminal while leaving the Pi runtime, models, tools, sessions, permissions, and provider integrations in charge.

The repository is currently in the foundation phase. The product boundary and MVP decisions are documented before deeper UI work begins, so each feature can be judged by whether it improves a real Pi workflow rather than merely looking like another terminal client.

> Status: early development. The package is not published to npm yet.

## Positioning

Pi-TUIX is a UI layer, not a Pi fork and not a second coding-agent runtime.

It is designed for people who already use Pi successfully but want a clearer, denser, more deliberate terminal workflow inspired by Claude Code:

- visible model, thinking, context, and workspace state;
- compact tool-call rows instead of noisy transcripts;
- readable edit and write diffs;
- stable streaming and working indicators;
- focused approval, plan, and session overlays;
- a package that follows Pi's extension and `pi-tui` contracts.

## Install

From npm once published:

```bash
pi install npm:pi-tuix
```

For a project-local install:

```bash
pi install -l npm:pi-tuix
```

For local development:

```bash
pi -e ./extensions/index.ts
```

## Current prototype

The first prototype provides a Pi-TUIX header, footer, working indicator, and commands for switching between Pi-TUIX and the default Pi interface:

```text
/pituix
/pituix-default
/pituix-about
```

The bundled `pi-tuix-dark` theme can be selected from Pi's `/settings` screen.

## Roadmap

1. Shell: header, footer, editor chrome, theme, and stable working state.
2. Tool surface: compact Read/Bash/Edit/Write rows, output folding, and diff summaries.
3. Stream surface: thinking labels, tool progress, token/context status, and repaint discipline.
4. Control surface: approval dialogs, plan review, steering queue, and keyboard conventions.
5. Session surface: resume, context inspection, subagent state, and session references.

The MVP scope and acceptance criteria are recorded in [docs/product-context.md](docs/product-context.md). Repository-level implementation constraints for coding agents are in [AGENTS.md](AGENTS.md).

## Contributing

Pi-TUIX is being developed as an open-source project. Public architecture, product decisions, and user documentation live in [`docs/`](docs/). Local research, private links, raw transcripts, and internal development notes must stay in ignored internal paths described by [docs/README.md](docs/README.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Compatibility contract

- Supported host: Pi Coding Agent `>=0.84.0`.
- UI implementation: official `@earendil-works/pi-tui` APIs.
- Runtime ownership: official Pi owns model calls, tools, sessions, permissions, and persistence.
- Third-party source: no Claude Code source or proprietary assets are copied.
- Extension behavior: Pi-TUIX should be removable without changing project files or session data.

## License

MIT. See [docs/product-context.md](docs/product-context.md), [docs/positioning.md](docs/positioning.md), and [docs/architecture.md](docs/architecture.md) for the project context.
