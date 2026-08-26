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

### Try the current prototype locally

Requirements: Node.js `>=22.19.0` and Pi Coding Agent `>=0.84.0`.

```bash
npm install
npm run check
pi -e ./extensions/index.ts
```

### Install from npm (after the first release)

```bash
pi install npm:pi-tuix
```

For a project-local install, use `pi install -l npm:pi-tuix`.

## Current Prototype

The foundation release wires Pi's public `ExtensionAPI` to a Pi-TUIX header, footer, terminal title, and working indicator. These commands are reversible:

| Command | Purpose |
| --- | --- |
| `/pituix` | Enable or restore the Pi-TUIX shell |
| `/pituix-default` | Restore Pi's default TUI components |
| `/pituix-about` | Show the package and compatible Pi version |

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

Components render state. Lifecycle handlers translate Pi events into small UI updates; they do not call providers or execute shell commands as a rendering side effect. Planned tool renderers will delegate execution to Pi unchanged and replace only the call/result presentation.

## Roadmap

1. **Shell (current):** header, footer, terminal title, theme, and working state.
2. **Tool surface:** compact Read/Bash/Edit/Write rows, folded output, and diff summaries.
3. **Stream surface:** thinking labels, progress, token/context status, and repaint discipline.
4. **Control surface:** approval dialogs, plan review, steering queue, and keyboard conventions.
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
