# 0001: Separate observed code from design intent

Status: Accepted. Repo mapping is merged; spec/drift checks are proposed in #87.

## Context

The repository contains working source alongside open migration tickets and PRs.
A closed issue can mean superseded, and a file's presence does not prove live behavior.

## Decision

Use the tracked source tree for observed inventory, issues for ownership/acceptance,
ADRs for decisions, and authored `.dog` specs for source boundaries and planned systems.
Keep generated graphs local. Record the revision, exclusions, unresolved imports,
and content hashes; explicitly acknowledge affected spec areas after reviewing changes.

## Consequences

Remapping cannot clear spec-review drift. New source areas need an observed scope.
Hash checks detect change, not semantic correctness, dataset age, or deployment health.
Issue status changes must still be reviewed; local source hashing does not poll GitHub.

## Evidence

[Map implementation](../../scripts/dog-map.ts), [drift checks](../../scripts/dog-check.ts),
[spec workflow](../../specs/reeldeal/plan.dog),
[#83](https://github.com/reeldeal-xyz/reeldeal/issues/83),
[#86](https://github.com/reeldeal-xyz/reeldeal/issues/86),
[#87](https://github.com/reeldeal-xyz/reeldeal/pull/87).
