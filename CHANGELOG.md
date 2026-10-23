# Changelog

All notable changes to `dotagents` are recorded here. The project follows semantic versioning after its first public package release.

## Unreleased

## [0.4.1] - 2026-10-23

### Added

- Allow reviewed global skill updates to keep transaction history in a
  device-local store outside the managed skills directory, while recording the
  actual target root and preserving rollback cleanup after interruption.

## [0.4.0] - 2026-08-14

### Added

- Source-aware review APIs for installed skills, including grouped linked
  packages, update detection, and local-change reporting.
- Transactional library updates can now carry an explicit, value-free approval
  for an exact reviewed secret finding. A changed path, rule, line, column, or
  skill content remains blocked and must be reviewed again.

### Changed

- Consolidated the public library model around canonical libraries and the
  source-aware APIs used by desktop clients.

### Removed

- Removed the superseded `scope`, `resource-model`, `resource-apply`, and
  `adopt` package exports. Consumers should migrate to canonical-library,
  library-publish, library-removal, and source-aware review APIs.

## [0.3.0] - 2026-08-11

### Added

- Native GitHub Device Flow, OS credential-vault storage, and provider-session
  primitives so setup and sync do not depend on `gh` or `glab`.
- Canonical-library, publish-plan, source-registry, source-migration,
  toolkit-review, skill-evolution, and skill-fork APIs for applications that
  present a library UI on top of dotagents.

### Changed

- Provider setup now reuses the saved native connection to discover writable
  libraries and synchronize without repeatedly asking for a remote URL or
  local folder.

## [0.2.0] - 2026-08-07

### Added

- Guided provider setup for GitHub and GitLab: after explicit permission, the
  provider CLI can list writable libraries so people can select one instead of
  remembering a remote URL.
- Explicit, stale-checked plans for creating a new private GitHub or GitLab
  library. A remote is never created or made public without reviewing and
  confirming its exact name.
- A credential-free, OS-native local connection profile. `dotagents sync` and
  `dotagents status` reuse the selected library and remote without requiring a
  path or URL on every run.
- Cross-platform provider adapters and device-profile primitives exported from
  the TypeScript library for desktop and CLI integrations.

### Changed

- The primary CLI flow is now `dotagents setup` followed by `dotagents sync`.
  Advanced remote, plan-file, and trust-policy options remain available for
  automation and managed environments.
- Setup on a new device can restore a selected remote at its reviewed immutable
  commit, then connect compatible installed agents without overwriting their
  unmanaged files.

## [0.1.0] - 2026-08-04

### Added

- First public release of the independent `dotagents` CLI and TypeScript library.
- Canonical `skills.json`, `skills.lock`, portable `dotagents.yaml`, and private `dotagents.local.yaml` schemas.
- Cross-agent discovery, Skills CLI v3 support, and a provider-neutral catalog for 49 agent integrations.
- Journaled import and materialization plans with rollback, recovery, stale-preview checks, and unmanaged-target protection.
- Immutable Git dependency resolution, package integrity, license audit, prepared checkouts, and deterministic dependency update deltas.
- Reviewed Git commit, pull, and push plans with secret-safe isolated remote inspection.
- Reviewed Git clone plans with credential-free remotes, staging validation, stale-plan checks, and atomic destination creation.
- Shared owned-skill export policy, including deterministic file hashes and value-free findings.
- Explicit vendored imports with immutable origin, integrity, skill path, and license metadata; mismatched content is rejected before copy.
- Agent extension descriptors now require concrete data-only delivery roots; the unimplemented config-path placeholder was removed instead of advertising unsafe support.
- CLI library initialization is preview-only until its serialized plan is explicitly applied with `--yes`.
- Git repository initialization and origin changes now use stale-checked preview/apply plans too.
- CLI dependency resolution no longer has a direct `--write` path; a library-bound plan must be reviewed and applied explicitly.
- Git identity normalization now lives in a dependency-free leaf module shared by configuration, source resolution, and workspace plans, while the existing `sources` export remains compatible.
- Versioned JSON Schemas, compatibility fixtures, package-content verification, and macOS/Linux/Windows CI.
- Third-party conformance fixtures for repository-root and multi-skill package layouts.
- A committed public-declaration snapshot now makes package API changes an explicit release-gate decision.
- A shared, runtime-validated import-decision contract covers suggested, owned, dependency, vendored, local-only, and excluded outcomes; vendoring requires an explicit upstream license.
- Interrupted import and materialization recovery now has a value-redacted no-write preview and a stale-checked plan ID before `--yes` can modify local state.
- Release artifacts now bind the npm tarball, CycloneDX SBOM, changelog, migration/RFC documentation, package integrity, and immutable source commit through verified checksums.
- Release publication is retry-safe: an existing npm version must match the reviewed tarball integrity, and a permanent GitHub Release stays draft until every verified artifact is uploaded.
- A packed-install smoke test validates the published tarball's package exports and CLI in a clean consumer directory.

### Security

- Portable outputs reject embedded Git credentials, escaping paths, unsafe links, and value-bearing secret reports.
- `.agents/skills` alone is not accepted as agent-installation evidence.

### Compatibility

- Agent Skills discussion #210 is treated as directional input; claimed compatibility and deviations are documented in `docs/rfc-210-compatibility.md`.
