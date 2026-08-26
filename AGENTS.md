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
