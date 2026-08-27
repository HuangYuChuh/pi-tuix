# Contributing to Pi-TUIX

Pi-TUIX welcomes focused issues and pull requests that improve Pi's terminal workflow through supported extension APIs.

## Before contributing

Read:

- `docs/product-context.md` for the user problem and MVP;
- `docs/positioning.md` for product ownership boundaries;
- `docs/architecture.md` for runtime boundaries;
- `docs/development.md` for persistent local installation and channel switching;
- `docs/releasing.md` for version and release rules;
- `AGENTS.md` for implementation and verification rules;
- `docs/README.md` for the public/internal documentation policy.

## Development

Pi-TUIX requires Node.js 22.19 or newer and a compatible Pi Coding Agent installation.

```bash
npm install
npm run check     # typecheck + lint
npm run test      # test suite
npm run pack:check
```

### Code quality tools

- **Biome**: formatter and linter (`npm run lint`, `npm run format`)
- **TypeScript**: type checking (`npm run typecheck`)
- **Tests**: Node.js native test runner

See [docs/engineering.md](docs/engineering.md) for detailed workflow and CI/CD information.

Install the working tree as the persistent development package with:

```bash
pi install /absolute/path/to/pi-tuix --approve
pi list
```

Restart Pi after extension changes. For a one-off load that does not update Pi settings, use `pi -e ./extensions/index.ts`.

## Pull requests

Keep changes focused and explain the user workflow they improve. Include terminal widths and UI states tested for visual changes. Tool renderer changes must show that Pi's original execution path, cancellation, errors, and permissions remain intact.

Do not commit private research, credentials, machine-specific paths, raw transcripts, proprietary assets, or generated browser/test artifacts. Use the ignored internal paths documented in `docs/README.md` for local working notes.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
