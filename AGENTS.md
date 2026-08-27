# Pi-TUIX Repository Instructions

## Mission

Build an installable, Claude Code-inspired terminal experience for Pi Coding Agent using Pi's public extension APIs and `@earendil-works/pi-tui`.

Pi-TUIX improves how existing Pi workflows are presented and controlled. It is not a Pi fork, a model gateway, or a second agent runtime.

## Product boundary

Pi-TUIX may own:

- header, footer, editor chrome, widgets, overlays, and themes;
- working, thinking, streaming, approval, and queue presentation;
- compact tool-call and tool-result rendering;
- keyboard interactions explicitly registered by the extension;
- UI preferences that can be removed without migrating Pi data.

Pi-TUIX must not own:

- provider or model requests;
- built-in tool execution semantics;
- credentials, permissions, or project trust;
- session persistence, branching, or compaction logic;
- patches to private Pi modules;
- Claude Code proprietary code, assets, branding, or protocols.

## Technical authority

Use sources in this order:

1. Types and documentation exported by the supported Pi package.
2. Official Pi extension examples.
3. Public `@earendil-works/pi-tui` component contracts.
4. Third-party projects only as design or implementation references after checking their license and runtime assumptions.

Do not treat an internal Pi file path as a stable API. When a required behavior is not available through public hooks, document the gap instead of patching the host.

## Architecture

Keep implementation responsibilities separated:

```text
extensions/
  index.ts          lifecycle wiring and command registration
  shell/            header, footer, editor, and theme coordination
  stream/           working, thinking, streaming, and progress state
  tools/            Read, Bash, Edit, Write, MCP, and diff renderers
  control/          approval, plan, queue, keyboard, and overlays
  session/          context, resume, subagent, and reference surfaces
```

Components render state. They do not call providers or execute shell commands as a side effect of rendering. Lifecycle handlers translate Pi events into small UI state updates.

For built-in tools, delegate to Pi's official tool implementation and replace only supported render behavior. Preserve execution inputs, outputs, errors, cancellation, and permission behavior.

## UI rules

- Optimize for scanning during long coding sessions, not visual imitation alone.
- The first line of a tool result must show action, target, state, and whether attention is required.
- Keep default output compact and reveal detail progressively.
- Use `visibleWidth`, `truncateToWidth`, and stable layout constraints for narrow terminals and ANSI-colored text.
- Never depend on color alone to communicate success, failure, running, or blocked state.
- Avoid terminal-width-dependent font or symbol tricks that produce unstable wrapping.
- Restoring Pi's default components must remain available in the active session.

## Compatibility

- Keep Pi and `pi-tui` as peer dependencies so the host supplies one compatible UI runtime.
- State the supported Pi range in `package.json` and documentation.
- Add compatibility adapters near the affected component; do not vendor the Pi runtime.
- Prefer ASCII in source and documentation unless a UI symbol has a tested fallback.

## Development and release channels

- Treat a local-path Pi installation as the default development channel. It points directly at the working tree and does not require a package version bump for each change.
- Keep `main` usable. Use short-lived feature branches for incomplete or risky work, and use Conventional Commits for repository history.
- Do not run `npm publish`, create or push a version tag, or create a GitHub Release unless the user explicitly requests a release.
- Do not describe the value in `package.json#version` as a published release by itself. A stable release requires a matching `v<version>` Git tag, an npm package published with the `latest` dist-tag, and a GitHub Release.
- Publish prerelease versions only with a prerelease SemVer such as `0.2.0-beta.1` and a non-`latest` npm dist-tag such as `beta` or `next`.
- Before a release, require a clean `main` worktree and run `npm run release:check -- --tag v<version> --channel <latest|beta|next>`.
- Keep installation sources explicit in commands and documentation: local path for development, `npm:pi-tuix@<version>` for a pinned release, and `npm:pi-tuix` for the current stable release.

## Verification

Every UI change should be checked at minimum for:

- TypeScript compilation against the declared Pi version.
- Loadability through Pi's extension loader.
- width behavior at narrow and normal terminal sizes;
- ANSI-aware visible width and truncation;
- correct idle, running, success, error, and cancellation states where relevant;
- reversibility through `/pituix-default` or package removal.

Tool renderer changes also require a test confirming that execution is still delegated to Pi unchanged.

## Scope decisions

Read `docs/product-context.md`, `docs/positioning.md`, and `docs/architecture.md` before changing product boundaries or introducing a new runtime dependency. Update those documents when a decision changes the ownership model, MVP scope, or compatibility contract.

## Engineering standards

- Use Biome for formatting and linting; do not introduce a parallel ESLint or Prettier configuration.
- Before committing code, run `npm run check` and `npm test`. Run `npm run pack:check` when package contents or release behavior changes.
- Add or update regression tests for behavior changes. Do not lower coverage thresholds merely to make a check pass.
- Use Conventional Commits in the form `<type>(<scope>): <subject>`. Common types are `feat`, `fix`, `refactor`, `test`, `docs`, and `chore`.
- During MVP validation, keep development on the `0.1.x` line and do not bump the package version for ordinary development commits. A version bump must represent an intentional release candidate approved by the user.
- Do not advance to a new minor version merely because work accumulated. Require a meaningful, documented product milestone and explicit user approval.

For detailed commands, coverage information, and release procedures, see `docs/engineering.md` and `CHANGELOG.md`.
