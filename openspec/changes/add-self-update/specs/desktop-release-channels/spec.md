# Spec Delta

## Purpose

Defines how QueryMT Desktop stable and nightly releases are versioned, signed and published as update feeds, so that version order matches code order and installed apps can safely update from either channel.

## ADDED Requirements

### Requirement: Stable desktop versions
A stable desktop release SHALL be tagged `v<X.Y.Z>` matching the version in `package.json`, `tauri.conf.json` and `Cargo.toml`, and SHALL be published as a non-prerelease GitHub release.

#### Scenario: Stable tag matches project version
- **WHEN** tag `v0.1.8` is pushed and the project version is `0.1.8`
- **THEN** the release is built and published as the latest stable release

### Requirement: Nightly desktop versions sort after the stable they follow
A desktop nightly SHALL be versioned `<base>-nightly.<UTC YYYYMMDDHHMMSS>`. The base SHALL be the project version, unless a stable tag for that version already exists, in which case the base SHALL be the next patch version. The commit SHA SHALL NOT appear in the version.

#### Scenario: Project version already released
- **WHEN** the project version is `0.1.7`, tag `v0.1.7` exists, and a nightly is built at 2026-11-06 14:32:00 UTC
- **THEN** the nightly version is `0.1.8-nightly.20261106143200`

#### Scenario: Project version not yet released
- **WHEN** the project version is `0.1.8` and no `v0.1.8` tag exists
- **THEN** the nightly version base is `0.1.8`

#### Scenario: Later nightly sorts higher
- **WHEN** two nightlies are built from the same base at different times
- **THEN** the later one has the higher semver precedence

### Requirement: Updater artifacts are signed
Every self-updatable artifact (macOS `.app.tar.gz`, Windows NSIS setup, Wry AppImage, CEF AppImage) in both channels SHALL be published with a signature created by the project's updater signing key. A build that cannot sign SHALL fail instead of publishing unsigned updater artifacts.

#### Scenario: Missing signing key
- **WHEN** the release or nightly workflow runs without the signing key secret
- **THEN** the workflow fails before publishing

#### Scenario: CEF AppImage signed
- **WHEN** a CEF AppImage is packaged for a release
- **THEN** its signature is verified against the updater public key and recorded in `latest.json`; detached `.sig` files are not published as release assets

### Requirement: One update feed per channel
Each release SHALL publish a `latest.json` feed listing the desktop version, release notes, publish date, the bundled qmtcode version, and per-platform artifact URL and signature. Platform keys SHALL be `darwin-<arch>`, `windows-<arch>`, `linux-<arch>-wry` and `linux-<arch>-cef`. Stable feeds SHALL be reachable at the latest-release download URL and nightly feeds at the `nightly` release download URL.

#### Scenario: Feed covers all published platforms
- **WHEN** a release publishes macOS (both arches), Windows x64, and Linux Wry and CEF (both arches) artifacts
- **THEN** `latest.json` contains one valid entry for each, and every entry's signature matches its artifact

#### Scenario: Incomplete feed is not published
- **WHEN** any expected platform artifact or signature is missing
- **THEN** the publish job fails and the previous release stays in place

### Requirement: Feed records the bundled qmtcode version
The feed SHALL record the semver version of the qmtcode bundled into every artifact of that release, and all artifacts of one release SHALL bundle the same qmtcode version. The same version SHALL be compiled into the desktop build.

#### Scenario: Nightly bundles nightly qmtcode
- **WHEN** a desktop nightly bundles qmtcode `0.6.0-nightly.20261105111147`
- **THEN** its feed's qmtcode version is `0.6.0-nightly.20261105111147` and the built app reports the same

### Requirement: Stable desktop does not downgrade nightly qmtcode
A stable desktop release SHALL fail before publishing if its bundled qmtcode version is lower than the qmtcode version in the currently published desktop nightly feed.

#### Scenario: Stable would bundle older qmtcode
- **WHEN** a stable release would bundle qmtcode `0.5.2` while the desktop nightly feed records `0.6.0-nightly.20261105111147`
- **THEN** the release workflow fails with an explanation and publishes nothing

### Requirement: Feed artifact URLs point to GitHub
Artifact URLs in `latest.json` SHALL be the canonical GitHub release download URLs, so the feed works without query.mt.

#### Scenario: Feed independent of query.mt
- **WHEN** a release publishes `latest.json`
- **THEN** every platform `url` starts with `https://github.com/querymt/querymt-desktop/releases/download/<tag>/`

### Requirement: query.mt update statistics redirects
The query.mt website worker SHALL provide `GET /updates/desktop/<stable|nightly>/latest.json` and `GET /download/desktop/update/<tag>/<asset>`. Each SHALL validate its input, record one data point, and redirect with HTTP 302 to the fixed GitHub URL of that feed or release asset. HEAD requests SHALL redirect without being recorded.

#### Scenario: Check redirect
- **WHEN** `GET /updates/desktop/nightly/latest.json?v=0.1.8-nightly.20261106143200&t=linux-x86_64-cef` is requested
- **THEN** a `check` event with channel `nightly`, that version and target is recorded, and the response redirects to `https://github.com/querymt/querymt-desktop/releases/download/nightly/latest.json`

#### Scenario: Update download redirect
- **WHEN** `GET /download/desktop/update/v0.1.8/QueryMT-Desktop-v0.1.8-macos-aarch64.app.tar.gz` is requested
- **THEN** a `download` event for `darwin-aarch64` is recorded, and the response redirects to the same asset under `https://github.com/querymt/querymt-desktop/releases/download/v0.1.8/`

#### Scenario: HEAD request
- **WHEN** either route is requested with HEAD
- **THEN** it redirects and records nothing

### Requirement: Update redirects accept only known release assets
The update download route SHALL accept only `vX.Y.Z` or `nightly` tags and updater artifact names produced by the release workflows, and SHALL respond 404 without recording anything to any other request, including an unknown channel on the check route.

#### Scenario: Unknown asset
- **WHEN** the download route is requested with an asset name that is not an updater artifact for that tag
- **THEN** it responds 404 and records nothing

#### Scenario: Path traversal
- **WHEN** the download route is requested with a tag or asset containing `..` or extra path segments
- **THEN** it responds 404 and records nothing

### Requirement: Update statistics are anonymous and separate
Update statistics SHALL be recorded in the Analytics Engine dataset `qmt_desktop_updates`, separate from installer downloads in `qmt_installs`. Each data point SHALL contain only event, channel, version, target and country, and SHALL NOT contain an IP address, IP hash, user agent or install identifier.

#### Scenario: Recorded fields
- **WHEN** a `check` or `download` event is recorded
- **THEN** it is written to `qmt_desktop_updates` with only event, channel, version, target and country, and nothing is written to `qmt_installs`

### Requirement: Landing-page downloads match release asset names
The query.mt landing page and its tracked `/download/desktop/<tag>/<asset>` route SHALL recognise the installer names produced by the release workflows (`<prefix>-<vX.Y.Z>-<suffix><ext>`) before a stable release with those names is published.

#### Scenario: First stable with new names
- **WHEN** stable `v0.1.8` is published with assets named `QueryMT-Desktop-v0.1.8-macos-aarch64.dmg` and `QueryMT-Desktop-wry-v0.1.8-linux-x86_64.AppImage`
- **THEN** the landing page offers both downloads and the tracked route redirects them
