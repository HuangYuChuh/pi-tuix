# Documentation Policy

Everything tracked under `docs/` is public project documentation. Treat it as content that may be read, quoted, indexed, and redistributed outside the repository.

## Public documentation

Commit these to `docs/`:

- product positioning, scope, and non-goals;
- supported architecture and public API contracts;
- user guides, installation, configuration, and troubleshooting;
- public roadmap items and accepted design decisions;
- compatibility notes and release migration guidance;
- attribution and license analysis required by redistributed work.

Public documents must avoid machine-specific paths, personal account details, private URLs, credentials, raw chat transcripts, unpublished vendor material, and claims that cannot be supported by public evidence.

## Internal documentation

Keep these local and untracked:

- raw competitive research and screenshots not cleared for redistribution;
- personal notes, prompt transcripts, temporary implementation plans, and meeting notes;
- private repository links, account identifiers, local paths, and operational credentials;
- third-party source snapshots or assets whose redistribution rights are unclear;
- generated diagnostics, test recordings, and large raw artifacts.

Use one of the ignored locations or suffixes:

```text
.internal/
docs/internal/
research/
notes/
*.internal.md
*.private.md
```

The ignore list prevents accidental staging, but it is not a security boundary. Never store credentials in the repository directory when a credential manager or environment variable is available.

## Publishing boundary

GitHub contains the public source and public project documentation. The npm package is narrower: `package.json#files` allows only the runtime extension, themes, README, and license into the published tarball.

Before a public push or npm release, run:

```bash
git diff --cached
git grep -nEi "api[_-]?key|password|secret|token|credential"
npm run check
npm run test
npm run pack:check
```

Development installation and release channels are documented separately:

- [`development.md`](development.md) explains persistent local-path installation, source switching, and version mismatch diagnosis.
- [`releasing.md`](releasing.md) defines development, prerelease, and stable channels plus the guarded release workflow.

Review matches in context. Words such as `token` or `credential` are valid in architecture documentation, but actual values and private identifiers are not.

## Documentation standard

Each durable document should state its purpose, describe current behavior rather than speculation, and distinguish commitments from future ideas. Update the relevant document in the same pull request when behavior, compatibility, or ownership changes.
