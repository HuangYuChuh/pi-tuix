# Pi-TUIX

<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Node.js >=22.19](https://img.shields.io/badge/Node.js-%3E%3D22.19-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Pi Coding Agent >=0.84](https://img.shields.io/badge/Pi%20Coding%20Agent-%3E%3D0.84-4B5563)](https://github.com/badlogic/pi-mono)

</div>

> **Status:** early development. `pi-tuix` is not published to npm yet.

**Pi-TUIX** is an open-source terminal UI extension for the Pi Coding Agent. It adds a clearer, denser interface for long coding sessions while Pi continues to own model requests, built-in tools, sessions, permissions, and provider integrations.

## Why Pi-TUIX

When a coding session is long, the hard part is often knowing what is happening, what changed, and whether you need to intervene. Pi-TUIX improves that information hierarchy without moving your work to a second agent runtime.

- See the active model, workspace, and context signal in the shell.
- Keep working and streaming feedback visible without transcript noise.
- Switch back to Pi's default interface in the same session.
- Adopt it as a removable package; Pi remains the system of record.

## Quick Start

### Install the development version

Requirements: Node.js `>=22.19.0` and Pi Coding Agent `>=0.84.0`.

```bash
npm install
npm run check
pi install /absolute/path/to/pi-tuix --approve
pi list
```

Pi stores the local path in user settings and loads that working tree across projects. Restart Pi after code changes. Use `pi install -l /absolute/path/to/pi-tuix --approve` for a project-local installation, or `pi -e ./extensions/index.ts` for a one-off preview that is not saved.

### Install from npm (after the first release)

```bash
pi install npm:pi-tuix
```

For a project-local install, use `pi install -l npm:pi-tuix`.

See [Using the development version](docs/development.md) for installation-source switching and [Releasing Pi-TUIX](docs/releasing.md) for development, prerelease, and stable channel rules.

## Current Prototype

The foundation release wires Pi's public `ExtensionAPI` to a Pi-TUIX header, footer, terminal title, working indicator, editor chrome, and compact Read/Bash/Edit/Write presentation. Tool execution remains delegated to Pi unchanged.

The editor border shows `READY/WORKING` plus prompt line and character counts. It extends Pi's public `CustomEditor`, preserving submission, history, autocomplete, paste handling, and registered application shortcuts.

Each compact tool row keeps the action, target, state, and attention signal visible. Read and Bash results summarize output size, Edit reports diff statistics, and Write reports the written line count. Expanded rows reveal output or diffs using ANSI-aware width constraints.

These commands are reversible:

| Command | Purpose |
| --- | --- |
| `/pituix` | Enable or restore the Pi-TUIX shell |
| `/pituix-default` | Restore Pi's default TUI components |
| `/pituix-about` | Show the package and compatible Pi version |
| `/pituix-steer <message>` | Interrupt the current run with an immediate correction |
| `/pituix-followup <message>` | Queue work to start after the current run |
| `/pituix-queue` | Show whether Pi has queued follow-up messages |
| `/pituix-plan [show\|hide\|clear]` | Control the detected read-only plan panel |

The bundled `pi-tuix-dark` theme is available from Pi's `/settings` screen.

## How It Works

Pi-TUIX is a presentation layer around Pi's supported extension hooks:

```text
Pi Coding Agent (runtime, providers, tools, sessions, permissions)
                     |
               public ExtensionAPI
                     |
                 Pi-TUIX shell
          (header, footer, indicators, themes)
```

Components render state. Lifecycle handlers translate Pi events into small UI updates; they do not call providers or execute shell commands as a rendering side effect. Tool renderers delegate execution to Pi unchanged and replace only the call/result presentation.

The stream line distinguishes thinking, response text, and tool execution by turn. Context pressure is labelled `HIGH` at 80% and `CRITICAL` at 95%. When an assistant response contains a `Plan:` heading followed by numbered or checkbox steps, Pi-TUIX shows a width-safe read-only plan panel above the editor. The panel reflects checked items and `[DONE:n]` markers without changing prompts, tools, or execution.

## Roadmap

1. **Shell (current):** header, footer, terminal title, theme, working state, and reversible editor chrome.
2. **Tool surface (current):** compact Read/Bash/Edit/Write rows, explicit queued/running/success/error/cancelled states, expandable output, and diff summaries.
3. **Stream surface (current):** thinking/responding/tool activity, turn progress, thinking level, context pressure, and stable repainting.
4. **Control surface (in progress):** steer/follow-up queue commands and read-only plan review are available; approval adapters and keyboard conventions remain planned.
5. **Session surface:** context inspection, resume references, subagent state, and session surfaces where Pi exposes reliable public events.

The scope and acceptance criteria are documented in [docs/product-context.md](docs/product-context.md). The product boundary is in [docs/positioning.md](docs/positioning.md), and the runtime design is in [docs/architecture.md](docs/architecture.md).

## Compatibility Contract

- **Host:** Pi Coding Agent `>=0.84.0`.
- **UI runtime:** `@earendil-works/pi-tui` `>=0.84.0` as a peer dependency.
- **Ownership:** Pi owns model calls, tool execution, sessions, permissions, credentials, and persistence.
- **Public APIs:** implementation targets Pi's documented extension contracts; private Pi modules are not patched or vendored.
- **Reversibility:** disabling or removing Pi-TUIX does not require migrating Pi sessions or project files.
- **Provenance:** no Claude Code source, private protocol, branding, or proprietary asset is included.

## Documentation

- [Product context](docs/product-context.md) - user problem, MVP workflow, and non-goals
- [Positioning](docs/positioning.md) - ownership boundaries and design principles
- [Architecture](docs/architecture.md) - event-to-view rules and compatibility strategy
- [Development version](docs/development.md) - persistent local installation and channel switching
- [Release process](docs/releasing.md) - version, npm channel, tag, and publication gates
- [Documentation policy](docs/README.md) - what belongs in public documentation
- [Contributing](CONTRIBUTING.md) - local setup and pull-request expectations
- [Security policy](SECURITY.md) - vulnerability reporting

## Contributing

Focused issues and pull requests are welcome. Before changing a renderer or lifecycle hook, run:

```bash
npm run check
npm run test
npm run pack:check
```

UI changes should be checked at narrow and normal terminal widths, including idle, running, success, error, and cancellation states. Tool renderer changes must demonstrate that Pi's execution, cancellation, errors, and permissions remain unchanged. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full checklist.

## License

Pi-TUIX is released under the [MIT License](LICENSE).
