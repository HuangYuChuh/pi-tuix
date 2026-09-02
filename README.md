# Pi-TUIX

<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Node.js >=22.19](https://img.shields.io/badge/Node.js-%3E%3D22.19-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Pi Coding Agent >=0.84](https://img.shields.io/badge/Pi%20Coding%20Agent-%3E%3D0.84-4B5563)](https://github.com/badlogic/pi-mono)

</div>

> **Status:** `0.1.0` source release; npm publication is not available yet.

**Pi-TUIX** is an open-source terminal UI extension for the Pi Coding Agent. It adds a clearer, denser interface for long coding sessions while Pi continues to own model requests, built-in tools, sessions, permissions, and provider integrations.

## Why Pi-TUIX

When a coding session is long, the hard part is often knowing what is happening, what changed, and whether you need to intervene. Pi-TUIX improves that information hierarchy without moving your work to a second agent runtime.

- See the active model, workspace, and context signal in the shell.
- Keep working and streaming feedback visible without transcript noise.
- Switch back to Pi's default interface in the same session.
- Adopt it as a removable package; Pi remains the system of record.

## Quick Start

### Install the development version

Requirements: Node.js `>=22.19.0` and Pi Coding Agent `>=0.84.0`. The npm package is not published yet, so development installs use a local source checkout. Clone the repository first, or use an existing checkout:

```bash
git clone https://github.com/HuangYuChuh/pi-tuix.git
cd pi-tuix
npm install
npm run check
pi install /absolute/path/to/pi-tuix --approve
pi list
```

Pi stores the local path in user settings and loads that working tree across projects. Restart Pi after code changes. Use `pi install -l /absolute/path/to/pi-tuix --approve` for a project-local installation, or `pi -e ./extensions/index.ts` for a one-off preview that is not saved.

### npm installation

Pi-TUIX has not been published to npm yet. Do not use `pi install npm:pi-tuix` until a release is announced. The eventual npm installation and release process is documented in [Releasing Pi-TUIX](docs/releasing.md).

See [Using the development version](docs/development.md) for local installation and [Releasing Pi-TUIX](docs/releasing.md) for development, prerelease, and stable channel rules.

## Current Development

The `feat/open-tui-pituix` development branch combines an adapted `pi-open-tui` shell with Pi-TUIX three-layer Read/Bash/Edit/Write presentation. The shell supplies the responsive header, footer, framed editor, Git/runtime/context/cost indicators, settings UI, and turn telemetry. Tool execution remains delegated to Pi unchanged.

The framed editor extends Pi's public `CustomEditor`, preserving submission, history, autocomplete, paste handling, and registered application shortcuts. `/pituix-default` removes the Pi-TUIX shell and restores Pi's native components in the active session.

Each tool row keeps the action, target, state, and attention signal visible. The default preview shows the first and last two detail lines; collapsed mode keeps only the summary, and expanded mode reveals the full output or diff. Read and Bash results summarize output size, Edit reports diff statistics, and Write reports the written line count. All views use ANSI-aware width constraints.

These commands are reversible:

| Command | Purpose |
| --- | --- |
| `/pituix` | Enable or restore the Pi-TUIX shell |
| `/pituix-default` | Restore Pi's default TUI components |
| `/pituix-compact` | Use the original compact tool renderer |
| `/pituix-three-layer` | Use the three-layer tool renderer |
| `/pituix-mode <collapsed\|preview\|expanded>` | Set the tool detail display mode; preview is the default |
| `/pituix-about` | Show the package and compatible Pi version |
| `/pituix-settings` | Open shell, footer, icon, and telemetry settings |
| `/pituix-steer <message>` | Interrupt the current run with an immediate correction |
| `/pituix-followup <message>` | Queue work to start after the current run |
| `/pituix-queue` | Show whether Pi has queued follow-up messages |
| `/pituix-plan [show\|hide\|clear]` | Control the detected read-only plan panel |

The bundled `pi-tuix-dark` theme is available from Pi's `/settings` screen. This branch includes adapted MIT-licensed code from [OldSuns/pi-open-tui](https://github.com/OldSuns/pi-open-tui); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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
2. **Tool surface (current):** three-layer Read/Bash/Edit/Write rows with collapsed, preview, and expanded modes; explicit queued/running/success/error/cancelled states; and diff summaries.
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
