# 0004: Separate app and risk ownership in PostgreSQL

Status: Proposed. Database access, roles, and migration order await #55.

## Context

The target combines application records with pipeline-owned risk/geographic data.
Main still contains a JSON-file-backed payout directory; that is not proof of a
shared, durable database deployment.

## Decision

Use PostgreSQL/PostGIS with application-owned `app` migrations in Drizzle and
Jay-owned `risk` migrations in Alembic. Grant explicit cross-schema read access
where needed; only the owner writes its schema. App Farm records reference the
canonical pipeline Plot/zone geometry rather than maintaining another writable copy.

## Consequences

Freeze Farm-to-Plot/ENS identity, geographic provenance, and role permissions before
consumers land. Use transactional application writes and append-only audit history.
Prove migration/seed replay, concurrent single-winner inventory, restart persistence,
and backup restore separately from the existence of SQL files or local fixtures.

## Evidence

[Current payout storage](../../web/src/lib/payout-directory.ts),
[#55](https://github.com/reeldeal-xyz/reeldeal/issues/55),
[#59](https://github.com/reeldeal-xyz/reeldeal/issues/59),
[#62](https://github.com/reeldeal-xyz/reeldeal/issues/62),
[#71](https://github.com/reeldeal-xyz/reeldeal/issues/71),
[team plan at review](https://github.com/reeldeal-xyz/reeldeal/blob/6ad7eea69214ca5aef51a36b2f263ed5b0c7b16d/README.md).
