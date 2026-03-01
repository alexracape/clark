# Desktop + CLI Release Checklist

This runbook documents the unified-tag release process for Clark.

## Versioning Contract

- A single tag `vX.Y.Z` represents the release version for both CLI and desktop.
- CLI and desktop build in separate CI lanes under the same tag.
- A release can publish CLI assets even if desktop fails, but desktop availability must be called out in release notes.

## Required GitHub Secrets (desktop lane)

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_UPDATER_PUBLIC_KEY`

Notes:
- These keys are for updater artifact signing and verification.
- Current macOS desktop binaries are unsigned beta builds at the OS trust layer.

## Release Steps

1. Bump app versions in source as needed and ensure changelog notes are ready.
2. Create and push a tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. Wait for `.github/workflows/release.yml` to complete.
4. Verify GitHub Release assets include:
   - CLI binaries + checksums (`clark-darwin-*`, `clark-linux-*`, `*.sha256`)
   - Desktop macOS DMG
   - Updater artifacts (`*.tar.gz`, `*.sig`, `latest.json`, `latest-macos.json`)
5. Verify updater metadata version equals the tag version.
6. If desktop lane failed, either:
   - Re-run just the desktop lane and republish assets, or
   - Keep desktop marked unavailable in release notes.

## Rollback Procedure (desktop updater)

If a desktop update is bad:

1. Identify previous known-good release tag.
2. Replace the `latest.json` and `latest-macos.json` assets on the latest release with metadata pointing to the known-good desktop artifact.
3. Confirm the metadata signature and URLs are valid.
4. Publish a short release note indicating rollback.

CLI binaries do not need rollback when only desktop updater metadata changes.

## Homepage / Docs Expectations

- Homepage primary CTA: `Download for macOS`.
- Getting Started is desktop-first.
- CLI install script remains documented as secondary in `README.md`.
