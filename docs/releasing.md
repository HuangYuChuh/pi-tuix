# Releasing Pi-TUIX

Pi-TUIX separates development, prerelease, and stable distribution by installation source, SemVer, npm dist-tag, and GitHub release state. A value in `package.json#version` alone is not a release.

> **Release authority:** Do not publish npm packages, push version tags, or create GitHub Releases without an explicit release decision.

## Choose the release channel

| Channel | Version example | npm dist-tag | Intended audience |
| --- | --- | --- | --- |
| Development | No per-change bump | None; local path only | Maintainers testing the working tree |
| Prerelease | `0.1.1-beta.1` | `beta` or `next` | Testers who accept incomplete behavior |
| Stable | `0.1.0` | `latest` | General users |

Never publish a prerelease version with the `latest` dist-tag. Do not use npm prereleases for each private development iteration; the local-path channel already serves that workflow.

## Prepare a release

1. Confirm the intended scope and acceptance criteria are complete.
2. Merge the release code into `main` using Conventional Commits.
3. Set `package.json#version` to the intended SemVer and commit the version change.
4. Confirm the local `main` matches the commit intended for publication.
5. Run the release gate from a clean worktree.

For a stable release:

```powershell
npm run release:check -- --tag v0.1.0 --channel latest
```

For a prerelease:

```powershell
npm run release:check -- --tag v0.1.1-beta.1 --channel beta
```

The gate fetches `origin/main` and tags, then rejects the wrong branch, dirty files, an unpublished local commit, mismatched version and tag values, existing tags, prereleases targeting `latest`, and stable versions targeting a prerelease channel. It also runs TypeScript, test, and package-content checks.

## Publish the approved commit

After the release gate passes and publication is explicitly approved:

```powershell
git tag -a v0.1.0 -m "release: v0.1.0"
git push origin v0.1.0
npm publish --tag latest
gh release create v0.1.0 --verify-tag --generate-notes --title "Pi-TUIX v0.1.0"
```

For a prerelease, substitute the prerelease version, publish with `--tag beta` or `--tag next`, and mark the GitHub Release as a prerelease.

## Verify the release

```powershell
npm view pi-tuix@0.1.0 version dist-tags
pi install npm:pi-tuix@0.1.0
pi list
```

Start a fresh Pi session and verify `/pituix-about`, the shell UI, built-in tool delegation, and `/pituix-default`. Report Git push, npm publication, and GitHub Release status separately; success in one system does not prove the other two completed.

## Recover from a partial release

- If the tag was pushed but npm publication failed, fix the publication problem and publish the same verified commit. Do not silently move or recreate the tag.
- If npm publication succeeded but the GitHub Release failed, create the GitHub Release for the existing tag. Do not republish the npm version.
- If the wrong npm dist-tag was used, correct the dist-tag explicitly. Published npm versions are immutable.
- If verification finds a product defect, publish a new patch or prerelease version. Do not overwrite an existing version.
