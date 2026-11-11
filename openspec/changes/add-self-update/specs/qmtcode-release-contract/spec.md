# Spec Delta

## Purpose

Defines what QueryMT Desktop requires from querymt `qmt` and `qmtcode` stable and nightly releases, so that release versions sort in code order and a future stable can never regress the session database of users running the current nightly.

## ADDED Requirements

### Requirement: Nightly qmt and qmtcode versions are sortable semver
A querymt nightly SHALL build `qmt` and `qmtcode` with version `<base>-nightly.<UTC YYYYMMDDHHMMSS>`. The base SHALL be the workspace version, unless a stable tag for that version already exists, in which case it SHALL be the next patch. `--version` SHALL report this version, and the commit SHA SHALL NOT be the version.

#### Scenario: Workspace version not yet released
- **WHEN** the workspace version is `0.6.0`, the latest stable is `v0.5.2`, and the nightly is built at 2026-11-05 11:11:47 UTC
- **THEN** `qmtcode --version` reports `0.6.0-nightly.20261105111147`

#### Scenario: Workspace version already released
- **WHEN** the workspace version is `0.6.0` and tag `v0.6.0` exists
- **THEN** the nightly base is `0.6.1`

#### Scenario: Nightly sorts between stables
- **WHEN** nightly `0.6.0-nightly.20261105111147` is compared with stable `0.5.2` and future stable `0.6.0`
- **THEN** it sorts above `0.5.2` and below `0.6.0`

### Requirement: Stable qmt and qmtcode versions match the tag
A querymt stable release tagged `v<X.Y.Z>` SHALL build `qmt` and `qmtcode` reporting `X.Y.Z`, and the tag SHALL match the workspace version.

#### Scenario: Tag and workspace mismatch
- **WHEN** tag `v0.6.0` is pushed while the workspace version is `0.6.1`
- **THEN** the release fails before building

### Requirement: Releases publish a machine-readable manifest
Every querymt stable and nightly release SHALL publish a `release.json` asset with the version, channel, full commit SHA and publish time. Consumers SHALL be able to get the version without parsing asset names or notes.

#### Scenario: Desktop reads the nightly version
- **WHEN** the desktop nightly workflow resolves the querymt nightly release
- **THEN** it reads the qmtcode version and commit from `release.json`

### Requirement: Future stable never regresses the current nightly
A querymt stable release SHALL fail before publishing if its version is greater than the base of the published nightly and its tag commit does not contain the published nightly's commit.

#### Scenario: Stable cut from an old commit
- **WHEN** `v0.6.0` is tagged on a commit that does not contain the published `0.6.0-nightly.*` commit
- **THEN** the release fails with an explanation and nothing is published

#### Scenario: Stable cut from or after the nightly commit
- **WHEN** `v0.6.0` is tagged on a commit that contains the published nightly commit
- **THEN** the release proceeds

#### Scenario: Patch release on an older line
- **WHEN** `v0.5.3` is tagged while the published nightly is `0.6.0-nightly.*`
- **THEN** the release proceeds, since `0.5.3` sorts below the nightly

### Requirement: Nightly replacement keeps the release available
Replacing the rolling querymt nightly SHALL upload all assets to a draft before removing the previous nightly, and SHALL leave the previous nightly untouched if any upload fails.

#### Scenario: Upload fails
- **WHEN** an asset upload fails during a nightly publish
- **THEN** the previous `nightly` release and tag remain published

### Requirement: Desktop dispatch carries the nightly version
The dispatch sent from querymt to querymt-desktop after a nightly publish SHALL include the nightly version and commit SHA.

#### Scenario: Dispatch payload
- **WHEN** a querymt nightly is published
- **THEN** the `qmtcode-nightly` dispatch payload contains `querymt_sha` and `querymt_version`
