# Architecture decision records

These records derive decisions from code and the owning issues. They do not replace
issue acceptance criteria or declare open work shipped.

Reviewed 2026-09-26 against main [7dfb56b](https://github.com/reeldeal-xyz/reeldeal/commit/7dfb56bfdda70912e99f4fc87b61721ea6a737ee),
the team plan in [PR #30](https://github.com/reeldeal-xyz/reeldeal/pull/30) at `6ad7eea`,
and pipeline [PR #84](https://github.com/reeldeal-xyz/reeldeal/pull/84) at `8d3ef63`.
The spec/drift workflow is in [PR #87](https://github.com/reeldeal-xyz/reeldeal/pull/87).
Open PR evidence is identified separately from main.

| Record | Decision status | Implementation at review |
|---|---|---|
| [0001: Observed code and design intent](0001-observed-code-and-design-intent.md) | Accepted | Repo map merged; spec/drift checks in #87 |
| [0002: Astro and app-core](0002-astro-and-app-core.md) | Accepted direction | Foundation merged in #88; production migration pending |
| [0003: Risk API and keeper boundary](0003-risk-api-and-keeper.md) | Proposed | Current signed-feed boundary still in main |
| [0004: PostgreSQL schema ownership](0004-postgres-schema-ownership.md) | Proposed | Shared database handoff pending |
| [0005: Trigger and settlement compatibility](0005-trigger-and-settlement.md) | Accepted | Existing signed format implemented; proposed change unresolved |
| [0006: Evidence, freshness, and replay](0006-evidence-freshness-and-replay.md) | Proposed | Pinned inputs exist; operational enforcement pending |
| [0007: CI/CD and release evidence](0007-ci-cd-and-release-evidence.md) | Proposed | Pipeline workflow in #84; integrated release pending |

Accepted records describe existing constraints or an explicitly selected direction.
Proposed records require the linked owners' agreement or unresolved handoff.
Decision status is separate from implementation and deployment status.

For a new decision, add the next numbered file with status, context, decision,
consequences, and source links. Resolve changes in the owning issue/PR, then update
the record. Supersede an old decision with a linked new record; preserve its history.
Refresh the affected Dotdog review baseline using [the mapping workflow](../REPO-MAP.md).
