# Using the development version

Pi-TUIX uses a local-path Pi package as its permanent development channel. Pi records the source in user settings and loads the current working tree, so code changes can be tested without publishing to npm or changing the package version.

> **Important:** A local-path installation follows the checked-out files. Switching branches or leaving incomplete changes in the working tree changes what Pi loads the next time it starts.

## Install the development version

Install dependencies and verify the checkout:

```powershell
Set-Location C:\path\to\pi-tuix
npm install
npm run check
npm run test
```

Install that checkout for the current user:

```powershell
pi install "C:\path\to\pi-tuix" --approve
pi list
```

The installation is available across projects. Restart Pi after changing extension code so the extension loader reads the updated files.

To limit the development installation to one project, run this from that project instead:

```powershell
pi install -l "C:\path\to\pi-tuix" --approve
```

Project-local packages are recorded in the project's `.pi/settings.json`. Do not commit a machine-specific absolute path to a shared repository.

## Identify the active channel

Run `pi list` before diagnosing a version mismatch. The source determines the channel:

| Source | Channel | Updates |
| --- | --- | --- |
| `C:\path\to\pi-tuix` | Development | Follows the local working tree after Pi restarts |
| `npm:pi-tuix@0.1.1-beta.1` | Prerelease | Pinned to the named npm version |
| `npm:pi-tuix@0.1.0` | Stable, pinned | Stays on that exact npm version |
| `npm:pi-tuix` | Stable, current | Resolves through npm's `latest` dist-tag |

The `version` field in `package.json` identifies package metadata; it does not prove that the working tree was published. Use the source shown by `pi list` when deciding which code Pi is actually loading.

## Switch installation sources

Use the exact source shown by `pi list` when removing an installation:

```powershell
pi remove "C:\path\to\pi-tuix"
pi install npm:pi-tuix@0.1.0
pi list
```

For a project-local source, add `-l` to both `pi remove` and `pi install`. Avoid keeping local-path and npm sources for Pi-TUIX enabled in the same scope because duplicate extension registration can make the active code ambiguous.

## Use a one-off preview

Use `-e` only when the package should not be added to Pi settings:

```powershell
pi -e ./extensions/index.ts
```

This is useful for isolated debugging. It is not the normal daily development installation.

## Troubleshoot a version mismatch

1. Run `pi list` and check whether Pi is loading a local path or npm source.
2. Run `git branch --show-current` and `git status --short` in the local checkout.
3. Restart Pi after extension changes.
4. Remove duplicate Pi-TUIX sources from the same settings scope.
5. For npm installs, pin an exact version while investigating instead of relying on `latest`.
