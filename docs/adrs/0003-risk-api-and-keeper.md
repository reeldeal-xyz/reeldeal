# 0003: Separate risk indices from payout decisions

Status: Proposed. Interface and signer responsibilities remain gated by #55.

## Context

PR #84 replaced the TypeScript pipeline with Python/FastAPI. Merged #112 adds
JAXA ingestion, heat indices and heat/HAB layers; restriction indices, storm and
advisory routes remain incomplete. The existing keeper still expects legacy
signed feeds. The new risk-index handoff remains gated by #55/#64/#79.

## Decision

Jay owns ingestion, risk computation, and producer schemas. The app validates risk
responses at runtime, applies the agreed versioned rules, constructs the supported
Trigger, and coordinates signing/settlement. Keep provider analysis out of browsers.
Export Python OpenAPI and fixtures in #79; generate TypeScript consumers in #55.
The pipeline's Q10 decision keeps SGLI night → SGLI day → AMSR2 night → null
with per-value product/pixel provenance. Consumers must retain that support;
the shared JAXA regression dates do not establish live deployment or farm losses.

## Consequences

Generated types alone do not validate JSON. Resolve field aliases, units, nullability,
time boundaries, evidence hashes, and signer ownership before integration. Preserve
the deployed signing format until a coordinated replacement is agreed. Unavailable
or advisory data cannot satisfy the proposed operational signing gate.

## Evidence

[Current pipeline API](../../pipeline/src/pipeline/api.py),
[heat conventions and remaining routes](../../pipeline/README.md),
[current keeper feed consumer](../../web/src/lib/keeper/feed-client.ts),
[#55](https://github.com/reeldeal-xyz/reeldeal/issues/55),
[#60](https://github.com/reeldeal-xyz/reeldeal/issues/60),
[#64](https://github.com/reeldeal-xyz/reeldeal/issues/64),
[#79](https://github.com/reeldeal-xyz/reeldeal/issues/79),
[#82](https://github.com/reeldeal-xyz/reeldeal/issues/82).
