# README SEO Audit

Audit date: 2026-08-26

This audit reflects the repository's early-development state. It distinguishes implemented behavior from roadmap items and avoids claiming an npm release or production-ready tool renderers.

## Scorecard

| Dimension | Before | After | Status | Evidence |
| --- | ---: | ---: | --- | --- |
| Repository name | 8 | 8 | PASS | `pi-tuix` contains the Pi/TUI category signal and a distinct product name. |
| Description | 6 | 9 | PASS | Keyword-first, under 120 characters, and aligned across README and package metadata. |
| Topics | 3* | 9 | Ready to apply | Copy-ready 15-topic set below; GitHub repository settings require a remote update. |
| Social preview | 0 | 0 | Pending asset | No distributable banner exists yet; exact brief is below. |
| README above the fold | 4 | 8 | PASS | Language switcher, stage-appropriate badges, status, definition, value, and quick start appear first. A visual banner remains pending. |
| README structure | 7 | 10 | PASS | Current features, quick start, architecture, roadmap, docs, contributing, security, and license are covered. |
| Internationalization | 4 | 10 | PASS | English plus Simplified Chinese, Japanese, Traditional Chinese, Korean, and Spanish. |
| Badges | 2 | 8 | PASS | License, runtime, and host compatibility suit an unpublished early-stage project. |
| GEO readiness | 4 | 9 | PASS | Definitional opener, factual headings, architecture summary, and `llms.txt`. |
| Activity signals | 7 | 7 | PASS | The repository is new and has recent foundation commits; there are no releases yet. |

`*` The live GitHub Topics query failed with a network EOF. The before score uses the six original `package.json` keywords as a conservative proxy, not a claim about current remote settings.

Weighted score: **4.5/10 estimated before -> 7.1/10 after verified local changes -> 7.9/10 after applying GitHub Topics**. A compliant social preview would raise the projected score to **8.6/10**.

## GitHub Description

Recommended positioning version:

```text
Open source terminal UI extension for Pi Coding Agent with a clearer Claude Code-inspired workflow.
```

Alternatives:

```text
Claude Code-inspired terminal experience for Pi Coding Agent, built on Pi's public extension APIs.
```

```text
The open source terminal UX layer for Pi Coding Agent.
```

## GitHub Topics

Apply these 15 topics in the repository settings:

```text
pi-tuix
pi-coding-agent
pi-extension
pi-tui
terminal-ui
tui
terminal
coding-agent
developer-tools
open-source
claude-code-alternative
command-line
typescript
nodejs
ai-coding
```

## Social Preview Brief

- Size: `1280 x 640 px`.
- Background: near-black `#0B0F14`, matching a focused terminal workspace without relying on a single blue/purple palette.
- Primary copy: `Pi-TUIX`.
- Supporting copy: `A clearer terminal UI for Pi Coding Agent`.
- Visual: a real terminal capture showing the Pi-TUIX header, footer, working state, and `/pituix-default`; do not show roadmap-only tool renderers.
- Variants: dark primary plus a light `#F7F8FA` version.
- Export: PNG at `1280 x 640`, with text kept inside a central `1120 x 480` safe area.
- Tools: Figma or Canva.

## Action Checklist

### Five minutes

- [ ] Set the GitHub Description to the recommended positioning version.
- [ ] Add the 15 GitHub Topics above.
- [ ] Keep the repository website unset until a real docs or product URL exists.

### Thirty minutes

- [x] Restructure the README above the fold.
- [x] Add stage-appropriate badges.
- [x] Align `package.json` description and keywords.
- [x] Add the language switcher and complete translations.
- [x] Add `llms.txt`.

### One to two hours

- [ ] Capture a real terminal screenshot after the next meaningful UI milestone.
- [ ] Create and upload the social preview using the brief above.

### Ongoing

- [ ] Keep current behavior and roadmap claims separate.
- [ ] Update translated READMEs when the English source changes materially.
- [ ] Add release/download badges only after npm publication.
- [ ] Add build status only after a public CI workflow exists.
