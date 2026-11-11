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
- **THEN** a matching `.sig` is published next to it

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
